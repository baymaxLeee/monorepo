import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { AuthContext } from "../api/http/middleware/auth.js";
import { forkConversationFiles } from "../infrastructure/clients/knowledge.js";
import { getDb } from "../infrastructure/persistence/index.js";
import {
  conversationArtifactCleanupOutbox,
  conversationRunLeases,
  conversations,
  messages,
} from "../infrastructure/persistence/schema.js";
import { forkMessageContent } from "./conversation-fork-content.js";
import { getConversationRow, listMessages, type Message } from "./conversations.js";
import { ConflictError, NotFoundError } from "./errors.js";

export function selectForkMessages(history: Message[], messageId: string): Message[] {
  const boundary = history.findIndex((message) => message.id === messageId);
  if (boundary < 0) throw new NotFoundError("分支起点不存在于此会话");
  const last = history[boundary];
  if (last.role !== "assistant" || last.status === "streaming") throw new ConflictError("请等待该轮回复完成后创建分支");
  return history.slice(0, boundary + 1);
}

export const conversationForkDependencies = {
  getConversationRow,
  listMessages,
  forkConversationFiles,
  async hasActiveRun(id: string) {
    const rows = await getDb().select().from(conversationRunLeases).where(eq(conversationRunLeases.conversationId, id));
    return rows.length > 0;
  },
  async reserve(auth: AuthContext, id: string, now: Date) {
    // The existing cleanup relay leases this compensation intent. If the
    // process dies before publication, it releases the orphaned file claims.
    await getDb().insert(conversationArtifactCleanupOutbox).values({
      conversationId: id,
      userId: auth.userId,
      tenantId: auth.tenantId,
      workspaceId: auth.workspaceId,
      createdAt: now,
      availableAt: now,
      claimedAt: now,
    });
  },
  async publish(source: Awaited<ReturnType<typeof getConversationRow>>, id: string, now: Date, history: Message[]) {
    await getDb().transaction(async (tx) => {
      // The lease INSERT trigger advances this revision under the same row lock.
      // A run that starts AND ends during the external copy still invalidates it.
      const [current] = await tx
        .select({ runRevision: conversations.runRevision, historyRevision: conversations.historyRevision })
        .from(conversations)
        .where(eq(conversations.id, source.id))
        .for("no key update");
      if (
        !current ||
        current.runRevision !== source.runRevision ||
        current.historyRevision !== source.historyRevision
      ) {
        throw new ConflictError("原会话已开始新的生成，请重试创建分支");
      }
      const reserved = await tx
        .delete(conversationArtifactCleanupOutbox)
        .where(
          and(
            eq(conversationArtifactCleanupOutbox.conversationId, id),
            eq(conversationArtifactCleanupOutbox.claimedAt, now),
            eq(conversationArtifactCleanupOutbox.attempts, 0),
          ),
        )
        .returning();
      if (!reserved.length) throw new ConflictError("分支文件准备超时，请重试");
      const copiedIds = history.map(() => randomBytes(16).toString("hex"));
      await tx.insert(conversations).values({
        id,
        userId: source.userId,
        tenantId: source.tenantId,
        workspaceId: source.workspaceId,
        title: `${source.title.slice(0, 190)} · 分支`,
        model: source.model,
        providerId: source.providerId,
        selectedMessageId: copiedIds.at(-1) ?? null,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(messages).values(
        history.map((message, index) => ({
          id: copiedIds[index],
          parentMessageId: copiedIds[index - 1] ?? null,
          branchIndex: 0,
          conversationId: id,
          role: message.role,
          content: message.content,
          status: message.status === "streaming" ? "failed" : message.status,
          // Preserve exact transcript order even when original timestamps tie.
          createdAt: new Date(now.getTime() - history.length + index),
        })),
      );
    });
  },
  async release(id: string, now: Date) {
    await getDb()
      .update(conversationArtifactCleanupOutbox)
      .set({ claimedAt: null })
      .where(
        and(
          eq(conversationArtifactCleanupOutbox.conversationId, id),
          eq(conversationArtifactCleanupOutbox.claimedAt, now),
        ),
      );
  },
};

export async function forkConversation(
  auth: AuthContext,
  sourceId: string,
  messageId: string,
  deps = conversationForkDependencies,
) {
  const source = await deps.getConversationRow(auth, sourceId);
  if (await deps.hasActiveRun(sourceId)) throw new ConflictError("请先停止当前生成，再创建分支");
  const history = selectForkMessages(await deps.listMessages(sourceId), messageId);
  const id = randomBytes(16).toString("hex");
  const now = new Date();
  await deps.reserve(auth, id, now);
  try {
    const snapshot = await deps.forkConversationFiles({
      sourceConversationId: sourceId,
      conversationId: id,
      userId: auth.userId,
      tenantId: auth.tenantId,
      workspaceId: auth.workspaceId,
    });
    const copies = history.map((message) => ({
      ...message,
      content: forkMessageContent(message.content, {
        sourceId,
        conversationId: id,
        messageId: message.id,
        documentIds: snapshot.document_ids,
        paths: snapshot.paths,
      }),
    }));
    await deps.publish(source, id, now, copies);
    return { id, source_conversation_id: sourceId, source_message_id: messageId };
  } catch (error) {
    // Failure leaves the durable intent for the relay; source data is untouched.
    await deps.release(id, now).catch(() => {});
    throw error;
  }
}
