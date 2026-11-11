import { createHash, randomBytes } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";

import type { AuthContext } from "../api/http/middleware/auth.js";
import { canvasClient } from "../infrastructure/clients/canvas.js";
import {
  getDocument,
  getWorkspaceDocument,
  listDocuments,
  updateArtifact,
  type KnowledgeDocument,
} from "../infrastructure/clients/knowledge.js";
import { storageClient } from "../infrastructure/clients/storage.js";
import { getDb } from "../infrastructure/persistence/index.js";
import {
  agentRuns,
  conversationArtifactCleanupOutbox,
  conversationRunLeases,
  conversations,
  messages,
  type PersistedMessageContent,
} from "../infrastructure/persistence/schema.js";
import { getConversationFile, releaseConversationFileClaims, saveConversationFile } from "./conversation-files.js";
import { ConflictError, NotFoundError } from "./errors.js";

export { getConversationFile } from "./conversation-files.js";
import { assertEditableFileSize } from "./file-edit-limits.js";

export async function updateConversationFileContent(
  auth: Pick<AuthContext, "userId" | "tenantId" | "workspaceId">,
  conversationId: string,
  fileId: string,
  input: { content: string; expectedEtag: string; operationId: string; signal?: AbortSignal },
) {
  assertEditableFileSize(Buffer.byteLength(input.content, "utf8"));
  const bytes = new TextEncoder().encode(input.content);
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  return saveConversationFile(
    {
      ...auth,
      conversationId,
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
  );
}

export interface Conversation {
  id: string;
  user_id: string;
  tenant_id: string;
  workspace_id: string;
  title: string;
  model: string;
  provider_id: string;
  active_plan_file_id: string | null;
  project_id: string | null;
  canvas_id: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  selected_message_id: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
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

export function mapKnowledgeDocument(doc: KnowledgeDocument, conversationId: string) {
  return {
    id: doc.id,
    conversation_id: doc.conversation_id ?? conversationId,
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

export interface ConversationDocument {
  id: string;
  conversation_id: string;
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

export interface ConversationDocumentDetail extends ConversationDocument {
  content_md: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
  branches: MessageBranchGroup[];
  documents: ConversationDocument[];
  active_run_id: string | null;
  latest_run_id: string | null;
}

function iso(d: Date): string {
  return d.toISOString().replace("+00:00", "Z");
}

function toConversation(row: typeof conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    user_id: row.userId,
    tenant_id: row.tenantId,
    workspace_id: row.workspaceId,
    title: row.title,
    model: row.model,
    provider_id: row.providerId,
    active_plan_file_id: row.activePlanFileId,
    project_id: row.projectId,
    canvas_id: row.canvasId,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    revision: Number(row.historyRevision),
    selected_message_id: row.selectedMessageId,
  };
}

function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    conversation_id: row.conversationId,
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
    throw new Error(`selected message ${leafMessageId} does not belong to the conversation`);
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

export async function listConversations(auth: AuthContext): Promise<Conversation[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, auth.userId),
        eq(conversations.tenantId, auth.tenantId),
        eq(conversations.workspaceId, auth.workspaceId),
      ),
    )
    .orderBy(desc(conversations.updatedAt));
  return rows.map(toConversation);
}

export async function getConversation(auth: AuthContext, conversationId: string): Promise<ConversationDetail> {
  const row = await getConversationRow(auth, conversationId);
  const db = getDb();
  const messageRows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  const [latestRun] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(eq(agentRuns.conversationId, conversationId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);
  let documentRows: KnowledgeDocument[] = [];
  try {
    documentRows = await listDocuments(auth.userId, conversationId);
  } catch {
    documentRows = [];
  }
  const allMessages = messageRows.map(toMessage);
  const selectedMessages = selectMessagePath(allMessages, row.selectedMessageId);
  return {
    ...toConversation(row),
    messages: selectedMessages,
    branches: buildMessageBranches(allMessages, selectedMessages),
    documents: documentRows.map((d) => mapKnowledgeDocument(d, conversationId)),
    active_run_id: null,
    latest_run_id: latestRun?.id ?? null,
  };
}

export async function createConversation(
  auth: AuthContext,
  input: { title?: string; provider_id?: string | null; project_id?: string; canvas_id?: string },
): Promise<Conversation> {
  const db = getDb();
  const now = new Date();
  if (input.canvas_id || input.project_id) {
    if (!input.canvas_id || !input.project_id) throw new NotFoundError("Canvas binding is incomplete");
    await canvasClient().graph(auth, input.project_id, input.canvas_id);
  }
  const id = randomBytes(6).toString("hex");
  const values = {
    id,
    userId: auth.userId,
    tenantId: auth.tenantId,
    workspaceId: auth.workspaceId,
    title: input.title ?? "新对话",
    projectId: input.project_id ?? null,
    canvasId: input.canvas_id ?? null,
    model: "",
    providerId: input.provider_id ?? "",
    createdAt: now,
    updatedAt: now,
  };
  const [row] = input.canvas_id
    ? await db
        .insert(conversations)
        .values(values)
        .onConflictDoUpdate({
          target: [
            conversations.tenantId,
            conversations.workspaceId,
            conversations.userId,
            conversations.projectId,
            conversations.canvasId,
          ],
          set: { canvasId: input.canvas_id },
        })
        .returning()
    : await db.insert(conversations).values(values).returning();
  return toConversation(row);
}

export async function updateConversation(
  auth: AuthContext,
  conversationId: string,
  input: { title?: string },
): Promise<Conversation> {
  const row = await getConversationRow(auth, conversationId);
  const db = getDb();
  const values: Partial<typeof conversations.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) {
    values.title = input.title;
  }
  await db.update(conversations).set(values).where(eq(conversations.id, row.id));
  const [updated] = await db.select().from(conversations).where(eq(conversations.id, row.id));
  return toConversation(updated);
}

export async function selectConversationHistory(
  auth: AuthContext,
  conversationId: string,
  input: { leaf_message_id: string; expected_revision: number },
): Promise<ConversationDetail> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, auth.userId),
          eq(conversations.tenantId, auth.tenantId),
          eq(conversations.workspaceId, auth.workspaceId),
        ),
      )
      .for("update");
    if (!conversation) throw new NotFoundError(`conversation ${conversationId} not found`);
    if (conversation.historyRevision !== BigInt(input.expected_revision)) {
      throw new ConflictError("conversation history revision is stale", "history_revision_conflict", {
        expected_revision: input.expected_revision,
        current_revision: Number(conversation.historyRevision),
      });
    }
    const now = new Date();
    const [lease] = await tx
      .select()
      .from(conversationRunLeases)
      .where(eq(conversationRunLeases.conversationId, conversationId))
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
      await tx.delete(conversationRunLeases).where(eq(conversationRunLeases.runId, lease.runId));
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
      .where(and(eq(messages.id, input.leaf_message_id), eq(messages.conversationId, conversationId)));
    if (!leaf) throw new NotFoundError(`message ${input.leaf_message_id} not found in conversation ${conversationId}`);
    await tx
      .update(conversations)
      .set({
        selectedMessageId: leaf.id,
        historyRevision: conversation.historyRevision + 1n,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));
  });
  return getConversation(auth, conversationId);
}

export async function deleteConversation(auth: AuthContext, conversationId: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, auth.userId),
          eq(conversations.tenantId, auth.tenantId),
          eq(conversations.workspaceId, auth.workspaceId),
        ),
      )
      .for("update");
    if (!row) throw new NotFoundError(`conversation ${conversationId} not found`);
    const [lease] = await tx
      .select()
      .from(conversationRunLeases)
      .where(eq(conversationRunLeases.conversationId, row.id))
      .for("update");
    const [leasedRun] = lease
      ? await tx.select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, lease.runId)).for("update")
      : [];
    if (lease && leasedRun && ["running", "cancel_requested"].includes(leasedRun.status) && lease.expiresAt > now) {
      throw new ConflictError("conversation has an active agent run; cancel it before deleting", "active_run_exists", {
        run_id: lease.runId,
      });
    }
    if (lease && leasedRun && ["running", "cancel_requested"].includes(leasedRun.status)) {
      await tx
        .update(agentRuns)
        .set({ status: "interrupted", finishedAt: now, error: "run lease expired" })
        .where(eq(agentRuns.id, lease.runId));
    }
    if (lease) await tx.delete(conversationRunLeases).where(eq(conversationRunLeases.runId, lease.runId));
    await tx
      .insert(conversationArtifactCleanupOutbox)
      .values({
        conversationId: row.id,
        userId: row.userId,
        tenantId: row.tenantId,
        workspaceId: row.workspaceId,
        availableAt: now,
        createdAt: now,
      })
      .onConflictDoNothing();
    await releaseConversationFileClaims(tx, {
      conversationId: row.id,
      userId: row.userId,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
    });
    await tx.delete(conversations).where(eq(conversations.id, row.id));
  });
}

function assertConversationDocument(doc: KnowledgeDocument, conversationId: string): KnowledgeDocument {
  if (doc.conversation_id !== conversationId) {
    throw new NotFoundError(`document ${doc.id} not found in conversation ${conversationId}`);
  }
  return doc;
}

export async function getConversationDocument(
  auth: AuthContext,
  conversationId: string,
  documentId: string,
  includeContent = true,
): Promise<ConversationDocumentDetail> {
  const conversation = await getConversationRow(auth, conversationId);
  const doc = assertConversationDocument(
    await getDocument(conversation.userId, documentId, includeContent),
    conversationId,
  );
  return {
    ...mapKnowledgeDocument(doc, conversationId),
    content_md: doc.content_md ?? "",
  };
}

export async function updateConversationDocument(
  auth: AuthContext,
  conversationId: string,
  documentId: string,
  input: { title?: string; content_md?: string },
): Promise<ConversationDocumentDetail> {
  const conversation = await getConversationRow(auth, conversationId);
  const current = assertConversationDocument(await getDocument(conversation.userId, documentId), conversationId);
  const updated = await updateArtifact({
    userId: conversation.userId,
    documentId: current.id,
    title: input.title,
    content: input.content_md,
  });
  return {
    ...mapKnowledgeDocument(updated, conversationId),
    content_md: updated.content_md ?? "",
  };
}

export async function touchConversation(conversationId: string): Promise<void> {
  const db = getDb();
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
}

export async function setConversationTitle(conversationId: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) {
    return;
  }
  await getDb()
    .update(conversations)
    .set({ title: trimmed, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

export async function getConversationRow(
  auth: AuthContext,
  conversationId: string,
): Promise<typeof conversations.$inferSelect> {
  const db = getDb();
  const condition = and(
    eq(conversations.id, conversationId),
    eq(conversations.userId, auth.userId),
    eq(conversations.tenantId, auth.tenantId),
    eq(conversations.workspaceId, auth.workspaceId),
  );
  const [row] = await db.select().from(conversations).where(condition);
  if (!row) {
    throw new NotFoundError(`conversation ${conversationId} not found`);
  }
  return row;
}

export async function listMessages(conversationId: string, leafMessageId?: string | null): Promise<Message[]> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({ selectedMessageId: conversations.selectedMessageId })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    const rows = await tx
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    const selectedLeaf = leafMessageId === undefined ? (conversation?.selectedMessageId ?? null) : leafMessageId;
    return selectMessagePath(rows.map(toMessage), selectedLeaf);
  });
}

export async function createMessage(input: {
  id?: string;
  conversationId: string;
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
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      status: input.status ?? "ok",
      parentMessageId: input.parentMessageId ?? null,
      branchIndex: input.branchIndex ?? 0,
      createdAt: now,
    })
    .onConflictDoNothing();
  const [row] = await db.select().from(messages).where(eq(messages.id, id));
  if (!row || row.conversationId !== input.conversationId || row.role !== input.role) {
    throw new Error(`message id ${id} already belongs to a different message`);
  }
  if (input.select) {
    await db
      .update(conversations)
      .set({ selectedMessageId: row.id, updatedAt: now })
      .where(eq(conversations.id, input.conversationId));
  }
  return toMessage(row);
}

export async function updateMessageContent(input: {
  id: string;
  conversationId: string;
  content: PersistedMessageContent;
  status?: string;
}): Promise<void> {
  await getDb()
    .update(messages)
    .set({ content: input.content, status: input.status ?? "ok" })
    .where(and(eq(messages.id, input.id), eq(messages.conversationId, input.conversationId)));
}

export async function updateConversationProvider(
  conversationId: string,
  providerId: string,
  model: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(conversations)
    .set({ providerId, model, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

export async function authorizeDocumentDelivery(
  auth: AuthContext,
  conversationId: string,
  documentId: string,
  maxDim?: number,
) {
  const doc = await getConversationDocument(auth, conversationId, documentId, false);
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

export async function authorizeConversationSourceDelivery(auth: AuthContext, conversationId: string, sourceId: string) {
  const conversation = await getConversationRow(auth, conversationId);
  const history = await listMessages(conversation.id);
  if (!hasKnowledgeSourceReference(history, sourceId)) throw new NotFoundError("conversation source not found");
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
  conversationId: string,
  fileId: string,
  expectedRevision?: string,
) {
  const file = await getConversationFile(auth, conversationId, fileId);
  if (expectedRevision !== undefined && expectedRevision !== file.revision_id) {
    throw new ConflictError("conversation file changed while loading", "file_content_conflict");
  }
  return storageClient().mintDelivery({
    tenantId: auth.tenantId,
    workspaceId: auth.workspaceId,
    assetId: file.asset_id,
    revisionId: file.revision_id,
  });
}
