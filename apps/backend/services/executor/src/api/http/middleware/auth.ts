import { timingSafeEqual } from "node:crypto";

import type { Context, Next } from "hono";

import { UnauthorizedError } from "../../../application/errors.js";
import { getSettings } from "../../../bootstrap/config.js";

const ALLOWED_CALLERS = new Set(["chat", "canvas", "knowledge"]);

export async function internalAuthMiddleware(c: Context, next: Next) {
  const caller = c.req.header("X-Caller-Service");
  const token = c.req.header("X-Internal-Token");
  const expected = caller && ALLOWED_CALLERS.has(caller) ? getSettings().internalServiceTokens[caller] : undefined;
  if (!token || !expected) {
    throw new UnauthorizedError("invalid internal service credentials");
  }
  const actualBytes = Buffer.from(token);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new UnauthorizedError("invalid internal service credentials");
  }
  c.set("callerService", caller);
  await next();
}

export function requireCallerService(c: Context): string {
  const caller = c.get("callerService");
  if (typeof caller !== "string" || !caller) {
    throw new UnauthorizedError("missing caller service context");
  }
  return caller;
}
