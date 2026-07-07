import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  traceId: string;
  traceParent?: string;
  userId?: string;
  workspaceId?: string;
  tenantId?: string;
}

/**
 * Correlation fields propagated across services: read from inbound headers,
 * stamped on every log line, and forwarded on outbound internal calls.
 * Single source of truth — adding a field is one row here (plus a gateway
 * injection point for trusted identity fields).
 */
export const PROPAGATED_FIELDS = [
  { header: "X-Trace-Id", ctxKey: "traceId", logKey: "trace_id" },
  { header: "traceparent", ctxKey: "traceParent", logKey: "traceparent" },
  { header: "X-Auth-User-ID", ctxKey: "userId", logKey: "user_id" },
  { header: "X-Workspace-Id", ctxKey: "workspaceId", logKey: "workspace_id" },
  { header: "X-Tenant-Id", ctxKey: "tenantId", logKey: "tenant_id" },
] as const satisfies ReadonlyArray<{
  header: string;
  ctxKey: keyof RequestContext;
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
  if (!context) return {};
  const headers: Record<string, string> = {};
  for (const field of PROPAGATED_FIELDS) {
    const value = context[field.ctxKey];
    if (value) headers[field.header] = value;
  }
  return headers;
}
