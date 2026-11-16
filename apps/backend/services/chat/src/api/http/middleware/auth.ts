import type { Context, Next } from "hono";

import type { AuthContext } from "../../../application/auth.js";

export type { AuthContext } from "../../../application/auth.js";

export async function authMiddleware(c: Context, next: Next) {
  const userId = c.req.header("X-Auth-User-ID");
  const tenantId = c.req.header("X-Auth-Tenant-ID");
  const workspaceId = c.req.header("X-Auth-Workspace-ID");
  if (!userId || !tenantId || !workspaceId) {
    return c.json({ code: "unauthorized", message: "missing auth context" }, 401);
  }
  c.set("auth", { userId, tenantId, workspaceId } satisfies AuthContext);
  await next();
}

export function getAuth(c: Context): AuthContext {
  return c.get("auth") as AuthContext;
}
