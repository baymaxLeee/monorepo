import type { Context, Next } from "hono";

import { getSettings } from "../config.js";
import { UnauthorizedError } from "../lib/errors.js";

// executor is an internal service: only other backend services call it
// (via @backend/transport-ts), never the browser. Auth is a shared internal
// token, matching chat's ADMIN_SERVICE_URL/KNOWLEDGE_SERVICE_URL pattern —
// not a per-user identity boundary.
export async function internalAuthMiddleware(c: Context, next: Next) {
  const token = c.req.header("X-Internal-Token");
  if (!token || token !== getSettings().internalApiToken) {
    throw new UnauthorizedError("invalid or missing X-Internal-Token");
  }
  await next();
}
