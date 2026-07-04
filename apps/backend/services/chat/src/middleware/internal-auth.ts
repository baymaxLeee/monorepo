import type { Context, Next } from "hono";

import { getSettings } from "../config.js";
import { UnauthorizedError } from "../lib/errors.js";

export async function internalAuthMiddleware(c: Context, next: Next) {
  const token = c.req.header("X-Internal-Token");
  if (!token || token !== getSettings().internalApiToken) {
    throw new UnauthorizedError("invalid or missing X-Internal-Token");
  }
  await next();
}
