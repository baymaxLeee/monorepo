import { randomBytes } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";

import type { AuthContext } from "../middleware/auth.js";
import { getDb } from "../db/index.js";
import { conversations, messages, type PersistedMessageContent } from "../db/schema.js";
import {
  getDocument,
  getDocumentSource,
  listDocuments,
  updateArtifact,
  type KnowledgeDocument,
} from "../clients/knowledge.js";
import { NotFoundError } from "../lib/errors.js";

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  model: string;
  provider_id: string;
  active_plan_document_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: PersistedMessageContent;
  status: "ok" | "streaming" | "failed";
  created_at: string;
}

export function mapKnowledgeDocument(doc: KnowledgeDocument, conversationId: string) {
  return {
    id: doc.id,
    conversation_id: doc.conversation_id ?? conversationId,
    kind: doc.kind,
    title: doc.title,
    filename: doc.filename,
    mime_type: doc.mime_type,
    source_size: doc.source_size,
    source_mime_type: doc.source_mime_type,
    source_object_bucket: doc.object_bucket ?? null,
    source_object_key: doc.object_key ?? null,
    source_sha256: doc.object_sha256 ?? null,
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
  title: string;
  filename: string;
  mime_type: string;
  source_size: number;
  source_mime_type: string | null;
  source_object_bucket: string | null;
  source_object_key: string | null;
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
  documents: ConversationDocument[];
  active_run_id: string | null;
}

function iso(d: Date): string {
  return d.toISOString().replace("+00:00", "Z");
}

function toConversation(row: typeof conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    user_id: row.userId,
    title: row.title,
    model: row.model,
    provider_id: row.providerId,
    active_plan_document_id: row.activePlanDocumentId,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
}

function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    role: row.role as Message["role"],
    content: row.content,
    status: row.status as Message["status"],
    created_at: iso(row.createdAt),
  };
}

export async function listConversations(auth: AuthContext): Promise<Conversation[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, auth.userId))
    .orderBy(desc(conversations.updatedAt));
  return rows.map(toConversation);
}

export async function getConversation(
  auth: AuthContext,
  conversationId: string,
): Promise<ConversationDetail> {
  const row = await getConversationRow(auth, conversationId);
  const db = getDb();
  const messageRows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  let documentRows: KnowledgeDocument[] = [];
  try {
    documentRows = await listDocuments(auth.userId, conversationId);
  } catch {
    documentRows = [];
  }
  return {
    ...toConversation(row),
    messages: messageRows.map(toMessage),
    documents: documentRows.map((d) => mapKnowledgeDocument(d, conversationId)),
    active_run_id: null,
  };
}

export async function createConversation(
  auth: AuthContext,
  input: { title?: string; provider_id?: string | null },
): Promise<Conversation> {
  const db = getDb();
  const now = new Date();
  const id = randomBytes(6).toString("hex");
  await db.insert(conversations).values({
    id,
    userId: auth.userId,
    title: input.title ?? "新对话",
    model: "",
    providerId: input.provider_id ?? "",
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
  return toConversation(row!);
}

export async function updateConversation(
  auth: AuthContext,
  conversationId: string,
  input: { title?: string },
): Promise<Conversation> {
  const row = await getConversationRow(auth, conversationId);
  const db = getDb();
  const values: Partial<typeof conversations.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) values.title = input.title;
  await db.update(conversations).set(values).where(eq(conversations.id, row.id));
  const [updated] = await db.select().from(conversations).where(eq(conversations.id, row.id));
  return toConversation(updated!);
}

export async function setActivePlanDocument(
  conversationId: string,
  documentId: string,
): Promise<void> {
  await getDb()
    .update(conversations)
    .set({ activePlanDocumentId: documentId, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

export async function deleteConversation(auth: AuthContext, conversationId: string): Promise<void> {
  const row = await getConversationRow(auth, conversationId);
  const db = getDb();
  await db.delete(conversations).where(eq(conversations.id, row.id));
}

function assertConversationDocument(
  doc: KnowledgeDocument,
  conversationId: string,
): KnowledgeDocument {
  if (doc.conversation_id !== conversationId) {
    throw new NotFoundError(`document ${doc.id} not found in conversation ${conversationId}`);
  }
  return doc;
}

export async function getConversationDocument(
  auth: AuthContext,
  conversationId: string,
  documentId: string,
): Promise<ConversationDocumentDetail> {
  const conversation = await getConversationRow(auth, conversationId);
  const doc = assertConversationDocument(
    await getDocument(conversation.userId, documentId),
    conversationId,
  );
  return {
    ...mapKnowledgeDocument(doc, conversationId),
    content_md: doc.content_md ?? "",
  };
}

export async function getConversationDocumentSource(
  auth: AuthContext,
  conversationId: string,
  documentId: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const conversation = await getConversationRow(auth, conversationId);
  const doc = assertConversationDocument(
    await getDocument(conversation.userId, documentId),
    conversationId,
  );
  return getDocumentSource(conversation.userId, doc.id);
}

export async function updateConversationDocument(
  auth: AuthContext,
  conversationId: string,
  documentId: string,
  input: { title?: string; content_md?: string },
): Promise<ConversationDocumentDetail> {
  const conversation = await getConversationRow(auth, conversationId);
  const current = assertConversationDocument(
    await getDocument(conversation.userId, documentId),
    conversationId,
  );
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
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

export async function setConversationTitle(
  conversationId: string,
  title: string,
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
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
  );
  const [row] = await db.select().from(conversations).where(condition);
  if (!row) throw new NotFoundError(`conversation ${conversationId} not found`);
  return row;
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  return rows.map(toMessage);
}

export async function createMessage(input: {
  id?: string;
  conversationId: string;
  role: string;
  content: PersistedMessageContent;
  status?: string;
}): Promise<Message> {
  const db = getDb();
  const id = input.id ?? randomBytes(8).toString("hex");
  const now = new Date();
  await db.insert(messages).values({
    id,
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    status: input.status ?? "ok",
    createdAt: now,
  }).onConflictDoNothing();
  const [row] = await db.select().from(messages).where(eq(messages.id, id));
  if (!row || row.conversationId !== input.conversationId || row.role !== input.role) {
    throw new Error(`message id ${id} already belongs to a different message`);
  }
  return toMessage(row!);
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
