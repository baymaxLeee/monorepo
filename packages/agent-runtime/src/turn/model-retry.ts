import type { LanguageModelV4Middleware, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, StreamProviderError } from "ai";

export const MODEL_STREAM_RETRIES = 3;

export type ModelNetworkFailureReason =
  | "dns"
  | "timeout"
  | "connection_reset"
  | "incomplete_stream"
  | "provider_unavailable";

export interface ModelRetryEvent {
  state: "retrying" | "recovered" | "failed";
  attempt: number;
  maxAttempts: typeof MODEL_STREAM_RETRIES;
  reason: ModelNetworkFailureReason;
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
  name?: unknown;
  reason?: unknown;
  responseHeaders?: unknown;
  retryAfterMs?: unknown;
}

const NETWORK_FAILURE_REASONS = new Set<ModelNetworkFailureReason>([
  "dns",
  "timeout",
  "connection_reset",
  "incomplete_stream",
  "provider_unavailable",
]);
const DNS_ERROR_CODES = new Set(["EAI_AGAIN", "ENOTFOUND"]);
const TIMEOUT_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);
const RESET_ERROR_CODES = new Set(["ECONNRESET", "ENETRESET", "EPIPE", "UND_ERR_SOCKET"]);
const UNAVAILABLE_ERROR_CODES = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETDOWN", "ENETUNREACH"]);

function statusFailure(status: unknown): ModelNetworkFailureReason | null {
  if (status === 408) return "timeout";
  return typeof status === "number" && (status === 409 || status === 429 || status >= 500)
    ? "provider_unavailable"
    : null;
}

/** Reduces provider and transport failures to a small, non-sensitive retry
 * vocabulary. Raw URLs, hostnames, request ids and provider messages never
 * leave the boundary that observed the failure. */
export function classifyModelNetworkFailure(
  error: unknown,
  seen = new Set<unknown>(),
): ModelNetworkFailureReason | null {
  if (error == null || seen.has(error)) return null;
  seen.add(error);
  if (error instanceof DOMException && error.name === "AbortError") return null;
  if (typeof error !== "object" && typeof error !== "string") return null;

  const candidate = (typeof error === "object" ? error : { message: error }) as RetryableShape;
  const explicitRetryable =
    APICallError.isInstance(error) || StreamProviderError.isInstance(error)
      ? error.isRetryable
      : typeof candidate.retryable === "boolean"
        ? candidate.retryable
        : typeof candidate.isRetryable === "boolean"
          ? candidate.isRetryable
          : undefined;
  if (explicitRetryable === false) return null;
  if (
    (typeof candidate.statusCode === "number" && candidate.statusCode >= 400) ||
    (typeof candidate.status === "number" && candidate.status >= 400)
  ) {
    const reason = statusFailure(candidate.statusCode) ?? statusFailure(candidate.status);
    if (reason) return reason;
    return null;
  }
  if (
    typeof candidate.reason === "string" &&
    NETWORK_FAILURE_REASONS.has(candidate.reason as ModelNetworkFailureReason)
  )
    return candidate.reason as ModelNetworkFailureReason;
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  if (DNS_ERROR_CODES.has(code)) return "dns";
  if (TIMEOUT_ERROR_CODES.has(code)) return "timeout";
  if (RESET_ERROR_CODES.has(code)) return "connection_reset";
  if (UNAVAILABLE_ERROR_CODES.has(code)) return "provider_unavailable";
  if (candidate.name === "TimeoutError") return "timeout";
  if (candidate.cause !== undefined) {
    const reason = classifyModelNetworkFailure(candidate.cause, seen);
    if (reason) return reason;
  }
  const message = typeof candidate.message === "string" ? candidate.message : "";
  if (
    /incomplete (?:provider )?stream|incomplete[_ ]chunked|stream (?:ended|disconnected).*before|ended without/i.test(
      message,
    )
  )
    return "incomplete_stream";
  if (/\b(?:ENOTFOUND|EAI_AGAIN)\b|getaddrinfo|dns/i.test(message)) return "dns";
  if (
    /\b(?:ECONNABORTED|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)\b|timed? ?out|timeout/i.test(message)
  )
    return "timeout";
  if (
    /\b(?:ECONNRESET|ENETRESET|EPIPE|UND_ERR_SOCKET)\b|socket (?:closed|hang up)|connection (?:closed|lost|reset|terminated)/i.test(
      message,
    )
  )
    return "connection_reset";
  if (
    /\b(?:ECONNREFUSED|EHOSTUNREACH|ENETDOWN|ENETUNREACH)\b|fetch failed|network error|service unavailable|server busy|overloaded/i.test(
      message,
    )
  )
    return "provider_unavailable";
  return explicitRetryable === true || error instanceof TypeError ? "provider_unavailable" : null;
}

export function isRetryableNetworkError(error: unknown): boolean {
  return classifyModelNetworkFailure(error) !== null;
}

function retryPart(error: unknown): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "error", error });
      controller.close();
    },
  });
}

function classifyProviderStream(stream: ReadableStream<LanguageModelV4StreamPart>) {
  const reader = stream.getReader();
  return new ReadableStream<LanguageModelV4StreamPart>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          return;
        }
        if (next.value.type !== "error" || isRetryableNetworkError(next.value.error)) {
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
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** Converts only transient provider failures into AI SDK retry parts. Terminal
 * provider and protocol failures error the stream and cannot be replayed. */
export function createRetryableModelStreamMiddleware(): LanguageModelV4Middleware {
  return {
    specificationVersion: "v4",
    async wrapStream({ doStream }) {
      try {
        const result = await doStream();
        return { ...result, stream: classifyProviderStream(result.stream) };
      } catch (error) {
        if (!isRetryableNetworkError(error)) throw error;
        return { stream: retryPart(error) };
      }
    },
  };
}

export const retryableModelStreamMiddleware = createRetryableModelStreamMiddleware();

function retryAfterMs(error: unknown, seen = new Set<unknown>()): number | undefined {
  if (!error || typeof error !== "object" || seen.has(error)) return undefined;
  seen.add(error);
  const candidate = error as RetryableShape;
  if (
    typeof candidate.retryAfterMs === "number" &&
    Number.isFinite(candidate.retryAfterMs) &&
    candidate.retryAfterMs >= 0
  ) {
    return candidate.retryAfterMs;
  }
  if (candidate.responseHeaders && typeof candidate.responseHeaders === "object") {
    const entry = Object.entries(candidate.responseHeaders as Record<string, unknown>).find(
      ([name]) => name.toLowerCase() === "retry-after",
    )?.[1];
    if (typeof entry === "string") {
      const seconds = Number(entry);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
      const deadline = Date.parse(entry);
      if (Number.isFinite(deadline)) return Math.max(0, deadline - Date.now());
    }
  }
  return retryAfterMs(candidate.cause, seen);
}

export function waitForTransientRetry(attempt: number, signal?: AbortSignal, error?: unknown): Promise<void> {
  signal?.throwIfAborted();
  const base = 200 * 2 ** (attempt - 1);
  const delay = retryAfterMs(error) ?? Math.round(base * (0.9 + Math.random() * 0.2));
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
  wait?: (attempt: number, signal?: AbortSignal, error?: unknown) => Promise<void>;
}): ModelStreamRetryPolicy {
  let attempt = 0;
  let active = false;
  let reason: ModelNetworkFailureReason = "provider_unavailable";
  const emit = (state: ModelRetryEvent["state"]) =>
    options.emit({ state, attempt, maxAttempts: MODEL_STREAM_RETRIES, reason });
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
      const failure = classifyModelNetworkFailure(error);
      if (!failure) return;
      reason = failure;
      if (attempt >= MODEL_STREAM_RETRIES) {
        active = false;
        emit("failed");
        return;
      }
      attempt++;
      active = true;
      emit("retrying");
      await (options.wait ?? waitForTransientRetry)(attempt, options.signal, error);
    },
  };
}

export async function retryTransientNetwork<T>(
  operation: () => Promise<T>,
  options: {
    signal?: AbortSignal;
    shouldRetry?: (error: unknown) => boolean;
    wait?: (attempt: number, signal?: AbortSignal, error?: unknown) => Promise<void>;
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
      await (options.wait ?? waitForTransientRetry)(attempt + 1, options.signal, error);
    }
  }
}
