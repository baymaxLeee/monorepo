import type { Context, Next } from "hono";

import { UnauthorizedError } from "../../../application/errors.js";

export interface AuthContext {
  userId: string;
  username: string;
  email: string;
  orgId: string;
  orgRole: string;
  roles: string[];
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
  const orgId = c.req.header("X-Auth-Org-ID");
  if (!orgId) throw new UnauthorizedError("X-Auth-Org-ID header is required");
  const orgRole = c.req.header("X-Auth-Org-Role") ?? "";
  const roles = (c.req.header("X-Auth-Roles") ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  c.set("auth", { userId, username, email, orgId, orgRole, roles } satisfies AuthContext);
  await next();
}
