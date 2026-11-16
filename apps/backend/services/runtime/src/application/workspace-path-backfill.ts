import { createHash } from "node:crypto";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { storageClient } from "../infrastructure/clients/storage.js";
import { getDb } from "../infrastructure/persistence/index.js";
import {
  assetClaimIntents,
  sessionFiles,
  sessionFileSaveOperations,
  sessionRunLeases,
} from "../infrastructure/persistence/schema.js";
import { allocateLegacyWorkspacePaths, isValidWorkspacePath } from "./workspace-paths.js";

export interface WorkspacePathBackfillResult {
  sessions: number;
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
      .from(sessionRunLeases),
    getDb()
      .select({ count: sql<number>`count(*)::integer` })
      .from(sessionFileSaveOperations)
      .where(eq(sessionFileSaveOperations.status, "pending")),
    getDb()
      .select({ count: sql<number>`count(*)::integer` })
      .from(assetClaimIntents)
      .where(and(eq(assetClaimIntents.ownerType, "session_file"), isNull(assetClaimIntents.deliveredAt))),
  ]);
  if ((activeRuns[0]?.count ?? 0) > 0 || (pendingSaves[0]?.count ?? 0) > 0 || (pendingClaims[0]?.count ?? 0) > 0) {
    throw new Error("workspace path backfill requires no active runs, pending file saves, or undelivered file claims");
  }
}

export async function backfillWorkspacePaths(): Promise<WorkspacePathBackfillResult> {
  await assertBackfillQuiescent();
  const pending = await getDb()
    .selectDistinct({ sessionId: sessionFiles.sessionId })
    .from(sessionFiles)
    .where(isNull(sessionFiles.workspacePath))
    .orderBy(asc(sessionFiles.sessionId));

  let files = 0;
  for (const { sessionId } of pending) {
    files += await getDb().transaction(async (tx) => {
      const rows = await tx
        .select({
          id: sessionFiles.id,
          filename: sessionFiles.filename,
          createdAt: sessionFiles.createdAt,
          workspacePath: sessionFiles.workspacePath,
        })
        .from(sessionFiles)
        .where(eq(sessionFiles.sessionId, sessionId))
        .orderBy(asc(sessionFiles.createdAt), asc(sessionFiles.id))
        .for("update");

      const unassigned = rows.filter((row) => row.workspacePath == null);
      if (unassigned.length === 0) return 0;
      if (unassigned.length !== rows.length) {
        throw new Error(`session ${sessionId} has a partial workspace path backfill`);
      }

      const allocations = allocateLegacyWorkspacePaths(unassigned);
      for (const allocation of allocations) {
        if (!isValidWorkspacePath(allocation.workspacePath)) {
          throw new Error(`workspace path allocation for file ${allocation.id} is invalid`);
        }
        const updated = await tx
          .update(sessionFiles)
          .set({ workspacePath: allocation.workspacePath })
          .where(
            and(
              eq(sessionFiles.sessionId, sessionId),
              eq(sessionFiles.id, allocation.id),
              isNull(sessionFiles.workspacePath),
            ),
          )
          .returning({ id: sessionFiles.id });
        if (updated.length !== 1) throw new Error(`workspace path backfill lost file ${allocation.id}`);
      }
      return allocations.length;
    });
  }

  const [remaining] = await getDb()
    .select({ count: sql<number>`count(*)::integer` })
    .from(sessionFiles)
    .where(isNull(sessionFiles.workspacePath));
  if ((remaining?.count ?? 0) !== 0) throw new Error("workspace path backfill did not cover every session file");

  const duplicates = await getDb()
    .select({
      sessionId: sessionFiles.sessionId,
      workspacePath: sessionFiles.workspacePath,
      count: sql<number>`count(*)::integer`,
    })
    .from(sessionFiles)
    .where(isNotNull(sessionFiles.workspacePath))
    .groupBy(sessionFiles.sessionId, sessionFiles.workspacePath)
    .having(sql`count(*) > 1`)
    .limit(1);
  if (duplicates.length > 0) throw new Error("workspace path backfill produced a duplicate session path");

  return { sessions: pending.length, files };
}

export async function verifyWorkspacePathBackfill(): Promise<WorkspacePathVerificationResult> {
  const rows = await getDb()
    .select({
      id: sessionFiles.id,
      tenantId: sessionFiles.tenantId,
      workspaceId: sessionFiles.workspaceId,
      assetId: sessionFiles.assetId,
      revisionId: sessionFiles.revisionId,
      sizeBytes: sessionFiles.sizeBytes,
      sha256: sessionFiles.sha256,
      workspacePath: sessionFiles.workspacePath,
    })
    .from(sessionFiles)
    .orderBy(asc(sessionFiles.sessionId), asc(sessionFiles.createdAt), asc(sessionFiles.id));

  let bytes = 0;
  for (const row of rows) {
    if (!row.workspacePath || !isValidWorkspacePath(row.workspacePath)) {
      throw new Error(`session file ${row.id} has no valid workspace path`);
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
      throw new Error(`session file ${row.id} content does not match its committed Storage revision`);
    }
    bytes += size;
  }
  return { files: rows.length, bytes };
}
