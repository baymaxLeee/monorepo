import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";

import type { AuthContext } from "../../api/http/middleware/auth.js";
import { AppError, ForbiddenError, RequestError } from "../errors.js";
import {
  inferenceRequestSchema,
  modelOptions,
  type InferenceConfig,
  type InferenceRequest,
} from "./generated/inference.js";

export interface RelayProvider {
  config: InferenceConfig;
  model: LanguageModelV4;
}
export interface RelayDependencies {
  resolve(auth: AuthContext, agentId: string | null): Promise<RelayProvider>;
  reserve(
    auth: AuthContext,
    requestId: string,
    model: string,
    tokens: number,
  ): Promise<{ settle(tokens: number | null): Promise<void> }>;
}

export async function inferenceResponse(
  auth: AuthContext,
  payload: unknown,
  signal: AbortSignal,
  deps: RelayDependencies,
): Promise<Response> {
  const parsed = inferenceRequestSchema.safeParse(payload);
  if (!parsed.success) throw new RequestError("Invalid local inference request");
  const request: InferenceRequest = parsed.data;
  const provider = await deps.resolve(auth, request.agentId);
  if (provider.config.model !== request.model) throw new ForbiddenError("Model is not authorized for this Agent");
  if (request.options.maxOutputTokens > provider.config.maxOutputTokens)
    throw new RequestError("Output exceeds configured model budget");
  // Reserve the whole allowed context, rather than treating a tokenizer estimate
  // as an authorization boundary. Unknown provider outcomes retain reservation.
  const reserved = provider.config.contextWindow + request.options.maxOutputTokens;
  if (Buffer.byteLength(JSON.stringify(request.options)) > provider.config.contextWindow)
    throw new RequestError("Local context is too large; start a new conversation or reduce context");
  signal.throwIfAborted();
  const operation = await deps.reserve(auth, request.requestId, request.model, reserved);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const deadline = setTimeout(abort, 5 * 60_000);
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
  } catch {
    cleanup();
    await operation.settle(null);
    throw new AppError("Model request failed; its outcome may be unknown", 502, "inference_failed");
  }
  const encoder = new TextEncoder();
  let settled = false,
    finished = false,
    outputBytes = 0;
  const settle = async (tokens: number | null) => {
    if (!settled) {
      settled = true;
      cleanup();
      await operation.settle(tokens);
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
          if (!finished) throw new Error("Incomplete provider stream");
          await settle(null);
          output.close();
          return;
        }
        let part = next.value;
        if (part.type === "error" || ("providerExecuted" in part && part.providerExecuted))
          throw new Error("Provider failed or attempted hosted tool execution");
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
      } catch {
        controller.abort();
        await reader.cancel().catch(() => undefined);
        await settle(null);
        output.error(new Error("Model stream interrupted; no automatic retry was performed"));
      }
    },
    async cancel() {
      controller.abort();
      await reader.cancel().catch(() => undefined);
      await settle(null);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
