import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getDb, getSql } from "../infrastructure/persistence/index.js";
import { threadArtifactCleanupOutbox, threadItems, threads } from "../infrastructure/persistence/schema.js";
import { acquireRunLease, releaseRun } from "./agent/runs/lease.js";
import { createAgentRun, finishAgentRun } from "./agent/runs/repository.js";
import { sessionForkDependencies, forkSession } from "./session-fork.js";
import { listMessages } from "./sessions.js";

// Explicit integration entry, not part of the database-free unit suite.
// Run against an isolated, migrated Runtime database with RUNTIME_FORK_TEST_URL.
const url = process.env.RUNTIME_FORK_TEST_URL;
if (!url) throw new Error("RUNTIME_FORK_TEST_URL must point to an isolated migrated Runtime database");
const connection = new URL(url);
Object.assign(process.env, {
  ENVIRONMENT: "development",
  POSTGRES_HOST: connection.hostname,
  POSTGRES_PORT: connection.port,
  POSTGRES_USER: decodeURIComponent(connection.username),
  POSTGRES_PASSWORD: decodeURIComponent(connection.password),
  POSTGRES_DATABASE: connection.pathname.slice(1),
});
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
    await getDb().transaction(async (tx) => {
      await tx.insert(threads).values({
        id: sourceId,
        createRequestId: id(),
        itemSequence: 2n,
        selectedItemId: replyId,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(threadItems).values([
        {
          id: userMessageId,
          threadId: sourceId,
          ordinal: 1n,
          role: "user",
          content: { version: 2, parts: [{ type: "text", text: "问题" }] },
          status: "ok",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: replyId,
          parentItemId: userMessageId,
          threadId: sourceId,
          ordinal: 2n,
          role: "assistant",
          content: { version: 1, parts: [{ type: "text", text: "已有回复" }] },
          status: "ok",
          createdAt: now,
          updatedAt: now,
        },
      ]);
    });
    return { sourceId, replyId };
  }
  for (const finished of [false, true])
    await t.test(`run starts during copy (finished before publication: ${finished})`, async () => {
      const { sourceId, replyId } = await seed();
      const copying = gate(),
        copied = gate();
      let target = "";
      const pending = forkSession(sourceId, replyId, {
        ...sessionForkDependencies,
        publish: async (...args) => {
          target = args[1];
          copying.open();
          await copied.promise;
          return sessionForkDependencies.publish(...args);
        },
      });
      const result = pending.then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      );
      await copying.promise;
      const runId = await createAgentRun({ sessionId: sourceId, providerId: "", model: "" });
      const lease = await acquireRunLease(sourceId, runId);
      if (finished) {
        await finishAgentRun({ ...lease, status: "completed" });
        await releaseRun(lease);
      }
      copied.open();
      const outcome = await result;
      if (!finished) await releaseRun(lease);
      assert.equal(outcome.value, undefined, "an overlapping run must invalidate the copied snapshot");
      assert.match(String(outcome.error), /生成|分支/);
      assert.equal((await getDb().select().from(threads).where(eq(threads.id, target))).length, 0);
      const intents = await getDb()
        .select()
        .from(threadArtifactCleanupOutbox)
        .where(eq(threadArtifactCleanupOutbox.threadId, target));
      assert.equal(intents.length, 0, "failed snapshot releases its fork reservation");
    });
  await t.test("publication excludes run acquisition until the branch commits", async () => {
    const { sourceId, replyId } = await seed();
    const locked = gate(),
      release = gate();
    let blocker: Promise<unknown> | undefined;
    const pending = forkSession(sourceId, replyId, {
      ...sessionForkDependencies,
      publish: async (...args) => {
        blocker = peer.begin(async (tx) => {
          await tx`select thread_id from thread_artifact_cleanup_outbox where thread_id = ${args[1]} for update`;
          locked.open();
          await release.promise;
        });
        await locked.promise;
        return sessionForkDependencies.publish(...args);
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
    let admitted = false;
    let admitting: Promise<void> | undefined;
    let runId: string | undefined;
    let runLease: Awaited<ReturnType<typeof acquireRunLease>> | undefined;
    try {
      await waitForLock('delete from "thread_artifact_cleanup_outbox"');
      admitting = createAgentRun({ sessionId: sourceId, providerId: "", model: "" }).then(async (id) => {
        runId = id;
        runLease = await acquireRunLease(sourceId, id);
        admitted = true;
      });
      await waitForLock('from "threads"');
      assert.equal(admitted, false);
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
      await admitting;
      if (runLease) await releaseRun(runLease);
      await observer.end();
    }
  });
  await t.test("rejected Turn admission rolls back its ordinal and active Turns reject before copying", async () => {
    const { sourceId, replyId } = await seed();
    const runId = await createAgentRun({ sessionId: sourceId, providerId: "", model: "" });
    const lease = await acquireRunLease(sourceId, runId);
    const [before] = await getDb().select().from(threads).where(eq(threads.id, sourceId));
    await assert.rejects(
      createAgentRun({
        sessionId: sourceId,
        providerId: "",
        model: "",
      }),
    );
    const [after] = await getDb().select().from(threads).where(eq(threads.id, sourceId));
    assert.equal(before.turnSequence, after.turnSequence);
    let copied = false;
    await assert.rejects(
      forkSession(sourceId, replyId, {
        ...sessionForkDependencies,
        publish: async (...args) => {
          copied = true;
          return sessionForkDependencies.publish(...args);
        },
      }),
      /停止/,
    );
    assert.equal(copied, false);
    await releaseRun(lease);
  });
});
