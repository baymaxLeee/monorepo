import { randomBytes } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { AuthContext } from "../api/http/middleware/auth.js";
import { getDb } from "../infrastructure/persistence/index.js";
import {
  assetClaimIntents,
  sessionFiles,
  sessionFileSaveOperations,
  sessions,
} from "../infrastructure/persistence/schema.js";
import { ConflictError, NotFoundError, RequestError } from "./errors.js";
import { assertEditableFileSize, editableFileByteLimit } from "./file-edit-limits.js";
import { isValidWorkspacePath } from "./workspace-paths.js";

export interface SessionFile {
  id: string;
  session_id: string;
  title: string;
  filename: string;
  workspace_path: string;
  workspace_state: "live" | "deleted";
  path_generation: number;
  mime_type: string;
  size: number;
  asset_id: string;
  revision_id: string;
  sha256: string;
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
  sessionId: string;
};

type ChatTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

function toSessionFile(row: typeof sessionFiles.$inferSelect): SessionFile {
  return {
    id: row.id,
    session_id: row.sessionId,
    title: row.title,
    filename: row.filename,
    workspace_path: row.workspacePath,
    workspace_state: row.workspaceState as SessionFile["workspace_state"],
    path_generation: Number(row.pathGeneration),
    mime_type: row.mediaType,
    size: row.sizeBytes,
    asset_id: row.assetId,
    revision_id: row.revisionId,
    sha256: row.sha256,
    editable: isEditableSessionFile(row.filename, row.mediaType) && row.sizeBytes <= editableFileByteLimit(),
    edit_max_bytes: editableFileByteLimit(),
    etag: formatContentEtag(row.contentEtag),
    last_writer: {
      type: row.lastWriterType as SessionFile["last_writer"]["type"],
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

export function isEditableSessionFile(filename: string, mediaType: string): boolean {
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
    eq(sessions.id, scope.sessionId),
    eq(sessions.userId, scope.userId),
    eq(sessions.tenantId, scope.tenantId),
    eq(sessions.workspaceId, scope.workspaceId),
  );
}

export async function listSessionFiles(scope: FileScope): Promise<SessionFile[]> {
  const rows = await getDb()
    .select({ file: sessionFiles })
    .from(sessionFiles)
    .innerJoin(sessions, eq(sessions.id, sessionFiles.sessionId))
    .where(and(scopeCondition(scope), eq(sessionFiles.workspaceState, "live")))
    .orderBy(asc(sessionFiles.createdAt), asc(sessionFiles.id));
  return rows.map(({ file }) => toSessionFile(file));
}

export async function getSessionFile(
  auth: Pick<AuthContext, "userId" | "tenantId" | "workspaceId">,
  sessionId: string,
  fileId: string,
): Promise<SessionFile> {
  const [row] = await getDb()
    .select({ file: sessionFiles })
    .from(sessionFiles)
    .innerJoin(sessions, eq(sessions.id, sessionFiles.sessionId))
    .where(
      and(
        scopeCondition({ ...auth, sessionId }),
        eq(sessionFiles.id, fileId),
        eq(sessionFiles.userId, auth.userId),
        eq(sessionFiles.tenantId, auth.tenantId),
        eq(sessionFiles.workspaceId, auth.workspaceId),
      ),
    );
  if (!row) throw new NotFoundError(`file ${fileId} not found in session ${sessionId}`);
  return toSessionFile(row.file);
}

export async function publishSessionFile(
  input: FileScope & {
    assetId: string;
    revisionId: string;
    title: string;
    filename: string;
    mediaType: string;
    sizeBytes: number;
    sha256: string;
    idempotencyKey: string;
    workspacePath: string;
    writerType?: "user" | "agent";
    writerId?: string;
  },
): Promise<SessionFile> {
  const db = getDb();
  if (!isValidWorkspacePath(input.workspacePath)) throw new RequestError("invalid session workspace path");
  return db.transaction(async (tx) => {
    const [session] = await tx.select({ id: sessions.id }).from(sessions).where(scopeCondition(input)).for("update");
    if (!session) throw new NotFoundError(`session ${input.sessionId} not found`);
    const [existing] = await tx
      .select()
      .from(sessionFiles)
      .where(
        and(
          eq(sessionFiles.tenantId, input.tenantId),
          eq(sessionFiles.workspaceId, input.workspaceId),
          eq(sessionFiles.userId, input.userId),
          eq(sessionFiles.sessionId, input.sessionId),
          eq(sessionFiles.idempotencyKey, input.idempotencyKey),
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
        existing.sha256 !== input.sha256 ||
        existing.workspacePath !== input.workspacePath
      ) {
        throw new ConflictError("file idempotency key was already used for different content");
      }
      return toSessionFile(existing);
    }

    const now = new Date();
    const [row] = await tx
      .insert(sessionFiles)
      .values({
        id: randomBytes(16).toString("hex"),
        sessionId: input.sessionId,
        userId: input.userId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        assetId: input.assetId,
        revisionId: input.revisionId,
        title: input.title,
        filename: input.filename,
        workspacePath: input.workspacePath,
        mediaType: input.mediaType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
        updatedAt: now,
        contentGeneration: 1n,
        contentEtag: newContentEtag(),
        lastWriterType: input.writerType ?? "agent",
        lastWriterId: input.writerId ?? input.userId,
      })
      .returning();
    if (!row) throw new Error("session file insert returned no row");
    await tx.insert(assetClaimIntents).values({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      ownerType: "session_file",
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
      .update(sessions)
      .set({
        updatedAt: now,
      })
      .where(eq(sessions.id, input.sessionId));
    return toSessionFile(row);
  });
}

export interface SessionFileSaveCandidate {
  assetId: string;
  revisionId: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}

export type SessionFileSaveInput = FileScope & {
  fileId: string;
  expectedEtag: string;
  contentSha256: string;
  operationId: string;
  writerType: "user" | "agent";
  writerId: string;
  workspacePath?: string;
  expectedPathGeneration?: number;
};

type SavePreparation =
  | { kind: "done"; file: SessionFile }
  | { kind: "conflict"; currentEtag: string }
  | { kind: "in_progress" }
  | {
      kind: "upload";
      file: SessionFile;
      storageIdempotencyKey: string;
      storageClaimGeneration: number;
    };

function operationCondition(input: SessionFileSaveInput) {
  return and(
    eq(sessionFileSaveOperations.tenantId, input.tenantId),
    eq(sessionFileSaveOperations.workspaceId, input.workspaceId),
    eq(sessionFileSaveOperations.userId, input.userId),
    eq(sessionFileSaveOperations.sessionId, input.sessionId),
    eq(sessionFileSaveOperations.operationId, input.operationId),
  );
}

function operationMatches(
  operation: typeof sessionFileSaveOperations.$inferSelect,
  input: SessionFileSaveInput,
): boolean {
  return (
    operation.fileId === input.fileId &&
    operation.expectedEtag === input.expectedEtag &&
    operation.contentSha256 === input.contentSha256 &&
    operation.operationType === "update" &&
    operation.writerType === input.writerType &&
    operation.writerId === input.writerId &&
    operation.workspacePath === (input.workspacePath ?? null) &&
    operation.expectedPathGeneration ===
      (input.expectedPathGeneration == null ? null : BigInt(input.expectedPathGeneration))
  );
}

function assertSaveInput(input: SessionFileSaveInput): void {
  if (
    !/^"[a-f0-9]{32}"$/.test(input.expectedEtag) ||
    !/^[a-f0-9]{64}$/.test(input.contentSha256) ||
    input.operationId.length < 1 ||
    input.operationId.length > 80 ||
    input.writerId.length < 1 ||
    input.writerId.length > 128 ||
    (input.workspacePath !== undefined && !isValidWorkspacePath(input.workspacePath)) ||
    (input.expectedPathGeneration !== undefined &&
      (!Number.isSafeInteger(input.expectedPathGeneration) || input.expectedPathGeneration < 1))
  ) {
    throw new RequestError("invalid session file save input");
  }
}

async function prepareSessionFileSave(input: SessionFileSaveInput): Promise<SavePreparation> {
  assertSaveInput(input);
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 2 * 60_000);
  return getDb().transaction(async (tx) => {
    const [session] = await tx.select({ id: sessions.id }).from(sessions).where(scopeCondition(input)).for("update");
    if (!session) throw new NotFoundError(`session ${input.sessionId} not found`);
    const [row] = await tx
      .select()
      .from(sessionFiles)
      .where(
        and(
          eq(sessionFiles.id, input.fileId),
          eq(sessionFiles.sessionId, input.sessionId),
          eq(sessionFiles.userId, input.userId),
          eq(sessionFiles.tenantId, input.tenantId),
          eq(sessionFiles.workspaceId, input.workspaceId),
        ),
      )
      .for("update");
    if (!row) throw new NotFoundError(`file ${input.fileId} not found in session ${input.sessionId}`);
    const workspacePersistence = input.workspacePath !== undefined && input.expectedPathGeneration !== undefined;
    if (!workspacePersistence && !isEditableSessionFile(row.filename, row.mediaType)) {
      throw new RequestError("session file is not editable text");
    }
    if (!workspacePersistence) assertEditableFileSize(row.sizeBytes);
    if (
      workspacePersistence &&
      (row.workspaceState !== "live" ||
        row.workspacePath !== input.workspacePath ||
        row.pathGeneration !== BigInt(input.expectedPathGeneration!))
    ) {
      throw new ConflictError("workspace file path generation changed", "file_content_conflict");
    }

    const [operation] = await tx
      .select()
      .from(sessionFileSaveOperations)
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
        return { kind: "done", file: operation.resultJson as unknown as SessionFile };
      }
      if (operation.status === "conflict") {
        return { kind: "conflict", currentEtag: formatContentEtag(row.contentEtag) };
      }
      if (operation.leaseUntil && operation.leaseUntil > now) return { kind: "in_progress" };
      await tx.update(sessionFileSaveOperations).set({ leaseUntil, updatedAt: now }).where(operationCondition(input));
    } else {
      await tx.insert(sessionFileSaveOperations).values({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        sessionId: input.sessionId,
        operationId: input.operationId,
        fileId: input.fileId,
        expectedEtag: input.expectedEtag,
        contentSha256: input.contentSha256,
        operationType: "update",
        workspacePath: input.workspacePath ?? null,
        expectedPathGeneration: input.expectedPathGeneration == null ? null : BigInt(input.expectedPathGeneration),
        writerType: input.writerType,
        writerId: input.writerId,
        status: "pending",
        leaseUntil,
        resultJson: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    const current = toSessionFile(row);
    if (current.etag !== input.expectedEtag) {
      await tx
        .update(sessionFileSaveOperations)
        .set({ status: "conflict", leaseUntil: null, updatedAt: now })
        .where(operationCondition(input));
      return { kind: "conflict", currentEtag: current.etag };
    }
    if (row.sha256 === input.contentSha256) {
      await tx
        .update(sessionFileSaveOperations)
        .set({ status: "succeeded", leaseUntil: null, resultJson: { ...current }, updatedAt: now })
        .where(operationCondition(input));
      return { kind: "done", file: current };
    }
    const storageClaimGeneration = Number(row.contentGeneration);
    if (!Number.isSafeInteger(storageClaimGeneration) || storageClaimGeneration < 1) {
      throw new Error("session file content generation is outside the supported range");
    }
    return {
      kind: "upload",
      file: current,
      storageIdempotencyKey: `session-file-save:${input.fileId}:${input.operationId}`,
      storageClaimGeneration,
    };
  });
}

async function releaseSaveOperationLease(input: SessionFileSaveInput): Promise<void> {
  await getDb()
    .update(sessionFileSaveOperations)
    .set({ leaseUntil: null, updatedAt: new Date() })
    .where(and(operationCondition(input), eq(sessionFileSaveOperations.status, "pending")));
}

function throwPreparationFailure(preparation: Extract<SavePreparation, { kind: "conflict" | "in_progress" }>): never {
  if (preparation.kind === "in_progress") {
    throw new ConflictError("file save operation is already in progress", "file_save_in_progress");
  }
  throw new ConflictError("session file changed since it was read", "file_content_conflict", {
    current_etag: preparation.currentEtag,
  });
}

export async function saveSessionFile(
  input: SessionFileSaveInput,
  upload: (
    idempotencyKey: string,
    file: SessionFile,
    claim: { ownerType: "session_file"; ownerId: string; slot: "source"; generation: number },
  ) => Promise<SessionFileSaveCandidate>,
): Promise<SessionFile> {
  const preparation = await prepareSessionFileSave(input);
  if (preparation.kind === "done") return preparation.file;
  if (preparation.kind !== "upload") throwPreparationFailure(preparation);

  let candidate: SessionFileSaveCandidate;
  try {
    candidate = await upload(preparation.storageIdempotencyKey, preparation.file, {
      ownerType: "session_file",
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
    (input.workspacePath === undefined && !isEditableSessionFile(candidate.filename, candidate.mediaType)) ||
    candidate.sizeBytes < 0 ||
    candidate.sha256 !== input.contentSha256
  ) {
    await releaseSaveOperationLease(input);
    throw new RequestError("storage returned invalid session file content metadata");
  }
  if (input.workspacePath === undefined) assertEditableFileSize(candidate.sizeBytes);

  const outcome = await getDb().transaction(async (tx) => {
    const [session] = await tx.select({ id: sessions.id }).from(sessions).where(scopeCondition(input)).for("update");
    if (!session) throw new NotFoundError(`session ${input.sessionId} not found`);
    const [row] = await tx
      .select()
      .from(sessionFiles)
      .where(
        and(
          eq(sessionFiles.id, input.fileId),
          eq(sessionFiles.sessionId, input.sessionId),
          eq(sessionFiles.userId, input.userId),
          eq(sessionFiles.tenantId, input.tenantId),
          eq(sessionFiles.workspaceId, input.workspaceId),
        ),
      )
      .for("update");
    if (!row) throw new NotFoundError(`file ${input.fileId} not found in session ${input.sessionId}`);
    const [operation] = await tx
      .select()
      .from(sessionFileSaveOperations)
      .where(operationCondition(input))
      .for("update");
    if (!operation || !operationMatches(operation, input)) {
      throw new ConflictError("file save operation is unavailable", "file_save_operation_conflict");
    }
    if (operation.status === "succeeded" && operation.resultJson) {
      return { kind: "done" as const, file: operation.resultJson as unknown as SessionFile };
    }
    if (
      operation.status === "conflict" ||
      formatContentEtag(row.contentEtag) !== input.expectedEtag ||
      (input.workspacePath !== undefined &&
        (row.workspaceState !== "live" ||
          row.workspacePath !== input.workspacePath ||
          row.pathGeneration !== BigInt(input.expectedPathGeneration!)))
    ) {
      await tx
        .update(sessionFileSaveOperations)
        .set({ status: "conflict", leaseUntil: null, updatedAt: new Date() })
        .where(operationCondition(input));
      return { kind: "conflict" as const, currentEtag: formatContentEtag(row.contentEtag) };
    }

    const now = new Date();
    const nextGeneration = row.contentGeneration + 1n;
    const [updated] = await tx
      .update(sessionFiles)
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
      .where(eq(sessionFiles.id, input.fileId))
      .returning();
    if (!updated) throw new Error("session file update returned no row");
    const file = toSessionFile(updated);
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
          eq(assetClaimIntents.ownerType, "session_file"),
          eq(assetClaimIntents.ownerId, input.fileId),
          eq(assetClaimIntents.slot, "source"),
        ),
      )
      .returning({ ownerId: assetClaimIntents.ownerId });
    if (claimRows.length !== 1) throw new Error("session file claim intent is missing");
    await tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, input.sessionId));
    await tx
      .update(sessionFileSaveOperations)
      .set({ status: "succeeded", leaseUntil: null, resultJson: { ...file }, updatedAt: now })
      .where(operationCondition(input));
    return { kind: "done" as const, file };
  });
  if (outcome.kind === "conflict") throwPreparationFailure(outcome);
  return outcome.file;
}

export async function deleteWorkspaceSessionFile(
  input: FileScope & {
    fileId: string;
    workspacePath: string;
    expectedPathGeneration: number;
    expectedEtag: string;
    writerId: string;
  },
): Promise<void> {
  if (!isValidWorkspacePath(input.workspacePath) || !Number.isSafeInteger(input.expectedPathGeneration)) {
    throw new RequestError("invalid workspace deletion input");
  }
  await getDb().transaction(async (tx) => {
    const [session] = await tx.select({ id: sessions.id }).from(sessions).where(scopeCondition(input)).for("update");
    if (!session) throw new NotFoundError(`session ${input.sessionId} not found`);
    const [row] = await tx
      .select()
      .from(sessionFiles)
      .where(
        and(
          eq(sessionFiles.id, input.fileId),
          eq(sessionFiles.sessionId, input.sessionId),
          eq(sessionFiles.userId, input.userId),
          eq(sessionFiles.tenantId, input.tenantId),
          eq(sessionFiles.workspaceId, input.workspaceId),
        ),
      )
      .for("update");
    if (!row) throw new NotFoundError(`file ${input.fileId} not found in session ${input.sessionId}`);
    if (row.workspaceState === "deleted" && row.pathGeneration > BigInt(input.expectedPathGeneration)) return;
    if (
      row.workspaceState !== "live" ||
      row.workspacePath !== input.workspacePath ||
      row.pathGeneration !== BigInt(input.expectedPathGeneration) ||
      formatContentEtag(row.contentEtag) !== input.expectedEtag
    ) {
      throw new ConflictError("workspace file changed before deletion", "file_content_conflict");
    }
    const now = new Date();
    await tx
      .update(sessionFiles)
      .set({
        workspaceState: "deleted",
        pathGeneration: row.pathGeneration + 1n,
        updatedAt: now,
        lastWriterType: "agent",
        lastWriterId: input.writerId,
      })
      .where(eq(sessionFiles.id, input.fileId));
    await tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, input.sessionId));
  });
}

export async function releaseSessionFileClaims(tx: ChatTransaction, scope: FileScope): Promise<void> {
  const rows = await tx
    .select({ id: sessionFiles.id })
    .from(sessionFiles)
    .where(
      and(
        eq(sessionFiles.sessionId, scope.sessionId),
        eq(sessionFiles.userId, scope.userId),
        eq(sessionFiles.tenantId, scope.tenantId),
        eq(sessionFiles.workspaceId, scope.workspaceId),
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
        eq(assetClaimIntents.ownerType, "session_file"),
        inArray(
          assetClaimIntents.ownerId,
          rows.map((row) => row.id),
        ),
      ),
    );
}

export async function forkSessionFileRows(
  tx: ChatTransaction,
  input: FileScope & {
    sourceSessionId: string;
    now: Date;
  },
): Promise<Record<string, string>> {
  const sourceFiles = await tx
    .select()
    .from(sessionFiles)
    .where(
      and(
        eq(sessionFiles.sessionId, input.sourceSessionId),
        eq(sessionFiles.userId, input.userId),
        eq(sessionFiles.tenantId, input.tenantId),
        eq(sessionFiles.workspaceId, input.workspaceId),
      ),
    )
    .orderBy(asc(sessionFiles.createdAt), asc(sessionFiles.id));
  const fileIds = Object.fromEntries(sourceFiles.map((file) => [file.id, randomBytes(16).toString("hex")]));
  if (sourceFiles.length === 0) return fileIds;

  await tx.insert(sessionFiles).values(
    sourceFiles.map((file) => ({
      id: fileIds[file.id]!,
      sessionId: input.sessionId,
      userId: input.userId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      assetId: file.assetId,
      revisionId: file.revisionId,
      title: file.title,
      filename: file.filename,
      workspacePath: file.workspacePath,
      workspaceState: file.workspaceState,
      pathGeneration: file.pathGeneration,
      mediaType: file.mediaType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      idempotencyKey: `fork:${input.sessionId}:${file.id}`,
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
      ownerType: "session_file",
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
  return fileIds;
}
