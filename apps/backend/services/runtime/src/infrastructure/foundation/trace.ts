import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  traceId: string;
  traceParent?: string;
  traceState?: string;
}

/**
 * Correlation fields propagated across services: read from inbound headers,
 * stamped on every log line, and forwarded on outbound internal calls.
 * The Runtime propagates observability metadata only. Product identity and
 * authorization headers terminate at the upper host.
 */
export const PROPAGATED_FIELDS = [
  { header: "traceparent", ctxKey: "traceParent", logKey: "traceparent" },
  { header: "tracestate", ctxKey: "traceState", logKey: "tracestate" },
] as const satisfies ReadonlyArray<{
  header: string;
  ctxKey: "traceParent" | "traceState";
  logKey: string;
}>;

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

/**
 * Headers to forward on an outbound internal call, derived from the current
 * request context. Empty when there is no active context (e.g. background work).
 */
export function propagationHeaders(): Record<string, string> {
  const context = storage.getStore();
  if (!context) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const field of PROPAGATED_FIELDS) {
    const value = context[field.ctxKey];
    if (value) {
      headers[field.header] = value;
    }
  }
  return headers;
}
