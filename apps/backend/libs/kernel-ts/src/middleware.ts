import { randomBytes } from "node:crypto";

import { context as otelContext, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";

import { PROPAGATED_FIELDS, runWithContext, type RequestContext } from "./trace.js";

const TRACE_HEADER = "X-Trace-Id";
const TRACE_PARENT_HEADER = "traceparent";
const SKIP_PATHS = new Set(["/livez", "/readyz", "/healthz"]);

function normalizeTraceId(value: string | undefined): string {
  if (!value) return "";
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(normalized) ? normalized : "";
}

function normalizeTraceParent(value: string | undefined): string {
  if (!value) return "";
  const normalized = value.trim().toLowerCase();
  return /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(normalized)
    ? normalized
    : "";
}

function traceIdFromTraceParent(value: string): string {
  return normalizeTraceParent(value).split("-")[1] ?? "";
}

function newTraceParent(traceId: string): string {
  return `00-${traceId}-${randomBytes(8).toString("hex")}-01`;
}

function traceParentFromActiveSpan(fallback: string): string {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext?.traceId || !spanContext?.spanId) return fallback;
  if (/^0+$/.test(spanContext.traceId) || /^0+$/.test(spanContext.spanId)) return fallback;
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

const headerGetter = {
  keys: (carrier: Record<string, string>) => Object.keys(carrier),
  get: (carrier: Record<string, string>, key: string) => carrier[key.toLowerCase()] ?? carrier[key],
};

/**
 * Read the propagated correlation headers (gateway injects them at the edge;
 * fall back to a fresh trace id for direct/internal callers), mirror the trace
 * id on the response, and bind the whole context to async storage so logger +
 * transport pick it up without threading it through call sites.
 */
export function traceMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const inboundTraceParent = normalizeTraceParent(c.req.header(TRACE_PARENT_HEADER));
    const traceId =
      traceIdFromTraceParent(inboundTraceParent) ||
      normalizeTraceId(c.req.header(TRACE_HEADER)) ||
      randomBytes(16).toString("hex");
    const fallbackTraceParent = inboundTraceParent || newTraceParent(traceId);
    const carrier = Object.fromEntries(
      [...c.req.raw.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
    );
    carrier[TRACE_PARENT_HEADER] = fallbackTraceParent;
    carrier[TRACE_HEADER.toLowerCase()] = traceId;
    const parentContext = propagation.extract(otelContext.active(), carrier, headerGetter);

    await trace
      .getTracer("backend-http")
      .startActiveSpan(
        `${c.req.method} ${c.req.path}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            "http.request.method": c.req.method,
            "url.path": c.req.path,
          },
        },
        parentContext,
        async (span) => {
          const activeTraceParent = traceParentFromActiveSpan(fallbackTraceParent);
          const activeTraceId = traceIdFromTraceParent(activeTraceParent) || traceId;
          c.header(TRACE_HEADER, activeTraceId);
          c.header(TRACE_PARENT_HEADER, activeTraceParent);
          const requestContext: RequestContext = {
            traceId: activeTraceId,
            traceParent: activeTraceParent,
          };
          for (const field of PROPAGATED_FIELDS) {
            if (field.ctxKey === "traceId" || field.ctxKey === "traceParent") continue;
            const value = c.req.header(field.header);
            if (value) requestContext[field.ctxKey] = value;
          }

          try {
            await runWithContext(requestContext, () => next());
            span.setAttribute("http.response.status_code", c.res.status);
            if (c.res.status >= 500) {
              span.setStatus({ code: SpanStatusCode.ERROR });
            }
          } catch (error) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            if (error instanceof Error) span.recordException(error);
            throw error;
          } finally {
            span.end();
          }
        },
      );
  };
}

export function requestLogger(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    if (SKIP_PATHS.has(c.req.path)) {
      await next();
      return;
    }
    const start = performance.now();
    await next();
    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: Math.round(performance.now() - start),
      },
      "http",
    );
  };
}
