import { randomBytes } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { AuthContext } from "../api/http/middleware/auth.js";
import { getDb } from "../infrastructure/persistence/index.js";
import {
  assetClaimIntents,
  conversationFiles,
  conversationFileSaveOperations,
  conversations,
} from "../infrastructure/persistence/schema.js";
import { ConflictError, NotFoundError, RequestError } from "./errors.js";
import { assertEditableFileSize, editableFileByteLimit } from "./file-edit-limits.js";

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
  editable: boolean;
  edit_max_bytes: number;
  etag: string;
  last_writer: { type: "unknown" | "user" | "agent"; id: string | null };
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
    editable: isEditableConversationFile(row.filename, row.mediaType) && row.sizeBytes <= editableFileByteLimit(),
    edit_max_bytes: editableFileByteLimit(),
    etag: formatContentEtag(row.contentEtag),
    last_writer: {
      type: row.lastWriterType as ConversationFile["last_writer"]["type"],
      id: row.lastWriterId,
    },
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

const EDITABLE_EXTENSIONS = new Set([
  "css",
  "go",
  "htm",
  "html",
  "js",
  "json",
  "jsx",
  "md",
  "markdown",
  "mjs",
  "cjs",
  "py",
  "rs",
  "ts",
  "tsx",
  "txt",
  "yaml",
  "yml",
]);

function normalizedMediaType(value: string): string {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

export function isEditableConversationFile(filename: string, mediaType: string): boolean {
  const extension = filename.toLowerCase().split(".").at(-1) ?? "";
  const mime = normalizedMediaType(mediaType);
  const textLikeMime = mime.startsWith("text/") || mime === "application/json" || mime === "application/yaml";
  return EDITABLE_EXTENSIONS.has(extension) && textLikeMime;
}

function formatContentEtag(token: string): string {
  return `"${token}"`;
}

function newContentEtag(): string {
  return randomBytes(16).toString("hex");
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
        updatedAt: now,
        contentGeneration: 1n,
        contentEtag: newContentEtag(),
        lastWriterType: "agent",
        lastWriterId: input.userId,
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

export interface ConversationFileSaveCandidate {
  assetId: string;
  revisionId: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}

export type ConversationFileSaveInput = FileScope & {
  fileId: string;
  expectedEtag: string;
  contentSha256: string;
  operationId: string;
  writerType: "user" | "agent";
  writerId: string;
};

type SavePreparation =
  | { kind: "done"; file: ConversationFile }
  | { kind: "conflict"; currentEtag: string }
  | { kind: "in_progress" }
  | {
      kind: "upload";
      file: ConversationFile;
      storageIdempotencyKey: string;
      storageClaimGeneration: number;
    };

function operationCondition(input: ConversationFileSaveInput) {
  return and(
    eq(conversationFileSaveOperations.tenantId, input.tenantId),
    eq(conversationFileSaveOperations.workspaceId, input.workspaceId),
    eq(conversationFileSaveOperations.userId, input.userId),
    eq(conversationFileSaveOperations.conversationId, input.conversationId),
    eq(conversationFileSaveOperations.operationId, input.operationId),
  );
}

function operationMatches(
  operation: typeof conversationFileSaveOperations.$inferSelect,
  input: ConversationFileSaveInput,
): boolean {
  return (
    operation.fileId === input.fileId &&
    operation.expectedEtag === input.expectedEtag &&
    operation.contentSha256 === input.contentSha256 &&
    operation.operationType === "update" &&
    operation.writerType === input.writerType &&
    operation.writerId === input.writerId
  );
}

function assertSaveInput(input: ConversationFileSaveInput): void {
  if (
    !/^"[a-f0-9]{32}"$/.test(input.expectedEtag) ||
    !/^[a-f0-9]{64}$/.test(input.contentSha256) ||
    input.operationId.length < 1 ||
    input.operationId.length > 80 ||
    input.writerId.length < 1 ||
    input.writerId.length > 128
  ) {
    throw new RequestError("invalid conversation file save input");
  }
}

async function prepareConversationFileSave(input: ConversationFileSaveInput): Promise<SavePreparation> {
  assertSaveInput(input);
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 2 * 60_000);
  return getDb().transaction(async (tx) => {
    const [conversation] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(scopeCondition(input))
      .for("update");
    if (!conversation) throw new NotFoundError(`conversation ${input.conversationId} not found`);

    const [row] = await tx
      .select()
      .from(conversationFiles)
      .where(
        and(
          eq(conversationFiles.id, input.fileId),
          eq(conversationFiles.conversationId, input.conversationId),
          eq(conversationFiles.userId, input.userId),
          eq(conversationFiles.tenantId, input.tenantId),
          eq(conversationFiles.workspaceId, input.workspaceId),
        ),
      )
      .for("update");
    if (!row) throw new NotFoundError(`file ${input.fileId} not found in conversation ${input.conversationId}`);
    if (!isEditableConversationFile(row.filename, row.mediaType)) {
      throw new RequestError("conversation file is not editable text");
    }
    assertEditableFileSize(row.sizeBytes);

    const [operation] = await tx
      .select()
      .from(conversationFileSaveOperations)
      .where(operationCondition(input))
      .for("update");
    if (operation) {
      if (!operationMatches(operation, input)) {
        throw new ConflictError(
          "file save operation id was already used for a different request",
          "file_save_operation_conflict",
        );
      }
      if (operation.status === "succeeded" && operation.resultJson) {
        return { kind: "done", file: operation.resultJson as unknown as ConversationFile };
      }
      if (operation.status === "conflict") {
        return { kind: "conflict", currentEtag: formatContentEtag(row.contentEtag) };
      }
      if (operation.leaseUntil && operation.leaseUntil > now) return { kind: "in_progress" };
      await tx
        .update(conversationFileSaveOperations)
        .set({ leaseUntil, updatedAt: now })
        .where(operationCondition(input));
    } else {
      await tx.insert(conversationFileSaveOperations).values({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        conversationId: input.conversationId,
        operationId: input.operationId,
        fileId: input.fileId,
        expectedEtag: input.expectedEtag,
        contentSha256: input.contentSha256,
        operationType: "update",
        writerType: input.writerType,
        writerId: input.writerId,
        status: "pending",
        leaseUntil,
        resultJson: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    const current = toConversationFile(row);
    if (current.etag !== input.expectedEtag) {
      await tx
        .update(conversationFileSaveOperations)
        .set({ status: "conflict", leaseUntil: null, updatedAt: now })
        .where(operationCondition(input));
      return { kind: "conflict", currentEtag: current.etag };
    }
    if (row.sha256 === input.contentSha256) {
      await tx
        .update(conversationFileSaveOperations)
        .set({ status: "succeeded", leaseUntil: null, resultJson: { ...current }, updatedAt: now })
        .where(operationCondition(input));
      return { kind: "done", file: current };
    }
    const storageClaimGeneration = Number(row.contentGeneration);
    if (!Number.isSafeInteger(storageClaimGeneration) || storageClaimGeneration < 1) {
      throw new Error("conversation file content generation is outside the supported range");
    }
    return {
      kind: "upload",
      file: current,
      storageIdempotencyKey: `conversation-file-save:${input.fileId}:${input.operationId}`,
      storageClaimGeneration,
    };
  });
}

async function releaseSaveOperationLease(input: ConversationFileSaveInput): Promise<void> {
  await getDb()
    .update(conversationFileSaveOperations)
    .set({ leaseUntil: null, updatedAt: new Date() })
    .where(and(operationCondition(input), eq(conversationFileSaveOperations.status, "pending")));
}

function throwPreparationFailure(preparation: Extract<SavePreparation, { kind: "conflict" | "in_progress" }>): never {
  if (preparation.kind === "in_progress") {
    throw new ConflictError("file save operation is already in progress", "file_save_in_progress");
  }
  throw new ConflictError("conversation file changed since it was read", "file_content_conflict", {
    current_etag: preparation.currentEtag,
  });
}

export async function saveConversationFile(
  input: ConversationFileSaveInput,
  upload: (
    idempotencyKey: string,
    file: ConversationFile,
    claim: { ownerType: "conversation_file"; ownerId: string; slot: "source"; generation: number },
  ) => Promise<ConversationFileSaveCandidate>,
): Promise<ConversationFile> {
  const preparation = await prepareConversationFileSave(input);
  if (preparation.kind === "done") return preparation.file;
  if (preparation.kind !== "upload") throwPreparationFailure(preparation);

  let candidate: ConversationFileSaveCandidate;
  try {
    candidate = await upload(preparation.storageIdempotencyKey, preparation.file, {
      ownerType: "conversation_file",
      ownerId: preparation.file.id,
      slot: "source",
      generation: preparation.storageClaimGeneration,
    });
  } catch (error) {
    await releaseSaveOperationLease(input).catch(() => {});
    throw error;
  }
  if (
    !candidate.assetId ||
    candidate.assetId !== preparation.file.asset_id ||
    !candidate.revisionId ||
    candidate.filename !== preparation.file.filename ||
    !isEditableConversationFile(candidate.filename, candidate.mediaType) ||
    candidate.sizeBytes < 0 ||
    candidate.sha256 !== input.contentSha256
  ) {
    await releaseSaveOperationLease(input);
    throw new RequestError("storage returned invalid conversation file content metadata");
  }
  assertEditableFileSize(candidate.sizeBytes);

  const outcome = await getDb().transaction(async (tx) => {
    const [conversation] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(scopeCondition(input))
      .for("update");
    if (!conversation) throw new NotFoundError(`conversation ${input.conversationId} not found`);
    const [row] = await tx
      .select()
      .from(conversationFiles)
      .where(
        and(
          eq(conversationFiles.id, input.fileId),
          eq(conversationFiles.conversationId, input.conversationId),
          eq(conversationFiles.userId, input.userId),
          eq(conversationFiles.tenantId, input.tenantId),
          eq(conversationFiles.workspaceId, input.workspaceId),
        ),
      )
      .for("update");
    if (!row) throw new NotFoundError(`file ${input.fileId} not found in conversation ${input.conversationId}`);
    const [operation] = await tx
      .select()
      .from(conversationFileSaveOperations)
      .where(operationCondition(input))
      .for("update");
    if (!operation || !operationMatches(operation, input)) {
      throw new ConflictError("file save operation is unavailable", "file_save_operation_conflict");
    }
    if (operation.status === "succeeded" && operation.resultJson) {
      return { kind: "done" as const, file: operation.resultJson as unknown as ConversationFile };
    }
    if (operation.status === "conflict" || formatContentEtag(row.contentEtag) !== input.expectedEtag) {
      await tx
        .update(conversationFileSaveOperations)
        .set({ status: "conflict", leaseUntil: null, updatedAt: new Date() })
        .where(operationCondition(input));
      return { kind: "conflict" as const, currentEtag: formatContentEtag(row.contentEtag) };
    }

    const now = new Date();
    const nextGeneration = row.contentGeneration + 1n;
    const [updated] = await tx
      .update(conversationFiles)
      .set({
        revisionId: candidate.revisionId,
        sizeBytes: candidate.sizeBytes,
        sha256: candidate.sha256,
        updatedAt: now,
        contentGeneration: nextGeneration,
        contentEtag: newContentEtag(),
        lastWriterType: input.writerType,
        lastWriterId: input.writerId,
      })
      .where(eq(conversationFiles.id, input.fileId))
      .returning();
    if (!updated) throw new Error("conversation file update returned no row");
    const file = toConversationFile(updated);
    const claimRows = await tx
      .update(assetClaimIntents)
      .set({
        revisionId: candidate.revisionId,
        generation: nextGeneration,
        desiredState: "active",
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
          eq(assetClaimIntents.tenantId, input.tenantId),
          eq(assetClaimIntents.workspaceId, input.workspaceId),
          eq(assetClaimIntents.ownerType, "conversation_file"),
          eq(assetClaimIntents.ownerId, input.fileId),
          eq(assetClaimIntents.slot, "source"),
        ),
      )
      .returning({ ownerId: assetClaimIntents.ownerId });
    if (claimRows.length !== 1) throw new Error("conversation file claim intent is missing");
    await tx.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, input.conversationId));
    await tx
      .update(conversationFileSaveOperations)
      .set({ status: "succeeded", leaseUntil: null, resultJson: { ...file }, updatedAt: now })
      .where(operationCondition(input));
    return { kind: "done" as const, file };
  });
  if (outcome.kind === "conflict") throwPreparationFailure(outcome);
  return outcome.file;
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
      updatedAt: input.now,
      contentGeneration: 1n,
      contentEtag: newContentEtag(),
      lastWriterType: file.lastWriterType,
      lastWriterId: file.lastWriterId,
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
