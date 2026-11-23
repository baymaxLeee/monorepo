import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb } from "../infrastructure/persistence/index.js";
import { threadArtifactCleanupOutbox, threadItems, threads, turnLeases } from "../infrastructure/persistence/schema.js";
import { ConflictError, NotFoundError } from "./errors.js";
import { forkSessionFileRows } from "./session-files.js";
import { forkMessageContent } from "./session-fork-content.js";
import { getSessionRow, listMessages, type Message } from "./sessions.js";

export function selectForkMessages(history: Message[], messageId: string): Message[] {
  const boundary = history.findIndex((message) => message.id === messageId);
  if (boundary < 0) throw new NotFoundError("分支起点不存在于此会话");
  const last = history[boundary];
  if (last.role !== "assistant" || last.status === "streaming") throw new ConflictError("请等待该轮回复完成后创建分支");
  return history.slice(0, boundary + 1);
}

export const sessionForkDependencies = {
  getSessionRow,
  listMessages,
  async hasActiveRun(id: string) {
    const rows = await getDb().select().from(turnLeases).where(eq(turnLeases.threadId, id));
    return rows.length > 0;
  },
  async reserve(id: string, now: Date) {
    // The existing cleanup relay leases this compensation intent. If the
    // process dies before publication, it releases the orphaned file claims.
    await getDb().insert(threadArtifactCleanupOutbox).values({
      threadId: id,
      createdAt: now,
      availableAt: now,
      claimedAt: now,
    });
  },
  async publish(source: Awaited<ReturnType<typeof getSessionRow>>, id: string, now: Date, history: Message[]) {
    await getDb().transaction(async (tx) => {
      // Turn admission advances turnSequence under the same Thread row lock.
      // A Turn that starts AND ends during the external copy still invalidates it.
      const [current] = await tx
        .select({ turnSequence: threads.turnSequence, historyRevision: threads.historyRevision })
        .from(threads)
        .where(eq(threads.id, source.id))
        .for("no key update");
      if (
        !current ||
        current.turnSequence !== source.turnSequence ||
        current.historyRevision !== source.historyRevision
      ) {
        throw new ConflictError("原会话已开始新的生成，请重试创建分支");
      }
      const reserved = await tx
        .delete(threadArtifactCleanupOutbox)
        .where(
          and(
            eq(threadArtifactCleanupOutbox.threadId, id),
            eq(threadArtifactCleanupOutbox.claimedAt, now),
            eq(threadArtifactCleanupOutbox.attempts, 0),
          ),
        )
        .returning();
      if (!reserved.length) throw new ConflictError("分支文件准备超时，请重试");
      const copiedIds = history.map(() => randomBytes(16).toString("hex"));
      await tx.insert(threads).values({
        id,
        createRequestId: `fork:${id}`,
        model: source.model,
        providerId: source.providerId,
        itemSequence: BigInt(history.length),
        selectedItemId: copiedIds.at(-1) ?? null,
        createdAt: now,
        updatedAt: now,
      });
      const fileIds = await forkSessionFileRows(tx, {
        sourceSessionId: source.id,
        sessionId: id,
        now,
      });
      await tx.insert(threadItems).values(
        history.map((message, index) => ({
          id: copiedIds[index],
          parentItemId: copiedIds[index - 1] ?? null,
          branchIndex: 0,
          threadId: id,
          ordinal: BigInt(index + 1),
          role: message.role,
          content: forkMessageContent(message.content, {
            sourceId: source.id,
            sessionId: id,
            messageId: message.id,
            fileIds,
          }),
          status: message.status === "streaming" ? "failed" : message.status,
          // Preserve exact transcript order even when original timestamps tie.
          createdAt: new Date(now.getTime() - history.length + index),
          updatedAt: new Date(now.getTime() - history.length + index),
        })),
      );
    });
  },
  async release(id: string, now: Date) {
    await getDb()
      .delete(threadArtifactCleanupOutbox)
      .where(and(eq(threadArtifactCleanupOutbox.threadId, id), eq(threadArtifactCleanupOutbox.claimedAt, now)));
  },
};

export async function forkSession(sourceId: string, messageId: string, deps = sessionForkDependencies) {
  const source = await deps.getSessionRow(sourceId);
  if (await deps.hasActiveRun(sourceId)) throw new ConflictError("请先停止当前生成，再创建分支");
  const history = selectForkMessages(await deps.listMessages(sourceId), messageId);
  const id = randomBytes(16).toString("hex");
  const now = new Date();
  await deps.reserve(id, now);
  try {
    await deps.publish(source, id, now, history);
    return { id, source_session_id: sourceId, source_message_id: messageId };
  } catch (error) {
    // Failure leaves the durable intent for the relay; source data is untouched.
    await deps.release(id, now).catch(() => {});
    throw error;
  }
}
