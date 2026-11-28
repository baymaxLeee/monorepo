import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { classifyModelNetworkFailure, estimateTextTokens, type ModelNetworkFailureReason } from "@repo/agent-runtime";

import { ForbiddenError, RequestError } from "../errors.js";
import {
  inferenceRequestSchema,
  type InferenceRelayError,
  modelOptions,
  type InferenceConfig,
  type InferenceRequest,
} from "./generated/inference.js";

export interface RelayProvider {
  config: InferenceConfig;
  model: LanguageModelV4;
}

const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const responseHeaders = {
  "Content-Type": "application/x-ndjson",
  "Cache-Control": "no-store",
  "X-Accel-Buffering": "no",
  // @hono/node-server otherwise probes early chunks and can infer a short
  // Content-Length before the provider has finished producing the stream.
  "Transfer-Encoding": "chunked",
};

class IncompleteProviderStreamError extends Error {}
class ProviderProtocolError extends Error {}

const NETWORK_FAILURE_MESSAGES: Record<ModelNetworkFailureReason, string> = {
  dns: "模型服务域名解析失败",
  timeout: "模型连接超时",
  connection_reset: "模型连接被重置",
  incomplete_stream: "模型响应流提前中断",
  provider_unavailable: "模型服务暂时不可用",
};

function safeRelayError(reason: ModelNetworkFailureReason | null): InferenceRelayError {
  return reason
    ? { code: "model_connection_failed", message: NETWORK_FAILURE_MESSAGES[reason], retryable: true, reason }
    : {
        code: "model_stream_interrupted",
        message: "模型响应协议错误，请重新发送消息",
        retryable: false,
        reason: "protocol",
      };
}

type ProviderStart = { ok: true; stream: ReadableStream<LanguageModelV4StreamPart> } | { ok: false; error: unknown };

type ProviderRead =
  | {
      ok: true;
      value: Awaited<ReturnType<ReadableStreamDefaultReader<LanguageModelV4StreamPart>["read"]>>;
    }
  | { ok: false; error: unknown };

class HeartbeatWait<T> {
  private ready = false;
  private value!: T;
  private readonly waiters = new Set<(value: T) => void>();

  constructor(pending: Promise<T>) {
    void pending.then((value) => {
      this.ready = true;
      this.value = value;
      for (const waiter of this.waiters) waiter(value);
      this.waiters.clear();
    });
  }

  wait(): Promise<{ ready: true; value: T } | { ready: false }> {
    if (this.ready) return Promise.resolve({ ready: true, value: this.value });
    return new Promise((resolve) => {
      const onReady = (value: T) => {
        clearTimeout(timer);
        this.waiters.delete(onReady);
        resolve({ ready: true, value });
      };
      const timer = setTimeout(() => {
        this.waiters.delete(onReady);
        resolve({ ready: false });
      }, HEARTBEAT_INTERVAL_MS);
      this.waiters.add(onReady);
    });
  }
}

export async function inferenceResponse(
  provider: RelayProvider,
  payload: unknown,
  signal: AbortSignal,
): Promise<Response> {
  const parsed = inferenceRequestSchema.safeParse(payload);
  if (!parsed.success) throw new RequestError("Invalid local inference request");
  const request: InferenceRequest = parsed.data;
  if (provider.config.model !== request.model)
    throw new ForbiddenError("Model is not authorized for this conversation");
  if (request.options.maxOutputTokens > provider.config.maxOutputTokens)
    throw new RequestError("Output exceeds configured model budget");
  // Reserve the whole allowed context, rather than treating a tokenizer estimate
  // as an authorization boundary. Unknown provider outcomes retain reservation.
  if (estimateTextTokens(JSON.stringify(request.options)) > provider.config.contextWindow)
    throw new RequestError("Local context is too large; start a new session or reduce context");
  signal.throwIfAborted();

  const encoder = new TextEncoder();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const cleanup = () => signal.removeEventListener("abort", abort);
  const providerStart: Promise<ProviderStart> = Promise.resolve()
    .then(() =>
      provider.model.doStream({
        ...modelOptions(request),
        abortSignal: controller.signal,
        includeRawChunks: false,
      }),
    )
    .then(
      (result) => ({ ok: true, stream: result.stream }),
      (error: unknown) => ({ ok: false, error }),
    );
  const providerProgress = new HeartbeatWait(providerStart);

  let reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart> | undefined;
  let pendingRead: HeartbeatWait<ProviderRead> | undefined;
  let settled = false;
  let finished = false;
  let closed = false;
  let outputBytes = 0;

  const settle = (tokens: number | null) => {
    if (settled) return;
    settled = true;
    cleanup();
    void tokens;
  };
  const encode = (part: LanguageModelV4StreamPart) =>
    encoder.encode(
      `${JSON.stringify(part, (_key, value) =>
        value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value,
      )}\n`,
    );
  const enqueue = (
    output: ReadableStreamDefaultController<Uint8Array>,
    part: LanguageModelV4StreamPart,
    enforceBudget = true,
  ) => {
    const bytes = encode(part);
    outputBytes += bytes.byteLength;
    if (enforceBudget && outputBytes > MAX_OUTPUT_BYTES) throw new ProviderProtocolError("Output budget exceeded");
    output.enqueue(bytes);
  };
  const cancelProvider = async () => {
    controller.abort();
    await reader?.cancel().catch(() => undefined);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(output) {
      // Establish the HTTP response before the provider has returned headers.
      // `stream-start` is an official non-semantic AI SDK part, so clients can
      // safely ignore it when deciding whether a failed sample may be retried.
      enqueue(output, { type: "stream-start", warnings: [] });
    },
    async pull(output) {
      try {
        while (!closed) {
          if (!reader) {
            const start = await providerProgress.wait();
            if (closed) return;
            if (!start.ready) {
              enqueue(output, { type: "ping" });
              return;
            }
            if (!start.value.ok) throw start.value.error;
            reader = start.value.stream.getReader();
          }

          pendingRead ??= new HeartbeatWait(
            reader.read().then(
              (value) => ({ ok: true, value }),
              (error: unknown) => ({ ok: false, error }),
            ),
          );
          const progress = await pendingRead.wait();
          if (closed) return;
          if (!progress.ready) {
            enqueue(output, { type: "ping" });
            return;
          }
          pendingRead = undefined;
          if (!progress.value.ok) throw progress.value.error;
          const next = progress.value.value;
          if (next.done) {
            if (!finished) throw new IncompleteProviderStreamError("Incomplete provider stream");
            settle(null);
            closed = true;
            output.close();
            return;
          }

          const part = next.value;
          if (part.type === "raw" || part.type === "response-metadata" || part.type === "stream-start") continue;
          if (part.type === "error") throw part.error;
          if ("providerExecuted" in part && part.providerExecuted)
            throw new ProviderProtocolError("Provider attempted hosted tool execution");
          if (part.type === "finish") {
            const input = part.usage.inputTokens.total;
            const outputTokens = part.usage.outputTokens.total;
            settle(input != null && outputTokens != null ? input + outputTokens : null);
            finished = true;
          }
          // No provider request bodies, headers, opaque continuation state or
          // diagnostic errors are forwarded or logged by this relay.
          const { providerMetadata: _metadata, ...safe } = part as LanguageModelV4StreamPart & {
            providerMetadata?: unknown;
          };
          enqueue(output, safe as LanguageModelV4StreamPart);
          if (finished) {
            closed = true;
            await cancelProvider();
            output.close();
          }
          return;
        }
      } catch (error) {
        await cancelProvider();
        settle(null);
        if (closed) return;
        closed = true;
        // The HTTP response is already a 200 with explicit NDJSON framing.
        // A retry restarts only this provider sample; completed agent steps and
        // tool effects are outside this relay, so partial text does not make a
        // transient provider transport failure unsafe to retry.
        const reason = signal.aborted
          ? null
          : error instanceof ProviderProtocolError
            ? null
            : (classifyModelNetworkFailure(error) ?? "incomplete_stream");
        enqueue(
          output,
          {
            type: "error",
            error: safeRelayError(reason),
          },
          false,
        );
        output.close();
      }
    },
    async cancel() {
      if (closed) return;
      closed = true;
      await cancelProvider();
      settle(null);
    },
  });

  // If the consumer disconnects before the provider has returned a stream,
  // release that late stream as soon as it arrives rather than leaking it.
  void providerStart.then(async (started) => {
    if (closed && started.ok && !reader) await started.stream.cancel().catch(() => undefined);
  });
  return new Response(stream, { headers: responseHeaders });
}
