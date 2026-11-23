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
const responseHeaders = {
  "Content-Type": "application/x-ndjson",
  "Cache-Control": "no-store",
  "X-Accel-Buffering": "no",
  // @hono/node-server otherwise probes early chunks and can infer a short
  // Content-Length before the provider has finished producing the stream.
  "Transfer-Encoding": "chunked",
};

class IncompleteProviderStreamError extends Error {}

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

function errorResponse(error: InferenceRelayError) {
  return new Response(`${JSON.stringify({ type: "error", error })}\n`, { headers: responseHeaders });
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
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Provider request timeout", "TimeoutError"));
  }, 5 * 60_000);
  const cleanup = () => {
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
  };
  let reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart>;
  try {
    if (signal.aborted) controller.abort();
    const result = await provider.model.doStream({
      ...modelOptions(request),
      abortSignal: controller.signal,
      providerOptions: { openai: { store: false } },
      includeRawChunks: false,
    });
    reader = result.stream.getReader();
  } catch (error) {
    cleanup();
    const reason = signal.aborted ? null : timedOut ? "timeout" : classifyModelNetworkFailure(error);
    return errorResponse(safeRelayError(reason));
  }
  const encoder = new TextEncoder();
  let settled = false,
    finished = false,
    outputBytes = 0;
  const settle = async (tokens: number | null) => {
    if (!settled) {
      settled = true;
      cleanup();
      void tokens;
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(output) {
      try {
        let next;
        do {
          next = await reader.read();
        } while (!next.done && (next.value.type === "raw" || next.value.type === "response-metadata"));
        if (next.done) {
          if (!finished) throw new IncompleteProviderStreamError("Incomplete provider stream");
          await settle(null);
          output.close();
          return;
        }
        let part = next.value;
        if (part.type === "error") throw part.error;
        if ("providerExecuted" in part && part.providerExecuted)
          throw new Error("Provider attempted hosted tool execution");
        if (part.type === "stream-start") part = { type: "stream-start", warnings: [] };
        if (part.type === "finish") {
          const input = part.usage.inputTokens.total,
            outputTokens = part.usage.outputTokens.total;
          await settle(input != null && outputTokens != null ? input + outputTokens : null);
          finished = true;
        }
        // No provider request bodies, headers, opaque continuation state or
        // diagnostic errors are forwarded or logged by this relay.
        const { providerMetadata: _metadata, ...safe } = part as LanguageModelV4StreamPart & {
          providerMetadata?: unknown;
        };
        const bytes = encoder.encode(
          `${JSON.stringify(safe, (_key, value) => (value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value))}\n`,
        );
        outputBytes += bytes.byteLength;
        if (outputBytes > 8 * 1024 * 1024) throw new Error("Output budget exceeded");
        output.enqueue(bytes);
        if (finished) {
          controller.abort();
          await reader.cancel().catch(() => undefined);
          output.close();
        }
      } catch (error) {
        controller.abort();
        await reader.cancel().catch(() => undefined);
        await settle(null);
        // The HTTP response may already be a 200 with partial NDJSON. Terminate
        // the model protocol explicitly so proxies do not turn an upstream
        // failure into ERR_INCOMPLETE_CHUNKED_ENCODING for the desktop client.
        // A retry restarts only this provider sample. Completed agent steps and
        // tool effects are outside this relay, so partial text does not make a
        // transient transport failure unsafe to retry.
        const reason = signal.aborted
          ? null
          : timedOut
            ? "timeout"
            : error instanceof IncompleteProviderStreamError
              ? "incomplete_stream"
              : classifyModelNetworkFailure(error);
        const part = {
          type: "error",
          error: safeRelayError(reason),
        } satisfies LanguageModelV4StreamPart;
        output.enqueue(encoder.encode(`${JSON.stringify(part)}\n`));
        output.close();
      }
    },
    async cancel() {
      controller.abort();
      await reader.cancel().catch(() => undefined);
      await settle(null);
    },
  });
  return new Response(stream, { headers: responseHeaders });
}
