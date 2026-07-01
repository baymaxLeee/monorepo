import type { Context, Next } from "hono";

import { getSettings } from "../config.js";
import { UnauthorizedError } from "../lib/errors.js";

// Service-to-service auth for chat's /internal endpoints (e.g. executor pushing
// task progress). Shared internal token, NOT a per-user identity boundary —
// mirrors executor/knowledge/admin's internalAuthMiddleware. These routes are
// never reached from the browser (the gateway only proxies the user API).
export async function internalAuthMiddleware(c: Context, next: Next) {
  const token = c.req.header("X-Internal-Token");
  if (!token || token !== getSettings().internalApiToken) {
    throw new UnauthorizedError("invalid or missing X-Internal-Token");
  }
  await next();
}
