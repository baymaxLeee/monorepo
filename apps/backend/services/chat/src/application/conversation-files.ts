import { randomBytes } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { AuthContext } from "../api/http/middleware/auth.js";
import { getDb } from "../infrastructure/persistence/index.js";
import { assetClaimIntents, conversationFiles, conversations } from "../infrastructure/persistence/schema.js";
import { ConflictError, NotFoundError } from "./errors.js";

export interface ConversationFile {
  id: string;
  conversation_id: string;
  title: string;
  filename: string;
  mime_type: string;
  size: number;
  asset_id: string;
  revision_id: string;
  sha256: string;
  kind: "artifact" | "plan";
  created_at: string;
  updated_at: string;
}

type FileScope = {
  userId: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
};

type ChatTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

function toConversationFile(row: typeof conversationFiles.$inferSelect): ConversationFile {
  const createdAt = row.createdAt.toISOString();
  return {
    id: row.id,
    conversation_id: row.conversationId,
    title: row.title,
    filename: row.filename,
    mime_type: row.mediaType,
    size: row.sizeBytes,
    asset_id: row.assetId,
    revision_id: row.revisionId,
    sha256: row.sha256,
    kind: row.kind as ConversationFile["kind"],
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function scopeCondition(scope: FileScope) {
  return and(
    eq(conversations.id, scope.conversationId),
    eq(conversations.userId, scope.userId),
    eq(conversations.tenantId, scope.tenantId),
    eq(conversations.workspaceId, scope.workspaceId),
  );
}

export async function listConversationFiles(scope: FileScope): Promise<ConversationFile[]> {
  const rows = await getDb()
    .select({ file: conversationFiles })
    .from(conversationFiles)
    .innerJoin(conversations, eq(conversations.id, conversationFiles.conversationId))
    .where(scopeCondition(scope))
    .orderBy(asc(conversationFiles.createdAt), asc(conversationFiles.id));
  return rows.map(({ file }) => toConversationFile(file));
}

export async function getConversationFile(
  auth: Pick<AuthContext, "userId" | "tenantId" | "workspaceId">,
  conversationId: string,
  fileId: string,
): Promise<ConversationFile> {
  const [row] = await getDb()
    .select({ file: conversationFiles })
    .from(conversationFiles)
    .innerJoin(conversations, eq(conversations.id, conversationFiles.conversationId))
    .where(
      and(
        scopeCondition({ ...auth, conversationId }),
        eq(conversationFiles.id, fileId),
        eq(conversationFiles.userId, auth.userId),
        eq(conversationFiles.tenantId, auth.tenantId),
        eq(conversationFiles.workspaceId, auth.workspaceId),
      ),
    );
  if (!row) throw new NotFoundError(`file ${fileId} not found in conversation ${conversationId}`);
  return toConversationFile(row.file);
}

export async function publishConversationFile(
  input: FileScope & {
    assetId: string;
    revisionId: string;
    title: string;
    filename: string;
    mediaType: string;
    sizeBytes: number;
    sha256: string;
    idempotencyKey: string;
  },
): Promise<ConversationFile> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(scopeCondition(input))
      .for("update");
    if (!conversation) throw new NotFoundError(`conversation ${input.conversationId} not found`);

    const [existing] = await tx
      .select()
      .from(conversationFiles)
      .where(
        and(
          eq(conversationFiles.tenantId, input.tenantId),
          eq(conversationFiles.workspaceId, input.workspaceId),
          eq(conversationFiles.userId, input.userId),
          eq(conversationFiles.conversationId, input.conversationId),
          eq(conversationFiles.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing) {
      if (
        existing.assetId !== input.assetId ||
        existing.revisionId !== input.revisionId ||
        existing.title !== input.title ||
        existing.filename !== input.filename ||
        existing.mediaType !== input.mediaType ||
        existing.sizeBytes !== input.sizeBytes ||
        existing.sha256 !== input.sha256
      ) {
        throw new ConflictError("file idempotency key was already used for different content");
      }
      return toConversationFile(existing);
    }

    const now = new Date();
    const kind = input.filename.toLowerCase().endsWith("-plan.md") ? "plan" : "artifact";
    const [row] = await tx
      .insert(conversationFiles)
      .values({
        id: randomBytes(16).toString("hex"),
        conversationId: input.conversationId,
        userId: input.userId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        assetId: input.assetId,
        revisionId: input.revisionId,
        title: input.title,
        filename: input.filename,
        mediaType: input.mediaType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        kind,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      })
      .returning();
    if (!row) throw new Error("conversation file insert returned no row");
    await tx.insert(assetClaimIntents).values({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      ownerType: "conversation_file",
      ownerId: row.id,
      slot: "source",
      assetId: input.assetId,
      revisionId: input.revisionId,
      kind: "strong",
      generation: 1n,
      desiredState: "active",
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await tx
      .update(conversations)
      .set({
        updatedAt: now,
        ...(kind === "plan" ? { activePlanFileId: row.id } : {}),
      })
      .where(eq(conversations.id, input.conversationId));
    return toConversationFile(row);
  });
}

export async function releaseConversationFileClaims(tx: ChatTransaction, scope: FileScope): Promise<void> {
  const rows = await tx
    .select({ id: conversationFiles.id })
    .from(conversationFiles)
    .where(
      and(
        eq(conversationFiles.conversationId, scope.conversationId),
        eq(conversationFiles.userId, scope.userId),
        eq(conversationFiles.tenantId, scope.tenantId),
        eq(conversationFiles.workspaceId, scope.workspaceId),
      ),
    )
    .for("update");
  if (rows.length === 0) return;
  const now = new Date();
  await tx
    .update(assetClaimIntents)
    .set({
      desiredState: "released",
      deliveredAt: null,
      attemptCount: 0,
      nextAttemptAt: now,
      leaseUntil: null,
      stateVersion: sql`${assetClaimIntents.stateVersion} + 1`,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(assetClaimIntents.tenantId, scope.tenantId),
        eq(assetClaimIntents.workspaceId, scope.workspaceId),
        eq(assetClaimIntents.ownerType, "conversation_file"),
        inArray(
          assetClaimIntents.ownerId,
          rows.map((row) => row.id),
        ),
      ),
    );
}

export async function forkConversationFileRows(
  tx: ChatTransaction,
  input: FileScope & {
    sourceConversationId: string;
    sourceActivePlanFileId: string | null;
    now: Date;
  },
): Promise<Record<string, string>> {
  const sourceFiles = await tx
    .select()
    .from(conversationFiles)
    .where(
      and(
        eq(conversationFiles.conversationId, input.sourceConversationId),
        eq(conversationFiles.userId, input.userId),
        eq(conversationFiles.tenantId, input.tenantId),
        eq(conversationFiles.workspaceId, input.workspaceId),
      ),
    )
    .orderBy(asc(conversationFiles.createdAt), asc(conversationFiles.id));
  const fileIds = Object.fromEntries(sourceFiles.map((file) => [file.id, randomBytes(16).toString("hex")]));
  if (sourceFiles.length === 0) return fileIds;

  await tx.insert(conversationFiles).values(
    sourceFiles.map((file) => ({
      id: fileIds[file.id]!,
      conversationId: input.conversationId,
      userId: input.userId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      assetId: file.assetId,
      revisionId: file.revisionId,
      title: file.title,
      filename: file.filename,
      mediaType: file.mediaType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      kind: file.kind,
      idempotencyKey: `fork:${input.conversationId}:${file.id}`,
      createdAt: input.now,
    })),
  );
  await tx.insert(assetClaimIntents).values(
    sourceFiles.map((file) => ({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      ownerType: "conversation_file",
      ownerId: fileIds[file.id]!,
      slot: "source",
      assetId: file.assetId,
      revisionId: file.revisionId,
      kind: "strong",
      generation: 1n,
      desiredState: "active",
      nextAttemptAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  );
  const activePlanFileId = input.sourceActivePlanFileId ? fileIds[input.sourceActivePlanFileId] : undefined;
  if (activePlanFileId) {
    await tx.update(conversations).set({ activePlanFileId }).where(eq(conversations.id, input.conversationId));
  }
  return fileIds;
}
