import type { LanguageModelV4Middleware, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, StreamProviderError } from "ai";

export const MODEL_STREAM_RETRIES = 3;
export const MODEL_STREAM_IDLE_TIMEOUT_MS = 120_000;

export interface ModelRetryEvent {
  state: "retrying" | "recovered" | "failed";
  attempt: number;
  maxAttempts: typeof MODEL_STREAM_RETRIES;
}

export interface ModelStreamRetryPolicy {
  reset(): void;
  onChunk(event: { chunk: { type: string } }): void;
  onError(event: { error: unknown }): Promise<void>;
}

interface RetryableShape {
  retryable?: unknown;
  isRetryable?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  cause?: unknown;
  message?: unknown;
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function retryableStatus(status: unknown): boolean {
  return typeof status === "number" && (status === 408 || status === 409 || status === 429 || status >= 500);
}

export function isRetryableNetworkError(error: unknown, seen = new Set<unknown>()): boolean {
  if (error == null || seen.has(error)) return false;
  seen.add(error);
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (APICallError.isInstance(error) || StreamProviderError.isInstance(error)) return error.isRetryable;
  if (typeof error !== "object" && typeof error !== "string") return false;

  const candidate = (typeof error === "object" ? error : { message: error }) as RetryableShape;
  if (typeof candidate.retryable === "boolean") return candidate.retryable;
  if (typeof candidate.isRetryable === "boolean") return candidate.isRetryable;
  if (retryableStatus(candidate.statusCode) || retryableStatus(candidate.status)) return true;
  if (
    (typeof candidate.statusCode === "number" && candidate.statusCode >= 400) ||
    (typeof candidate.status === "number" && candidate.status >= 400)
  )
    return false;
  if (typeof candidate.code === "string" && NETWORK_ERROR_CODES.has(candidate.code.toUpperCase())) return true;
  if (candidate.cause !== undefined && isRetryableNetworkError(candidate.cause, seen)) return true;
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return /fetch failed|network error|socket (?:closed|hang up)|connection (?:closed|lost|reset|terminated)|timed? ?out|timeout|incomplete provider stream/i.test(
    message,
  );
}

function retryPart(error: unknown): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "error", error });
      controller.close();
    },
  });
}

class ModelStreamIdleTimeoutError extends Error {
  readonly retryable = true;
  constructor(timeoutMs: number) {
    super(`Model stream idle timeout of ${timeoutMs}ms exceeded`);
    this.name = "ModelStreamIdleTimeoutError";
  }
}

function isSemanticModelProgress(part: LanguageModelV4StreamPart): boolean {
  switch (part.type) {
    case "text-delta":
    case "reasoning-delta":
    case "tool-input-delta":
      return part.delta.length > 0;
    case "stream-start":
    case "response-metadata":
    case "ping":
    case "raw":
    case "text-start":
    case "text-end":
    case "reasoning-start":
    case "reasoning-end":
    case "tool-input-start":
    case "tool-input-end":
    case "error":
      return false;
    default:
      return true;
  }
}

function classifyProviderStream(stream: ReadableStream<LanguageModelV4StreamPart>, idleTimeoutMs: number) {
  const reader = stream.getReader();
  let lastSemanticProgressAt = Date.now();
  return new ReadableStream<LanguageModelV4StreamPart>({
    async pull(controller) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const remainingIdleMs = Math.max(0, idleTimeoutMs - (Date.now() - lastSemanticProgressAt));
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new ModelStreamIdleTimeoutError(idleTimeoutMs)), remainingIdleMs);
          }),
        ]);
        if (next.done) {
          controller.close();
          return;
        }
        if (!isSemanticModelProgress(next.value) && Date.now() - lastSemanticProgressAt >= idleTimeoutMs) {
          throw new ModelStreamIdleTimeoutError(idleTimeoutMs);
        }
        if (next.value.type !== "error" || isRetryableNetworkError(next.value.error)) {
          if (isSemanticModelProgress(next.value)) lastSemanticProgressAt = Date.now();
          controller.enqueue(next.value);
          return;
        }
        await reader.cancel(next.value.error).catch(() => undefined);
        controller.error(next.value.error);
      } catch (error) {
        if (isRetryableNetworkError(error)) {
          await reader.cancel(error).catch(() => undefined);
          controller.enqueue({ type: "error", error });
          controller.close();
          return;
        }
        controller.error(error);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** Converts only transient provider failures into AI SDK retry parts. Terminal
 * provider and protocol failures error the stream and cannot be replayed. */
export function createRetryableModelStreamMiddleware(
  idleTimeoutMs = MODEL_STREAM_IDLE_TIMEOUT_MS,
): LanguageModelV4Middleware {
  return {
    specificationVersion: "v4",
    async wrapStream({ doStream }) {
      try {
        const result = await doStream();
        return { ...result, stream: classifyProviderStream(result.stream, idleTimeoutMs) };
      } catch (error) {
        if (!isRetryableNetworkError(error)) throw error;
        return { stream: retryPart(error) };
      }
    },
  };
}

export const retryableModelStreamMiddleware = createRetryableModelStreamMiddleware();

export function waitForTransientRetry(attempt: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const base = 200 * 2 ** (attempt - 1);
  const delay = Math.round(base * (0.9 + Math.random() * 0.2));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delay);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function createModelStreamRetryPolicy(options: {
  signal?: AbortSignal;
  emit(event: ModelRetryEvent): void;
  wait?: (attempt: number, signal?: AbortSignal) => Promise<void>;
}): ModelStreamRetryPolicy {
  let attempt = 0;
  let active = false;
  const emit = (state: ModelRetryEvent["state"]) => options.emit({ state, attempt, maxAttempts: MODEL_STREAM_RETRIES });
  return {
    reset() {
      attempt = 0;
      active = false;
    },
    onChunk({ chunk }: { chunk: { type: string } }) {
      if (
        active &&
        chunk.type !== "error" &&
        chunk.type !== "ping" &&
        chunk.type !== "start" &&
        chunk.type !== "start-step" &&
        chunk.type !== "model-call-start"
      ) {
        active = false;
        emit("recovered");
      }
    },
    async onError({ error }: { error: unknown }) {
      if (!isRetryableNetworkError(error)) return;
      if (attempt >= MODEL_STREAM_RETRIES) {
        active = false;
        emit("failed");
        return;
      }
      attempt++;
      active = true;
      emit("retrying");
      await (options.wait ?? waitForTransientRetry)(attempt, options.signal);
    },
  };
}

export async function retryTransientNetwork<T>(
  operation: () => Promise<T>,
  options: {
    signal?: AbortSignal;
    shouldRetry?: (error: unknown) => boolean;
    wait?: (attempt: number, signal?: AbortSignal) => Promise<void>;
    maxRetries?: number;
  } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? MODEL_STREAM_RETRIES;
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !(options.shouldRetry ?? isRetryableNetworkError)(error)) throw error;
      await (options.wait ?? waitForTransientRetry)(attempt + 1, options.signal);
    }
  }
}
