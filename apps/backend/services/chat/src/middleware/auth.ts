import type { Context, Next } from "hono";

import { UnauthorizedError } from "../lib/errors.js";

const ADMIN_USER_ID = "demo-super-admin";
const ADMIN_EMAIL = "admin@example.com";

export interface AuthContext {
  userId: string;
  username: string;
  email: string;
  isAdmin: boolean;
}

export function getAuth(c: Context): AuthContext {
  const auth = c.get("auth") as AuthContext | undefined;
  if (!auth) throw new UnauthorizedError("missing auth context");
  return auth;
}

export async function authMiddleware(c: Context, next: Next) {
  const userId = c.req.header("X-Auth-User-ID");
  if (!userId) throw new UnauthorizedError("X-Auth-User-ID header is required");
  const username = c.req.header("X-Auth-Name") ?? userId;
  const email = c.req.header("X-Auth-Email") ?? "";
  const isAdmin = userId === ADMIN_USER_ID || email === ADMIN_EMAIL;
  c.set("auth", { userId, username, email, isAdmin } satisfies AuthContext);
  await next();
}
