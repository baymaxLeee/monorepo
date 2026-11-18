import { createHash, randomBytes } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";

import type { AuthContext } from "../api/http/middleware/auth.js";
import {
  getDocument,
  getWorkspaceDocument,
  knowledgeDocumentSessionId,
  listDocuments,
  updateArtifact,
  type KnowledgeDocument,
} from "../infrastructure/clients/knowledge.js";
import { storageClient } from "../infrastructure/clients/storage.js";
import { getDb } from "../infrastructure/persistence/index.js";
import {
  agentRuns,
  sessionArtifactCleanupOutbox,
  sessionRunLeases,
  sessions,
  messages,
  type PersistedMessageContent,
} from "../infrastructure/persistence/schema.js";
import { coordinateCloudWorkspaceUserEdit } from "./cloud-workspace-edit.js";
import { ConflictError, NotFoundError } from "./errors.js";
import type { ReasoningEffort } from "../infrastructure/provider/provider-model.js";
import { getSessionFile, releaseSessionFileClaims, saveSessionFile } from "./session-files.js";

export { getSessionFile } from "./session-files.js";
import { assertEditableFileSize } from "./file-edit-limits.js";

export async function updateSessionFileContent(
  auth: Pick<AuthContext, "userId" | "tenantId" | "workspaceId">,
  sessionId: string,
  fileId: string,
  input: { content: string; expectedEtag: string; operationId: string; signal?: AbortSignal },
) {
  assertEditableFileSize(Buffer.byteLength(input.content, "utf8"));
  const bytes = new TextEncoder().encode(input.content);
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  return coordinateCloudWorkspaceUserEdit(
    {
      ...auth,
      sessionId,
      fileId,
      expectedEtag: input.expectedEtag,
      operationId: input.operationId,
      content: bytes,
      signal: input.signal,
    },
    () =>
      saveSessionFile(
        {
          ...auth,
          sessionId,
          fileId,
          expectedEtag: input.expectedEtag,
          contentSha256,
          operationId: input.operationId,
          writerType: "user",
          writerId: auth.userId,
        },
        async (idempotencyKey, file, claim) => {
          const client = storageClient();
          const claimInput = {
            tenantId: auth.tenantId,
            workspaceId: auth.workspaceId,
            ...claim,
          };
          await client.prepareClaim({
            ...claimInput,
            assetId: file.asset_id,
            revisionId: file.revision_id,
            kind: "strong",
          });
          await client.activateClaim(claimInput);
          return client.appendRevision({
            ...claimInput,
            userId: auth.userId,
            assetId: file.asset_id,
            baseRevisionId: file.revision_id,
            filename: file.filename,
            mediaType: file.mime_type,
            body: bytes,
            contentLength: bytes.byteLength,
            idempotencyKey,
            signal: input.signal,
          });
        },
      ),
  );
}

export interface Session {
  id: string;
  user_id: string;
  tenant_id: string;
  workspace_id: string;
  model: string;
  provider_id: string;
  reasoning_effort: ReasoningEffort;
  created_at: string;
  updated_at: string;
  revision: number;
  selected_message_id: string | null;
}

export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: PersistedMessageContent;
  status: "ok" | "streaming" | "failed";
  parent_message_id: string | null;
  branch_index: number;
  created_at: string;
}

export interface MessageBranchCandidate {
  message_id: string;
  leaf_message_id: string;
  role: Message["role"];
  created_at: string;
}

export interface MessageBranchGroup {
  parent_message_id: string | null;
  selected_message_id: string;
  candidates: MessageBranchCandidate[];
}

export function mapKnowledgeDocument(doc: KnowledgeDocument, sessionId: string) {
  return {
    id: doc.id,
    session_id: knowledgeDocumentSessionId(doc) ?? sessionId,
    kind: doc.kind,
    editable_source: doc.editable_source,
    title: doc.title,
    filename: doc.filename,
    mime_type: doc.mime_type,
    source_size: doc.source_size,
    source_mime_type: doc.source_mime_type,
    asset_id: doc.asset_id ?? null,
    source_revision_id: doc.source_revision_id ?? null,
    source_sha256: doc.source_sha256 ?? null,
    source_filename: doc.source_filename ?? null,
    ingest_status: doc.ingest_status,
    ingest_progress: doc.ingest_progress,
    ingest_error: doc.ingest_error ?? null,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

export interface SessionDocument {
  id: string;
  session_id: string;
  kind: "source" | "artifact";
  editable_source: boolean;
  title: string;
  filename: string;
  mime_type: string;
  source_size: number;
  source_mime_type: string | null;
  asset_id: string | null;
  source_revision_id: string | null;
  source_sha256: string | null;
  source_filename: string | null;
  ingest_status: string;
  ingest_progress: number;
  ingest_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionDocumentDetail extends SessionDocument {
  content_md: string;
}

export interface SessionDetail extends Session {
  messages: Message[];
  branches: MessageBranchGroup[];
  documents: SessionDocument[];
  active_run_id: string | null;
  latest_run_id: string | null;
}

function iso(d: Date): string {
  return d.toISOString().replace("+00:00", "Z");
}

function toSession(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    user_id: row.userId,
    tenant_id: row.tenantId,
    workspace_id: row.workspaceId,
    model: row.model,
    provider_id: row.providerId,
    reasoning_effort: row.reasoningEffort as ReasoningEffort,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    revision: Number(row.historyRevision),
    selected_message_id: row.selectedMessageId,
  };
}

function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    session_id: row.sessionId,
    role: row.role as Message["role"],
    content: row.content,
    status: row.status as Message["status"],
    parent_message_id: row.parentMessageId,
    branch_index: row.branchIndex,
    created_at: iso(row.createdAt),
  };
}

export function selectMessagePath(allMessages: Message[], leafMessageId: string | null): Message[] {
  if (!leafMessageId) {
    return [];
  }
  const byId = new Map(allMessages.map((message) => [message.id, message] as const));
  const reversed: Message[] = [];
  const seen = new Set<string>();
  let current = byId.get(leafMessageId);
  if (!current) {
    throw new Error(`selected message ${leafMessageId} does not belong to the session`);
  }
  while (current) {
    if (seen.has(current.id)) {
      throw new Error(`message history contains a cycle at ${current.id}`);
    }
    seen.add(current.id);
    reversed.push(current);
    current = current.parent_message_id ? byId.get(current.parent_message_id) : undefined;
    if (reversed.at(-1)?.parent_message_id && !current) {
      throw new Error(`message history parent ${reversed.at(-1)!.parent_message_id} is missing`);
    }
  }
  return reversed.reverse();
}

export function buildMessageBranches(allMessages: Message[], selectedPath: Message[]): MessageBranchGroup[] {
  const children = new Map<string | null, Message[]>();
  for (const message of allMessages) {
    const siblings = children.get(message.parent_message_id) ?? [];
    siblings.push(message);
    children.set(message.parent_message_id, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (left, right) => left.branch_index - right.branch_index || left.created_at.localeCompare(right.created_at),
    );
  }

  const latestLeaf = (root: Message): Message => {
    let latest = root;
    const pending = [root];
    while (pending.length) {
      const current = pending.pop()!;
      const descendants = children.get(current.id) ?? [];
      if (descendants.length === 0 && (current.created_at > latest.created_at || latest === root)) {
        latest = current;
      }
      pending.push(...descendants);
    }
    return latest;
  };

  return selectedPath.flatMap((selected) => {
    const siblings = children.get(selected.parent_message_id) ?? [];
    if (siblings.length < 2) {
      return [];
    }
    return [
      {
        parent_message_id: selected.parent_message_id,
        selected_message_id: selected.id,
        candidates: siblings.map((candidate) => ({
          message_id: candidate.id,
          leaf_message_id: latestLeaf(candidate).id,
          role: candidate.role,
          created_at: candidate.created_at,
        })),
      },
    ];
  });
}

export async function listSessions(auth: AuthContext): Promise<Session[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, auth.userId),
        eq(sessions.tenantId, auth.tenantId),
        eq(sessions.workspaceId, auth.workspaceId),
      ),
    )
    .orderBy(desc(sessions.updatedAt));
  return rows.map(toSession);
}

export async function getSession(auth: AuthContext, sessionId: string): Promise<SessionDetail> {
  const row = await getSessionRow(auth, sessionId);
  const db = getDb();
  const messageRows = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  const [latestRun] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(eq(agentRuns.sessionId, sessionId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);
  let documentRows: KnowledgeDocument[] = [];
  try {
    documentRows = await listDocuments(auth.userId, sessionId);
  } catch {
    documentRows = [];
  }
  const allMessages = messageRows.map(toMessage);
  const selectedMessages = selectMessagePath(allMessages, row.selectedMessageId);
  return {
    ...toSession(row),
    messages: selectedMessages,
    branches: buildMessageBranches(allMessages, selectedMessages),
    documents: documentRows.map((d) => mapKnowledgeDocument(d, sessionId)),
    active_run_id: null,
    latest_run_id: latestRun?.id ?? null,
  };
}

export async function createSession(
  auth: AuthContext,
  input: {
    request_id: string;
    provider_id?: string | null;
    model?: string | null;
    reasoning_effort?: ReasoningEffort | null;
  },
): Promise<Session> {
  const db = getDb();
  const now = new Date();
  const id = randomBytes(6).toString("hex");
  const values = {
    id,
    userId: auth.userId,
    tenantId: auth.tenantId,
    workspaceId: auth.workspaceId,
    model: input.model ?? "",
    providerId: input.provider_id ?? "",
    reasoningEffort: input.reasoning_effort ?? "medium",
    createRequestId: input.request_id,
    createdAt: now,
    updatedAt: now,
  };
  const [inserted] = await db.insert(sessions).values(values).onConflictDoNothing().returning();
  if (inserted) return toSession(inserted);
  const [row] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, auth.userId),
        eq(sessions.tenantId, auth.tenantId),
        eq(sessions.workspaceId, auth.workspaceId),
        eq(sessions.createRequestId, input.request_id),
      ),
    );
  if (!row) throw new ConflictError("session creation conflict");
  if (
    row.providerId !== (input.provider_id ?? "") ||
    row.model !== (input.model ?? "") ||
    row.reasoningEffort !== (input.reasoning_effort ?? "medium")
  ) {
    throw new ConflictError("request_id was already used with different session input");
  }
  return toSession(row);
}

export async function selectSessionHistory(
  auth: AuthContext,
  sessionId: string,
  input: { leaf_message_id: string; expected_revision: number },
): Promise<SessionDetail> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.userId, auth.userId),
          eq(sessions.tenantId, auth.tenantId),
          eq(sessions.workspaceId, auth.workspaceId),
        ),
      )
      .for("update");
    if (!session) throw new NotFoundError(`session ${sessionId} not found`);
    if (session.historyRevision !== BigInt(input.expected_revision)) {
      throw new ConflictError("session history revision is stale", "history_revision_conflict", {
        expected_revision: input.expected_revision,
        current_revision: Number(session.historyRevision),
      });
    }
    const now = new Date();
    const [lease] = await tx
      .select()
      .from(sessionRunLeases)
      .where(eq(sessionRunLeases.sessionId, sessionId))
      .for("update");
    const [leasedRun] = lease
      ? await tx.select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, lease.runId)).for("update")
      : [];
    if (lease && leasedRun && ["running", "cancel_requested"].includes(leasedRun.status) && lease.expiresAt > now) {
      throw new ConflictError("cannot switch history while an agent run is active", "active_run_exists", {
        run_id: lease.runId,
      });
    }
    if (lease) {
      await tx.delete(sessionRunLeases).where(eq(sessionRunLeases.runId, lease.runId));
      if (leasedRun && ["running", "cancel_requested"].includes(leasedRun.status)) {
        await tx
          .update(agentRuns)
          .set({ status: "interrupted", finishedAt: now, error: "run lease expired" })
          .where(eq(agentRuns.id, lease.runId));
      }
    }
    const [leaf] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, input.leaf_message_id), eq(messages.sessionId, sessionId)));
    if (!leaf) throw new NotFoundError(`message ${input.leaf_message_id} not found in session ${sessionId}`);
    await tx
      .update(sessions)
      .set({
        selectedMessageId: leaf.id,
        historyRevision: session.historyRevision + 1n,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));
  });
  return getSession(auth, sessionId);
}

export async function deleteSession(auth: AuthContext, sessionId: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.userId, auth.userId),
          eq(sessions.tenantId, auth.tenantId),
          eq(sessions.workspaceId, auth.workspaceId),
        ),
      )
      .for("update");
    if (!row) throw new NotFoundError(`session ${sessionId} not found`);
    const [lease] = await tx
      .select()
      .from(sessionRunLeases)
      .where(eq(sessionRunLeases.sessionId, row.id))
      .for("update");
    const [leasedRun] = lease
      ? await tx.select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, lease.runId)).for("update")
      : [];
    if (lease && leasedRun && ["running", "cancel_requested"].includes(leasedRun.status) && lease.expiresAt > now) {
      throw new ConflictError("session has an active agent run; cancel it before deleting", "active_run_exists", {
        run_id: lease.runId,
      });
    }
    if (lease && leasedRun && ["running", "cancel_requested"].includes(leasedRun.status)) {
      await tx
        .update(agentRuns)
        .set({ status: "interrupted", finishedAt: now, error: "run lease expired" })
        .where(eq(agentRuns.id, lease.runId));
    }
    if (lease) await tx.delete(sessionRunLeases).where(eq(sessionRunLeases.runId, lease.runId));
    await tx
      .insert(sessionArtifactCleanupOutbox)
      .values({
        sessionId: row.id,
        userId: row.userId,
        tenantId: row.tenantId,
        workspaceId: row.workspaceId,
        availableAt: now,
        createdAt: now,
      })
      .onConflictDoNothing();
    await releaseSessionFileClaims(tx, {
      sessionId: row.id,
      userId: row.userId,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
    });
    await tx.delete(sessions).where(eq(sessions.id, row.id));
  });
}

function assertSessionDocument(doc: KnowledgeDocument, sessionId: string): KnowledgeDocument {
  if (knowledgeDocumentSessionId(doc) !== sessionId) {
    throw new NotFoundError(`document ${doc.id} not found in session ${sessionId}`);
  }
  return doc;
}

export async function getSessionDocument(
  auth: AuthContext,
  sessionId: string,
  documentId: string,
  includeContent = true,
): Promise<SessionDocumentDetail> {
  const session = await getSessionRow(auth, sessionId);
  const doc = assertSessionDocument(await getDocument(session.userId, documentId, includeContent), sessionId);
  return {
    ...mapKnowledgeDocument(doc, sessionId),
    content_md: doc.content_md ?? "",
  };
}

export async function updateSessionDocument(
  auth: AuthContext,
  sessionId: string,
  documentId: string,
  input: { title?: string; content_md?: string },
): Promise<SessionDocumentDetail> {
  const session = await getSessionRow(auth, sessionId);
  const current = assertSessionDocument(await getDocument(session.userId, documentId), sessionId);
  const updated = await updateArtifact({
    userId: session.userId,
    documentId: current.id,
    title: input.title,
    content: input.content_md,
  });
  return {
    ...mapKnowledgeDocument(updated, sessionId),
    content_md: updated.content_md ?? "",
  };
}

export async function touchSession(sessionId: string): Promise<void> {
  const db = getDb();
  await db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function getSessionRow(auth: AuthContext, sessionId: string): Promise<typeof sessions.$inferSelect> {
  const db = getDb();
  const condition = and(
    eq(sessions.id, sessionId),
    eq(sessions.userId, auth.userId),
    eq(sessions.tenantId, auth.tenantId),
    eq(sessions.workspaceId, auth.workspaceId),
  );
  const [row] = await db.select().from(sessions).where(condition);
  if (!row) {
    throw new NotFoundError(`session ${sessionId} not found`);
  }
  return row;
}

export async function listMessages(sessionId: string, leafMessageId?: string | null): Promise<Message[]> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ selectedMessageId: sessions.selectedMessageId })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    const rows = await tx
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    const selectedLeaf = leafMessageId === undefined ? (session?.selectedMessageId ?? null) : leafMessageId;
    return selectMessagePath(rows.map(toMessage), selectedLeaf);
  });
}

export async function createMessage(input: {
  id?: string;
  sessionId: string;
  role: string;
  content: PersistedMessageContent;
  status?: string;
  parentMessageId?: string | null;
  branchIndex?: number;
  select?: boolean;
}): Promise<Message> {
  const db = getDb();
  const id = input.id ?? randomBytes(8).toString("hex");
  const now = new Date();
  await db
    .insert(messages)
    .values({
      id,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      status: input.status ?? "ok",
      parentMessageId: input.parentMessageId ?? null,
      branchIndex: input.branchIndex ?? 0,
      createdAt: now,
    })
    .onConflictDoNothing();
  const [row] = await db.select().from(messages).where(eq(messages.id, id));
  if (!row || row.sessionId !== input.sessionId || row.role !== input.role) {
    throw new Error(`message id ${id} already belongs to a different message`);
  }
  if (input.select) {
    await db
      .update(sessions)
      .set({ selectedMessageId: row.id, updatedAt: now })
      .where(eq(sessions.id, input.sessionId));
  }
  return toMessage(row);
}

export async function updateMessageContent(input: {
  id: string;
  sessionId: string;
  content: PersistedMessageContent;
  status?: string;
}): Promise<void> {
  await getDb()
    .update(messages)
    .set({ content: input.content, status: input.status ?? "ok" })
    .where(and(eq(messages.id, input.id), eq(messages.sessionId, input.sessionId)));
}

export async function updateSessionModel(
  auth: AuthContext,
  sessionId: string,
  input: { providerId: string; model: string; reasoningEffort: ReasoningEffort },
): Promise<Session> {
  await getSessionRow(auth, sessionId);
  const db = getDb();
  const [row] = await db
    .update(sessions)
    .set({
      providerId: input.providerId,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId))
    .returning();
  if (!row) throw new NotFoundError("session not found");
  return toSession(row);
}

export async function authorizeDocumentDelivery(
  auth: AuthContext,
  sessionId: string,
  documentId: string,
  maxDim?: number,
) {
  const doc = await getSessionDocument(auth, sessionId, documentId, false);
  if (!doc.asset_id || !doc.source_revision_id) throw new NotFoundError("document has no Storage revision");
  return storageClient().mintDelivery({
    tenantId: auth.tenantId,
    workspaceId: auth.workspaceId,
    assetId: doc.asset_id,
    revisionId: doc.source_revision_id,
    maxDim,
  });
}

function isKnowledgeSourcePart(part: unknown, sourceId: string): boolean {
  if (!part || typeof part !== "object") return false;
  const value = part as Record<string, unknown>;
  if (value.type !== "source-document" || value.sourceId !== sourceId) return false;
  const providerMetadata = value.providerMetadata;
  if (!providerMetadata || typeof providerMetadata !== "object") return false;
  const chat = (providerMetadata as Record<string, unknown>).chat;
  return Boolean(
    chat && typeof chat === "object" && (chat as Record<string, unknown>).resolver === "knowledge-document",
  );
}

export function hasKnowledgeSourceReference(history: Message[], sourceId: string): boolean {
  return history.some((message) => message.content.parts.some((part) => isKnowledgeSourcePart(part, sourceId)));
}

export async function authorizeSessionSourceDelivery(auth: AuthContext, sessionId: string, sourceId: string) {
  const session = await getSessionRow(auth, sessionId);
  const history = await listMessages(session.id);
  if (!hasKnowledgeSourceReference(history, sourceId)) throw new NotFoundError("session source not found");
  const document = await getWorkspaceDocument(auth.tenantId, auth.workspaceId, sourceId);
  if (!document.asset_id || !document.source_revision_id) throw new NotFoundError("source has no Storage revision");
  return storageClient().mintDelivery({
    tenantId: auth.tenantId,
    workspaceId: auth.workspaceId,
    assetId: document.asset_id,
    revisionId: document.source_revision_id,
  });
}
export async function authorizeFileDelivery(
  auth: AuthContext,
  sessionId: string,
  fileId: string,
  expectedRevision?: string,
) {
  const file = await getSessionFile(auth, sessionId, fileId);
  if (expectedRevision !== undefined && expectedRevision !== file.revision_id) {
    throw new ConflictError("session file changed while loading", "file_content_conflict");
  }
  return storageClient().mintDelivery({
    tenantId: auth.tenantId,
    workspaceId: auth.workspaceId,
    assetId: file.asset_id,
    revisionId: file.revision_id,
  });
}
