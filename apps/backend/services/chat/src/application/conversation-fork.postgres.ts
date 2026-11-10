import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getDb, getSql } from "../infrastructure/persistence/index.js";
import { conversationArtifactCleanupOutbox, conversations, messages } from "../infrastructure/persistence/schema.js";
import { acquireRunLease, releaseRun } from "./agent/runs/lease.js";
import { createAgentRun, finishAgentRun } from "./agent/runs/repository.js";
import { conversationForkDependencies, forkConversation } from "./conversation-fork.js";
import { listMessages } from "./conversations.js";

// Explicit integration entry, not part of the database-free unit suite.
// Run against an isolated, migrated Chat database with CHAT_FORK_TEST_URL.
const url = process.env.CHAT_FORK_TEST_URL;
if (!url) throw new Error("CHAT_FORK_TEST_URL must point to an isolated migrated Chat database");
const connection = new URL(url);
Object.assign(process.env, {
  ENVIRONMENT: "development",
  POSTGRES_HOST: connection.hostname,
  POSTGRES_PORT: connection.port,
  POSTGRES_USER: decodeURIComponent(connection.username),
  POSTGRES_PASSWORD: decodeURIComponent(connection.password),
  POSTGRES_DATABASE: connection.pathname.slice(1),
});
const auth = {
  userId: "fork-test",
  username: "test",
  email: "",
  tenantId: "tenant",
  workspaceId: "workspace",
  workspaceRole: "member",
  roles: [],
};
const id = () => randomBytes(16).toString("hex");
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, promise };
}

test("PostgreSQL fork/run interleavings and compensation", { timeout: 20000 }, async (t) => {
  const peer = postgres(url, { max: 1 });
  t.after(async () => {
    await peer.end();
    await getSql().end();
  });
  async function seed() {
    const sourceId = id(),
      replyId = id(),
      userMessageId = id(),
      now = new Date();
    await getDb().insert(conversations).values({
      id: sourceId,
      userId: auth.userId,
      tenantId: auth.tenantId,
      workspaceId: auth.workspaceId,
      title: "原会话",
      selectedMessageId: replyId,
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .insert(messages)
      .values([
        {
          id: userMessageId,
          conversationId: sourceId,
          role: "user",
          content: { version: 2, parts: [{ type: "text", text: "问题" }] },
          status: "ok",
          createdAt: now,
        },
        {
          id: replyId,
          parentMessageId: userMessageId,
          conversationId: sourceId,
          role: "assistant",
          content: { version: 1, parts: [{ type: "text", text: "已有回复" }] },
          status: "ok",
          createdAt: now,
        },
      ]);
    return { sourceId, replyId };
  }
  for (const finished of [false, true])
    await t.test(`run starts during copy (finished before publication: ${finished})`, async () => {
      const { sourceId, replyId } = await seed();
      const copying = gate(),
        copied = gate();
      let target = "";
      const pending = forkConversation(auth, sourceId, replyId, {
        ...conversationForkDependencies,
        forkConversationFiles: async (input) => {
          target = input.conversationId;
          copying.open();
          await copied.promise;
          return { document_ids: {}, paths: {} };
        },
      });
      const result = pending.then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      );
      await copying.promise;
      const runId = await createAgentRun({ conversationId: sourceId, userId: auth.userId, providerId: "", model: "" });
      await acquireRunLease(sourceId, runId);
      if (finished) {
        await finishAgentRun({ runId, status: "completed" });
        await releaseRun(runId);
      }
      copied.open();
      const outcome = await result;
      if (!finished) await releaseRun(runId);
      assert.equal(outcome.value, undefined, "an overlapping run must invalidate the copied snapshot");
      assert.match(String(outcome.error), /生成|分支/);
      assert.equal((await getDb().select().from(conversations).where(eq(conversations.id, target))).length, 0);
      const [intent] = await getDb()
        .select()
        .from(conversationArtifactCleanupOutbox)
        .where(eq(conversationArtifactCleanupOutbox.conversationId, target));
      assert.equal(intent.claimedAt, null, "failed snapshot remains eligible for durable cleanup");
    });
  await t.test("publication excludes run acquisition until the branch commits", async () => {
    const { sourceId, replyId } = await seed();
    const locked = gate(),
      release = gate();
    let blocker: Promise<unknown> | undefined;
    const pending = forkConversation(auth, sourceId, replyId, {
      ...conversationForkDependencies,
      forkConversationFiles: async (input) => {
        blocker = peer.begin(async (tx) => {
          await tx`select conversation_id from conversation_artifact_cleanup_outbox where conversation_id = ${input.conversationId} for update`;
          locked.open();
          await release.promise;
        });
        await locked.promise;
        return { document_ids: {}, paths: {} };
      },
    });
    // Hold the target cleanup row so the REAL publication transaction pauses
    // after locking the source. Observe lock waits instead of relying on sleeps.
    const observer = postgres(url, { max: 1 });
    async function waitForLock(queryFragment: string) {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const [row] = await observer`select exists(select 1 from pg_stat_activity
          where datname=current_database() and wait_event_type='Lock'
          and query like ${`%${queryFragment}%`}) as waiting`;
        if (row.waiting) return;
      }
      assert.fail(`no blocked query containing ${queryFragment}`);
    }
    let acquired = false;
    let acquiring: Promise<void> | undefined;
    let runId: string | undefined;
    try {
      await waitForLock('delete from "conversation_artifact_cleanup_outbox"');
      runId = await createAgentRun({ conversationId: sourceId, userId: auth.userId, providerId: "", model: "" });
      acquiring = acquireRunLease(sourceId, runId).then(() => {
        acquired = true;
      });
      await waitForLock('insert into "conversation_run_leases"');
      assert.equal(acquired, false);
    } finally {
      release.open();
      await blocker;
      const branch = await pending;
      assert.notEqual(branch.id, sourceId);
      const copied = await listMessages(branch.id);
      assert.equal(copied.length, 2);
      assert.equal(copied[0]!.parent_message_id, null);
      assert.equal(copied[1]!.parent_message_id, copied[0]!.id);
      assert.deepEqual(
        copied.map((row) => row.branch_index),
        [0, 0],
      );
      await acquiring;
      if (runId) await releaseRun(runId);
      await observer.end();
    }
  });
  await t.test("rejected lease acquisition rolls back its revision and active runs reject before copying", async () => {
    const { sourceId, replyId } = await seed();
    const runId = await createAgentRun({ conversationId: sourceId, userId: auth.userId, providerId: "", model: "" });
    await acquireRunLease(sourceId, runId);
    const [before] = await getDb().select().from(conversations).where(eq(conversations.id, sourceId));
    const competing = await createAgentRun({
      conversationId: sourceId,
      userId: auth.userId,
      providerId: "",
      model: "",
    });
    // Direct legacy INSERT exercises the trigger's rollback under a unique-key conflict.
    await assert.rejects(peer`insert into conversation_run_leases (conversation_id,run_id,heartbeat_at,expires_at)
      values (${sourceId},${competing},now(),now()+interval '1 minute')`);
    const [after] = await getDb().select().from(conversations).where(eq(conversations.id, sourceId));
    assert.equal(before.runRevision, after.runRevision);
    let copied = false;
    await assert.rejects(
      forkConversation(auth, sourceId, replyId, {
        ...conversationForkDependencies,
        forkConversationFiles: async () => {
          copied = true;
          return { document_ids: {}, paths: {} };
        },
      }),
      /停止/,
    );
    assert.equal(copied, false);
    await releaseRun(runId);
  });
});
