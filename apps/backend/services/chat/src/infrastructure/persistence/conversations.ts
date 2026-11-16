import { randomBytes } from "node:crypto";

import type { AuthContext } from "../../application/auth.js";
import { getSql } from "./index.js";

export interface ProductConversation {
  id: string;
  runtime_session_id: string;
  create_request_id: string;
  user_id: string;
  tenant_id: string;
  workspace_id: string;
  title: string;
  project_id: string | null;
  canvas_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Row extends Omit<ProductConversation, "created_at" | "updated_at"> {
  created_at: Date;
  updated_at: Date;
}

const map = (row: Row): ProductConversation => ({
  ...row,
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});

export async function createProductConversation(
  scope: AuthContext,
  runtimeSessionId: string,
  input: { request_id: string; title?: string; project_id?: string; canvas_id?: string },
): Promise<ProductConversation> {
  const now = new Date();
  const [row] = await getSql()<Row[]>`
    INSERT INTO conversations (
      id, runtime_session_id, create_request_id, user_id, tenant_id, workspace_id, title, project_id, canvas_id, created_at, updated_at
    ) VALUES (
      ${randomBytes(6).toString("hex")}, ${runtimeSessionId}, ${input.request_id}, ${scope.userId}, ${scope.tenantId}, ${scope.workspaceId},
      ${input.title ?? "新对话"}, ${input.project_id ?? null}, ${input.canvas_id ?? null}, ${now}, ${now}
    )
    ON CONFLICT DO NOTHING
    RETURNING *
  `;
  if (row) return map(row);
  const [existing] = await getSql()<Row[]>`
    SELECT * FROM conversations
    WHERE tenant_id = ${scope.tenantId} AND workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId}
      AND (create_request_id = ${input.request_id} OR (
        ${input.project_id ?? null} IS NOT NULL AND ${input.canvas_id ?? null} IS NOT NULL
        AND project_id = ${input.project_id ?? null} AND canvas_id = ${input.canvas_id ?? null}
      ))
    LIMIT 1
  `;
  if (!existing || existing.runtime_session_id !== runtimeSessionId) throw new Error("conversation mapping conflict");
  return map(existing);
}

export async function listProductConversations(scope: AuthContext): Promise<ProductConversation[]> {
  const rows = await getSql()<Row[]>`
    SELECT * FROM conversations
    WHERE user_id = ${scope.userId} AND tenant_id = ${scope.tenantId} AND workspace_id = ${scope.workspaceId}
    ORDER BY updated_at DESC
  `;
  return rows.map(map);
}

export async function getProductConversation(scope: AuthContext, id: string): Promise<ProductConversation | null> {
  const [row] = await getSql()<Row[]>`
    SELECT * FROM conversations
    WHERE id = ${id} AND user_id = ${scope.userId} AND tenant_id = ${scope.tenantId}
      AND workspace_id = ${scope.workspaceId}
  `;
  return row ? map(row) : null;
}

export async function updateProductConversation(
  scope: AuthContext,
  id: string,
  title: string,
): Promise<ProductConversation | null> {
  const [row] = await getSql()<Row[]>`
    UPDATE conversations SET title = ${title}, updated_at = NOW()
    WHERE id = ${id} AND user_id = ${scope.userId} AND tenant_id = ${scope.tenantId}
      AND workspace_id = ${scope.workspaceId}
    RETURNING *
  `;
  return row ? map(row) : null;
}

export async function deleteProductConversation(scope: AuthContext, id: string): Promise<ProductConversation | null> {
  const [row] = await getSql()<Row[]>`
    DELETE FROM conversations
    WHERE id = ${id} AND user_id = ${scope.userId} AND tenant_id = ${scope.tenantId}
      AND workspace_id = ${scope.workspaceId}
    RETURNING *
  `;
  return row ? map(row) : null;
}
