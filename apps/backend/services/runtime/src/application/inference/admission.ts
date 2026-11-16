import { sql as query } from "drizzle-orm";

import type { AuthContext } from "../../api/http/middleware/auth.js";
import { getDb } from "../../infrastructure/persistence/index.js";
import { ConflictError } from "../errors.js";

export async function reserveInference(auth: AuthContext, requestId: string, model: string, tokens: number) {
  // Admission shares cloud identity/model authorization. These rows meter usage, not a local-only quota.
  const db = getDb();
  const day = new Date().toISOString().slice(0, 10);
  await db.transaction(async (tx) => {
    // Scope lock also serializes admission across the UTC date boundary.
    await tx.execute(
      query`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([auth.tenantId, auth.workspaceId, auth.userId])}, 0))`,
    );
    await tx.execute(query`INSERT INTO local_inference_budgets (tenant_id, workspace_id, user_id, day, used_tokens)
      VALUES (${auth.tenantId}, ${auth.workspaceId}, ${auth.userId}, ${day}, 0) ON CONFLICT DO NOTHING`);
    await tx.execute(query`SELECT used_tokens FROM local_inference_budgets WHERE tenant_id=${auth.tenantId}
      AND workspace_id=${auth.workspaceId} AND user_id=${auth.userId} AND day=${day} FOR UPDATE`);
    const previous = await tx.execute(query`SELECT id FROM local_inference_requests WHERE id=${requestId}`);
    if (previous.length)
      throw new ConflictError("Inference request already admitted; output is never replayed by the server");
    const active = await tx.execute(query`SELECT id FROM local_inference_requests WHERE tenant_id=${auth.tenantId}
      AND workspace_id=${auth.workspaceId} AND user_id=${auth.userId} AND status='admitted' AND deadline>now()`);
    if (active.length) throw new ConflictError("Another local inference request is active");
    await tx.execute(query`UPDATE local_inference_budgets SET used_tokens=used_tokens+${tokens} WHERE tenant_id=${auth.tenantId}
      AND workspace_id=${auth.workspaceId} AND user_id=${auth.userId} AND day=${day}`);
    await tx.execute(query`INSERT INTO local_inference_requests (id,tenant_id,workspace_id,user_id,day,model,reserved_tokens,charged_tokens,status,deadline)
      VALUES (${requestId},${auth.tenantId},${auth.workspaceId},${auth.userId},${day},${model},${tokens},${tokens},'admitted',now()+interval '6 minutes')`);
  });
  return {
    async settle(actual: number | null) {
      await db.transaction(async (tx) => {
        // Same lock order as admission. On crash/unknown outcome the maximum
        // reservation remains charged; the deadline only releases concurrency.
        await tx.execute(query`SELECT used_tokens FROM local_inference_budgets WHERE tenant_id=${auth.tenantId}
          AND workspace_id=${auth.workspaceId} AND user_id=${auth.userId} AND day=${day} FOR UPDATE`);
        const charged = actual == null ? tokens : Math.max(0, Math.ceil(actual));
        const changed =
          await tx.execute(query`UPDATE local_inference_requests SET status=${actual == null ? "unknown" : "completed"}, charged_tokens=${charged}
          WHERE id=${requestId} AND status='admitted' RETURNING id`);
        if (changed.length)
          await tx.execute(query`UPDATE local_inference_budgets SET used_tokens=used_tokens+${charged - tokens}
          WHERE tenant_id=${auth.tenantId} AND workspace_id=${auth.workspaceId} AND user_id=${auth.userId} AND day=${day}`);
      });
    },
  };
}
