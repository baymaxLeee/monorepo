import type { Context, Next } from "hono";

import { UnauthorizedError } from "../../../application/errors.js";
import { getSettings } from "../../../bootstrap/config.js";

const ALLOWED_CALLERS = new Set(["chat"]);

export async function internalAuthMiddleware(c: Context, next: Next) {
  const token = c.req.header("X-Internal-Token");
  if (!token || token !== getSettings().internalApiToken) {
    throw new UnauthorizedError("invalid or missing X-Internal-Token");
  }
  const caller = c.req.header("X-Caller-Service");
  if (!caller || !ALLOWED_CALLERS.has(caller)) {
    throw new UnauthorizedError("invalid or missing X-Caller-Service");
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
