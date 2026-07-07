import { randomBytes } from "node:crypto";

import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";

import { PROPAGATED_FIELDS, runWithContext, type RequestContext } from "./trace.js";

const TRACE_HEADER = "X-Trace-Id";
const SKIP_PATHS = new Set(["/livez", "/readyz", "/healthz"]);

function normalizeTraceId(value: string | undefined): string {
  if (!value) return "";
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(normalized) ? normalized : "";
}

/**
 * Read the propagated correlation headers (gateway injects them at the edge;
 * fall back to a fresh trace id for direct/internal callers), mirror the trace
 * id on the response, and bind the whole context to async storage so logger +
 * transport pick it up without threading it through call sites.
 */
export function traceMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const traceId =
      normalizeTraceId(c.req.header(TRACE_HEADER)) || randomBytes(16).toString("hex");
    c.header(TRACE_HEADER, traceId);
    const context: RequestContext = { traceId };
    for (const field of PROPAGATED_FIELDS) {
      if (field.ctxKey === "traceId") continue;
      const value = c.req.header(field.header);
      if (value) context[field.ctxKey] = value;
    }
    await runWithContext(context, () => next());
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
