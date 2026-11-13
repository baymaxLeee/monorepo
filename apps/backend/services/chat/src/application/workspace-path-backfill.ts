import { createHash } from "node:crypto";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { storageClient } from "../infrastructure/clients/storage.js";
import { getDb } from "../infrastructure/persistence/index.js";
import {
  assetClaimIntents,
  conversationFiles,
  conversationFileSaveOperations,
  conversationRunLeases,
} from "../infrastructure/persistence/schema.js";
import { allocateLegacyWorkspacePaths, isValidWorkspacePath } from "./workspace-paths.js";

export interface WorkspacePathBackfillResult {
  conversations: number;
  files: number;
}

export interface WorkspacePathVerificationResult {
  files: number;
  bytes: number;
}

async function assertBackfillQuiescent(): Promise<void> {
  const [activeRuns, pendingSaves, pendingClaims] = await Promise.all([
    getDb()
      .select({ count: sql<number>`count(*)::integer` })
      .from(conversationRunLeases),
    getDb()
      .select({ count: sql<number>`count(*)::integer` })
      .from(conversationFileSaveOperations)
      .where(eq(conversationFileSaveOperations.status, "pending")),
    getDb()
      .select({ count: sql<number>`count(*)::integer` })
      .from(assetClaimIntents)
      .where(and(eq(assetClaimIntents.ownerType, "conversation_file"), isNull(assetClaimIntents.deliveredAt))),
  ]);
  if ((activeRuns[0]?.count ?? 0) > 0 || (pendingSaves[0]?.count ?? 0) > 0 || (pendingClaims[0]?.count ?? 0) > 0) {
    throw new Error("workspace path backfill requires no active runs, pending file saves, or undelivered file claims");
  }
}

export async function backfillWorkspacePaths(): Promise<WorkspacePathBackfillResult> {
  await assertBackfillQuiescent();
  const pending = await getDb()
    .selectDistinct({ conversationId: conversationFiles.conversationId })
    .from(conversationFiles)
    .where(isNull(conversationFiles.workspacePath))
    .orderBy(asc(conversationFiles.conversationId));

  let files = 0;
  for (const { conversationId } of pending) {
    files += await getDb().transaction(async (tx) => {
      const rows = await tx
        .select({
          id: conversationFiles.id,
          filename: conversationFiles.filename,
          createdAt: conversationFiles.createdAt,
          workspacePath: conversationFiles.workspacePath,
        })
        .from(conversationFiles)
        .where(eq(conversationFiles.conversationId, conversationId))
        .orderBy(asc(conversationFiles.createdAt), asc(conversationFiles.id))
        .for("update");

      const unassigned = rows.filter((row) => row.workspacePath == null);
      if (unassigned.length === 0) return 0;
      if (unassigned.length !== rows.length) {
        throw new Error(`conversation ${conversationId} has a partial workspace path backfill`);
      }

      const allocations = allocateLegacyWorkspacePaths(unassigned);
      for (const allocation of allocations) {
        if (!isValidWorkspacePath(allocation.workspacePath)) {
          throw new Error(`workspace path allocation for file ${allocation.id} is invalid`);
        }
        const updated = await tx
          .update(conversationFiles)
          .set({ workspacePath: allocation.workspacePath })
          .where(
            and(
              eq(conversationFiles.conversationId, conversationId),
              eq(conversationFiles.id, allocation.id),
              isNull(conversationFiles.workspacePath),
            ),
          )
          .returning({ id: conversationFiles.id });
        if (updated.length !== 1) throw new Error(`workspace path backfill lost file ${allocation.id}`);
      }
      return allocations.length;
    });
  }

  const [remaining] = await getDb()
    .select({ count: sql<number>`count(*)::integer` })
    .from(conversationFiles)
    .where(isNull(conversationFiles.workspacePath));
  if ((remaining?.count ?? 0) !== 0) throw new Error("workspace path backfill did not cover every conversation file");

  const duplicates = await getDb()
    .select({
      conversationId: conversationFiles.conversationId,
      workspacePath: conversationFiles.workspacePath,
      count: sql<number>`count(*)::integer`,
    })
    .from(conversationFiles)
    .where(isNotNull(conversationFiles.workspacePath))
    .groupBy(conversationFiles.conversationId, conversationFiles.workspacePath)
    .having(sql`count(*) > 1`)
    .limit(1);
  if (duplicates.length > 0) throw new Error("workspace path backfill produced a duplicate conversation path");

  return { conversations: pending.length, files };
}

export async function verifyWorkspacePathBackfill(): Promise<WorkspacePathVerificationResult> {
  const rows = await getDb()
    .select({
      id: conversationFiles.id,
      tenantId: conversationFiles.tenantId,
      workspaceId: conversationFiles.workspaceId,
      assetId: conversationFiles.assetId,
      revisionId: conversationFiles.revisionId,
      sizeBytes: conversationFiles.sizeBytes,
      sha256: conversationFiles.sha256,
      workspacePath: conversationFiles.workspacePath,
    })
    .from(conversationFiles)
    .orderBy(asc(conversationFiles.conversationId), asc(conversationFiles.createdAt), asc(conversationFiles.id));

  let bytes = 0;
  for (const row of rows) {
    if (!row.workspacePath || !isValidWorkspacePath(row.workspacePath)) {
      throw new Error(`conversation file ${row.id} has no valid workspace path`);
    }
    const body = await storageClient().content({
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      assetId: row.assetId,
      revisionId: row.revisionId,
    });
    const hash = createHash("sha256");
    const reader = body.getReader();
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        hash.update(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      if (!body.locked) await body.cancel().catch(() => {});
    }
    if (size !== row.sizeBytes || hash.digest("hex") !== row.sha256) {
      throw new Error(`conversation file ${row.id} content does not match its committed Storage revision`);
    }
    bytes += size;
  }
  return { files: rows.length, bytes };
}
