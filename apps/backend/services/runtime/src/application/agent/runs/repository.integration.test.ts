import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";

import type { ResolvedTurnPluginSnapshot } from "@repo/agent-runtime/plugins/types";
import { eq } from "drizzle-orm";

import { getDb, getSql } from "../../../infrastructure/persistence/index.js";
import {
  threadItems,
  threads,
  toolExecutions,
  turnInputs,
  turnLeases,
  turnPluginSnapshots,
  turns,
  turnSteps,
} from "../../../infrastructure/persistence/schema.js";
import { ConflictError } from "../../errors.js";
import {
  createSession as createRuntimeSession,
  deleteSession,
  listMessages,
  selectSessionHistory,
} from "../../sessions.js";
import { acquireRunLease, releaseRun } from "./lease.js";
import {
  claimAgentRunOperation,
  finalizeAgentRunJournal,
  finishAgentRun,
  interruptRuns,
  persistAgentRunPluginSnapshot,
  requestAgentRunCancellation,
} from "./repository.js";
import { acceptAgentRunInput, listAgentRunInputs } from "./steering.js";

const enabled = process.env.RUNTIME_POSTGRES_INTEGRATION === "1";

function identifier(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

function lease(claim: { runId: string; attemptEpoch: bigint }) {
  return { runId: claim.runId, attemptEpoch: claim.attemptEpoch };
}

async function createSession(): Promise<{
  sessionId: string;
  userId: string;
  auth: {
    userId: string;
    username: string;
    email: string;
    tenantId: string;
    workspaceId: string;
    workspaceRole: string;
    roles: string[];
  };
}> {
  const sessionId = identifier("cv");
  const userId = identifier("u");
  const tenantId = identifier("t");
  const workspaceId = identifier("w");
  const now = new Date();
  await getDb()
    .insert(threads)
    .values({
      id: sessionId,
      userId,
      tenantId,
      workspaceId,
      createRequestId: identifier("create"),
      model: "test-model",
      providerId: "test-provider",
      createdAt: now,
      updatedAt: now,
    });
  return {
    sessionId,
    userId,
    auth: {
      userId,
      username: userId,
      email: "",
      tenantId,
      workspaceId,
      workspaceRole: "member",
      roles: [],
    },
  };
}

async function claimSubmit(
  sessionId: string,
  userId: string,
  requestId = identifier("req"),
  inputMessageId = identifier("msg"),
) {
  const claim = await claimAgentRunOperation({
    sessionId,
    userId,
    providerId: "test-provider",
    model: "test-model",
    requestId,
    expectedRevision: 0,
    operation: "submit-message",
    inputMessage: {
      id: inputMessageId,
      role: "user",
      content: { version: 2, parts: [{ type: "text", text: "hello" }] },
    },
  });
  return { ...claim, inputMessageId };
}

async function cleanup(sessionId: string): Promise<void> {
  await getDb().delete(threads).where(eq(threads.id, sessionId));
}

after(async () => {
  if (enabled) await getSql().end();
});

test("concurrent claims serialize on history revision", { skip: !enabled }, async () => {
  const { sessionId, userId } = await createSession();
  try {
    const claims = await Promise.allSettled([
      claimSubmit(sessionId, userId, identifier("req")),
      claimSubmit(sessionId, userId, identifier("req")),
    ]);
    const fulfilled = claims.filter((result) => result.status === "fulfilled");
    const rejected = claims.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0]?.reason instanceof ConflictError);
    assert.equal(rejected[0]?.reason.code, "history_revision_conflict");

    const runs = await getDb().select().from(turns).where(eq(turns.threadId, sessionId));
    const persistedMessages = await getDb().select().from(threadItems).where(eq(threadItems.threadId, sessionId));
    const leases = await getDb().select().from(turnLeases).where(eq(turnLeases.threadId, sessionId));
    assert.equal(runs.length, 1);
    assert.equal(persistedMessages.length, 1);
    assert.equal(leases.length, 1);
  } finally {
    await cleanup(sessionId);
  }
});

test("Turn plugin snapshots are immutable and never persist connection grants", { skip: !enabled }, async () => {
  const { sessionId, userId } = await createSession();
  try {
    const claim = await claimSubmit(sessionId, userId);
    const snapshot: ResolvedTurnPluginSnapshot = {
      schemaVersion: 1,
      snapshotId: identifier("snapshot"),
      snapshotDigest: `sha256:${"a".repeat(64)}`,
      workspaceRevision: 1,
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      resolvedAt: new Date().toISOString(),
      plugins: [],
      connectionGrants: [
        {
          pluginId: "knowledge@platform",
          serverName: "knowledge",
          headers: { authorization: "Bearer must-not-persist" },
        },
      ],
    };

    await persistAgentRunPluginSnapshot(lease(claim), snapshot);
    await persistAgentRunPluginSnapshot(lease(claim), snapshot);
    const [row] = await getDb()
      .select({ snapshot: turnPluginSnapshots.snapshot })
      .from(turnPluginSnapshots)
      .where(eq(turnPluginSnapshots.turnId, claim.runId));
    assert.ok(row);
    const serialized = JSON.stringify(row.snapshot);
    assert.equal(serialized.includes("connectionGrants"), false);
    assert.equal(serialized.includes("must-not-persist"), false);

    await assert.rejects(
      persistAgentRunPluginSnapshot(lease(claim), { ...snapshot, snapshotId: identifier("snapshot") }),
      /plugin snapshot is immutable/,
    );
  } finally {
    await cleanup(sessionId);
  }
});

test("lease takeover increments the epoch and fences the old Turn owner", { skip: !enabled }, async () => {
  const { sessionId, userId } = await createSession();
  try {
    const claim = await claimSubmit(sessionId, userId);
    await getDb()
      .update(turnLeases)
      .set({ expiresAt: new Date(0) })
      .where(eq(turnLeases.turnId, claim.runId));
    const next = await acquireRunLease(sessionId, claim.runId);
    assert.equal(next.attemptEpoch, claim.attemptEpoch + 1n);
    await assert.rejects(
      persistAgentRunPluginSnapshot(lease(claim), {
        schemaVersion: 1,
        snapshotId: identifier("snapshot"),
        snapshotDigest: "a".repeat(64),
        workspaceRevision: 1,
        tenantId: "tenant",
        workspaceId: "workspace",
        resolvedAt: new Date().toISOString(),
        plugins: [],
        connectionGrants: [],
      }),
      (error: unknown) => error instanceof ConflictError && error.code === "run_lease_lost",
    );
    await releaseRun(lease(claim));
    const [current] = await getDb().select().from(turnLeases).where(eq(turnLeases.turnId, claim.runId));
    assert.equal(current?.attemptEpoch, next.attemptEpoch, "stale release must not delete the new owner lease");
    await releaseRun(next);
  } finally {
    await cleanup(sessionId);
  }
});

test(
  "session creation retries reuse the same Runtime session and reject changed input",
  { skip: !enabled },
  async () => {
    const auth = {
      userId: identifier("u"),
      username: "session-user",
      email: "",
      tenantId: identifier("t"),
      workspaceId: identifier("w"),
      workspaceRole: "member",
      roles: [],
    };
    const requestId = identifier("create");
    const first = await createRuntimeSession(auth, {
      request_id: requestId,
      provider_id: "provider-a",
      approval_policy: "unless-trusted",
      permission_profile: ":read-only",
    });
    try {
      assert.equal(first.approval_policy, "unless-trusted");
      assert.equal(first.permission_profile, ":read-only");
      const retry = await createRuntimeSession(auth, {
        request_id: requestId,
        provider_id: "provider-a",
        approval_policy: "unless-trusted",
        permission_profile: ":read-only",
      });
      assert.equal(retry.id, first.id);
      await assert.rejects(
        createRuntimeSession(auth, {
          request_id: requestId,
          provider_id: "provider-a",
          approval_policy: "on-request",
          permission_profile: ":read-only",
        }),
        (error: unknown) => error instanceof ConflictError,
      );
    } finally {
      await cleanup(first.id);
    }
  },
);

test("history selection reclaims terminal and expired run leases", { skip: !enabled }, async () => {
  for (const staleKind of ["terminal", "expired"] as const) {
    const { sessionId, userId, auth } = await createSession();
    try {
      const claim = await claimSubmit(sessionId, userId);
      if (staleKind === "terminal") {
        await getDb()
          .update(turns)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(turns.id, claim.runId));
      } else {
        await getDb()
          .update(turnLeases)
          .set({ expiresAt: new Date(0) })
          .where(eq(turnLeases.turnId, claim.runId));
      }

      const detail = await selectSessionHistory(auth, sessionId, {
        leaf_message_id: claim.inputMessageId,
        expected_revision: 1,
      });
      assert.equal(detail.selected_message_id, claim.inputMessageId);
      assert.equal(detail.revision, 2);
      const [run] = await getDb().select().from(turns).where(eq(turns.id, claim.runId));
      assert.equal(run?.status, staleKind === "terminal" ? "completed" : "interrupted");
      const leases = await getDb().select().from(turnLeases).where(eq(turnLeases.threadId, sessionId));
      assert.equal(leases.length, 0);
    } finally {
      await cleanup(sessionId);
    }
  }
});

test("terminal run cleanup and session deletion cannot leave blocking leases", { skip: !enabled }, async () => {
  const finished = await createSession();
  const deleted = await createSession();
  try {
    const finishedClaim = await claimSubmit(finished.sessionId, finished.userId);
    await finishAgentRun({ ...lease(finishedClaim), status: "failed", error: "provider failed" });
    assert.equal(
      (await getDb().select().from(turnLeases).where(eq(turnLeases.threadId, finished.sessionId))).length,
      0,
    );

    const deletedClaim = await claimSubmit(deleted.sessionId, deleted.userId);
    await getDb()
      .update(turns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(turns.id, deletedClaim.runId));
    await deleteSession(deleted.auth, deleted.sessionId);
    assert.equal((await getDb().select().from(threads).where(eq(threads.id, deleted.sessionId))).length, 0);
    assert.equal((await getDb().select().from(turnLeases).where(eq(turnLeases.threadId, deleted.sessionId))).length, 0);
  } finally {
    await cleanup(finished.sessionId);
    await cleanup(deleted.sessionId);
  }
});

test("message listing reads the selected pointer and graph from one ordered snapshot", { skip: !enabled }, async () => {
  const { sessionId, userId } = await createSession();
  try {
    const claim = await claimSubmit(sessionId, userId);
    const newLeafId = identifier("msg");
    let listing: ReturnType<typeof listMessages> | undefined;
    await getSql().begin(async (tx) => {
      const [blocker] = await tx`select pg_backend_pid() as pid`;
      await tx`lock table threads in access exclusive mode`;
      listing = listMessages(sessionId);
      const deadline = Date.now() + 5_000;
      while (true) {
        const blocked = await getSql()`
          select pid from pg_stat_activity where ${blocker!.pid} = any(pg_blocking_pids(pid))
        `;
        if (blocked.length > 0) break;
        assert.ok(Date.now() < deadline, "message listing did not reach the session lock");
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
      }
      await tx`
        with next_item as (
          update threads
          set item_sequence = item_sequence + 1,
              history_revision = history_revision + 1,
              selected_item_id = ${newLeafId},
              updated_at = now()
          where id = ${sessionId}
          returning item_sequence
        )
        insert into thread_items (
          id, thread_id, turn_id, ordinal, role, content, status,
          parent_item_id, branch_index, revision, created_at, updated_at
        )
        select ${newLeafId}, ${sessionId}, ${claim.runId}, next_item.item_sequence, 'assistant',
          ${JSON.stringify({ version: 2, parts: [{ type: "text", text: "new leaf" }] })}::jsonb,
          'ok', ${claim.inputMessageId}, 0, 1, now(), now()
        from next_item
      `;
    });

    const history = await listing;
    assert.deepEqual(
      history?.map((message) => message.id),
      [claim.inputMessageId, newLeafId],
    );
  } finally {
    await cleanup(sessionId);
  }
});

test("an exact request retry reuses its run while changed payload is rejected", { skip: !enabled }, async () => {
  const { sessionId, userId } = await createSession();
  try {
    const requestId = identifier("req");
    const inputMessageId = identifier("msg");
    const first = await claimSubmit(sessionId, userId, requestId, inputMessageId);
    const duplicate = await claimSubmit(sessionId, userId, requestId, inputMessageId);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.runId, first.runId);
    assert.equal(duplicate.historyRevision, first.historyRevision);

    await assert.rejects(
      claimAgentRunOperation({
        sessionId,
        userId,
        providerId: "test-provider",
        model: "test-model",
        requestId,
        expectedRevision: 0,
        operation: "submit-message",
        inputMessage: {
          id: inputMessageId,
          role: "user",
          content: { version: 2, parts: [{ type: "text", text: "changed after retry" }] },
        },
      }),
      (error: unknown) => error instanceof ConflictError && error.code === "request_id_conflict",
    );

    const runs = await getDb().select().from(turns).where(eq(turns.threadId, sessionId));
    const persistedMessages = await getDb().select().from(threadItems).where(eq(threadItems.threadId, sessionId));
    assert.equal(runs.length, 1);
    assert.equal(persistedMessages.length, 1);
  } finally {
    await cleanup(sessionId);
  }
});

test("journal finalization rolls tool updates back with message failure", { skip: !enabled }, async () => {
  const { sessionId, userId } = await createSession();
  try {
    const claim = await claimSubmit(sessionId, userId);
    const toolCallId = identifier("tool");
    await getDb().insert(toolExecutions).values({
      id: toolCallId,
      turnId: claim.runId,
      toolName: "test_tool",
      status: "running",
      inputJson: {},
      createdAt: new Date(),
    });

    const output = { ok: true, status: "completed", data: { value: 1 } };
    await assert.rejects(
      finalizeAgentRunJournal({
        ...lease(claim),
        parts: [{ type: "tool-test_tool", toolCallId, state: "output-available", output }],
        aborted: false,
        message: {
          id: claim.inputMessageId,
          content: { version: 2, parts: [{ type: "text", text: "collision" }] },
          status: "ok",
        },
        status: "completed",
      }),
    );

    const [toolCall] = await getDb().select().from(toolExecutions).where(eq(toolExecutions.id, toolCallId));
    const [run] = await getDb().select().from(turns).where(eq(turns.id, claim.runId));
    const leases = await getDb().select().from(turnLeases).where(eq(turnLeases.turnId, claim.runId));
    const persistedMessages = await getDb().select().from(threadItems).where(eq(threadItems.threadId, sessionId));
    assert.equal(toolCall?.status, "running");
    assert.equal(toolCall?.outputJson, null);
    assert.equal(run?.status, "running");
    assert.equal(run?.outputItemId, null);
    assert.equal(leases.length, 1);
    assert.equal(persistedMessages.length, 1);
  } finally {
    await cleanup(sessionId);
  }
});

test("journal finalization is idempotent and cancellation closes tool state", { skip: !enabled }, async () => {
  const { sessionId, userId } = await createSession();
  try {
    const claim = await claimSubmit(sessionId, userId);
    const runningToolId = identifier("tool");
    const todoToolId = identifier("todo");
    const todoOutput = {
      ok: true,
      status: "completed",
      data: {
        todos: [
          { id: "done", status: "completed" },
          { id: "open", status: "pending" },
        ],
      },
    };
    await getDb()
      .insert(toolExecutions)
      .values([
        {
          id: runningToolId,
          turnId: claim.runId,
          toolName: "client_tool",
          status: "running",
          inputJson: {},
          createdAt: new Date(),
        },
        {
          id: todoToolId,
          turnId: claim.runId,
          toolName: "update_todos",
          status: "completed",
          inputJson: {},
          outputJson: todoOutput,
          createdAt: new Date(),
          completedAt: new Date(),
        },
      ]);
    const outputMessageId = identifier("msg");
    const first = await finalizeAgentRunJournal({
      ...lease(claim),
      parts: [{ type: "tool-client_tool", toolCallId: runningToolId, state: "output-error", errorText: "已取消。" }],
      aborted: true,
      message: {
        id: outputMessageId,
        content: { version: 2, parts: [{ type: "text", text: "cancelled" }] },
        status: "failed",
      },
      status: "cancelled",
    });
    const duplicate = await finalizeAgentRunJournal({
      ...lease(claim),
      parts: [],
      aborted: false,
      message: {
        id: identifier("msg"),
        content: { version: 2, parts: [{ type: "text", text: "must not persist" }] },
        status: "ok",
      },
      status: "completed",
    });

    assert.deepEqual(duplicate, first);
    assert.equal(first.outputMessageId, outputMessageId);
    const toolCalls = await getDb().select().from(toolExecutions).where(eq(toolExecutions.turnId, claim.runId));
    const running = toolCalls.find((row) => row.id === runningToolId);
    const todo = toolCalls.find((row) => row.id === todoToolId);
    assert.equal(running?.status, "failed");
    assert.equal(running?.error, "已取消。");
    assert.deepEqual(todo?.outputJson, {
      ...todoOutput,
      data: {
        todos: [
          { id: "done", status: "completed" },
          { id: "open", status: "cancelled" },
        ],
      },
    });
    const [run] = await getDb().select().from(turns).where(eq(turns.id, claim.runId));
    const persistedMessages = await getDb().select().from(threadItems).where(eq(threadItems.threadId, sessionId));
    const leases = await getDb().select().from(turnLeases).where(eq(turnLeases.turnId, claim.runId));
    assert.equal(run?.status, "cancelled");
    assert.equal(run?.outputItemId, outputMessageId);
    assert.equal(persistedMessages.length, 2);
    assert.equal(leases.length, 0);
  } finally {
    await cleanup(sessionId);
  }
});

test("client continuation validation and journal merge share the claim transaction", { skip: !enabled }, async () => {
  const { sessionId, userId } = await createSession();
  try {
    const claim = await claimSubmit(sessionId, userId);
    const assistantId = identifier("msg");
    const awaiting = {
      type: "tool-ask_user" as const,
      toolCallId: "question",
      state: "input-available" as const,
      input: {
        questions: [
          { id: "q", question: "Choose", mode: "single", choices: [{ label: "A", value: "a" }], allow_freeform: false },
        ],
      },
      toolMetadata: { agent: { execution: "client" } },
    };
    await finalizeAgentRunJournal({
      ...lease(claim),
      parts: [awaiting],
      aborted: false,
      status: "completed",
      message: { id: assistantId, status: "ok", content: { version: 2, parts: [awaiting] } },
    });
    const operation = {
      sessionId,
      userId,
      providerId: "test-provider",
      model: "test-model",
      requestId: identifier("req"),
      expectedRevision: 1,
      operation: "tool-continuation" as const,
      targetMessageId: assistantId,
    };
    const response = (value: string) => ({
      id: assistantId,
      role: "assistant" as const,
      parts: [
        {
          ...awaiting,
          state: "output-available" as const,
          output: { ok: true, status: "completed", data: { answers: [{ id: "q", values: [value] }] } },
        },
      ],
    });
    await assert.rejects(
      claimAgentRunOperation({ ...operation, continuationMessage: response("forged") }),
      /unknown choice/,
    );
    const [unchanged] = await getDb().select().from(threads).where(eq(threads.id, sessionId));
    const [message] = await getDb().select().from(threadItems).where(eq(threadItems.id, assistantId));
    assert.equal(unchanged?.historyRevision, 1n);
    assert.deepEqual(message?.content.parts, [awaiting]);
    assert.equal((await getDb().select().from(turns).where(eq(turns.threadId, sessionId))).length, 1);
    assert.equal((await getDb().select().from(turnLeases).where(eq(turnLeases.threadId, sessionId))).length, 0);
    const valid = { ...operation, continuationMessage: response("a") };
    const continued = await claimAgentRunOperation(valid);
    const retried = await claimAgentRunOperation(valid);
    assert.equal(retried.runId, continued.runId);
    assert.equal(retried.duplicate, true);
    const [merged] = await getDb().select().from(threadItems).where(eq(threadItems.id, assistantId));
    assert.deepEqual(merged?.content.parts, valid.continuationMessage.parts);
  } finally {
    await cleanup(sessionId);
  }
});

test(
  "finalization locks session before run so an expired lease claim cannot deadlock",
  { skip: !enabled },
  async () => {
    const { sessionId, userId } = await createSession();
    let finalizing: ReturnType<typeof finalizeAgentRunJournal> | undefined;
    try {
      const claim = await claimSubmit(sessionId, userId);
      await getSql().begin(async (tx) => {
        const [blocker] = await tx`select pg_backend_pid() as pid`;
        await tx`select id from threads where id = ${sessionId} for update`;
        finalizing = finalizeAgentRunJournal({
          ...lease(claim),
          parts: [],
          aborted: false,
          message: null,
          status: "completed",
        });
        // Wait for the actual row lock, not a timing guess about query completion.
        const deadline = Date.now() + 5_000;
        while (true) {
          const blocked = await getSql()`
          select pid from pg_stat_activity where ${blocker!.pid} = any(pg_blocking_pids(pid))
        `;
          if (blocked.length > 0) break;
          assert.ok(Date.now() < deadline, "finalizer did not reach the session lock");
          await new Promise((resolve) => {
            setTimeout(resolve, 10);
          });
        }
        await tx`select id from turns where id = ${claim.runId} for update nowait`;
      });
    } finally {
      await finalizing;
      await cleanup(sessionId);
    }
  },
);

test("terminal cleanup locks session before run and lease", { skip: !enabled }, async () => {
  const { sessionId, userId } = await createSession();
  let finishing: ReturnType<typeof finishAgentRun> | undefined;
  try {
    const claim = await claimSubmit(sessionId, userId);
    await getSql().begin(async (tx) => {
      const [blocker] = await tx`select pg_backend_pid() as pid`;
      await tx`select id from threads where id = ${sessionId} for update`;
      finishing = finishAgentRun({ ...lease(claim), status: "failed", error: "provider failed" });
      const deadline = Date.now() + 5_000;
      while (true) {
        const blocked = await getSql()`
          select pid from pg_stat_activity where ${blocker!.pid} = any(pg_blocking_pids(pid))
        `;
        if (blocked.length > 0) break;
        assert.ok(Date.now() < deadline, "terminal cleanup did not reach the session lock");
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
      }
      await tx`select id from turns where id = ${claim.runId} for update nowait`;
      await tx`select turn_id from turn_leases where turn_id = ${claim.runId} for update nowait`;
    });
  } finally {
    await finishing;
    await cleanup(sessionId);
  }
});

test("a trace completion gap cannot override the SDK outcome or leave a running step", { skip: !enabled }, async () => {
  const { sessionId, userId } = await createSession();
  try {
    const claim = await claimSubmit(sessionId, userId);
    await getDb()
      .insert(turnSteps)
      .values({
        id: identifier("step"),
        turnId: claim.runId,
        stepIndex: 0,
        kind: "model",
        status: "running",
        createdAt: new Date(),
      });
    const messageId = identifier("msg");
    await finalizeAgentRunJournal({
      ...lease(claim),
      parts: [{ type: "text", text: "partial" }],
      aborted: false,
      status: "completed",
      message: {
        id: messageId,
        status: "ok",
        content: { version: 2, parts: [{ type: "text", text: "partial" }], metadata: { status: "completed" } },
      },
    });
    const [run] = await getDb().select().from(turns).where(eq(turns.id, claim.runId));
    const [message] = await getDb().select().from(threadItems).where(eq(threadItems.id, messageId));
    const [step] = await getDb().select().from(turnSteps).where(eq(turnSteps.turnId, claim.runId));
    assert.equal(run?.status, "completed");
    assert.equal(message?.status, "ok");
    assert.equal(message?.content.metadata?.status, "completed");
    assert.equal(step?.status, "failed");
    assert.match(step?.summary ?? "", /trace/);
    assert.deepEqual(message?.content.parts, [{ type: "text", text: "partial" }]);
  } finally {
    await cleanup(sessionId);
  }
});

test("cancellation committed after the stream snapshot wins in journal finalization", { skip: !enabled }, async () => {
  const { sessionId, userId } = await createSession();
  try {
    const claim = await claimSubmit(sessionId, userId);
    const toolCallId = identifier("tool");
    const parts = [{ type: "tool-ask_user", toolCallId, state: "input-available", input: {} }];
    await getDb().insert(toolExecutions).values({
      id: toolCallId,
      turnId: claim.runId,
      toolName: "ask_user",
      status: "running",
      inputJson: {},
      createdAt: new Date(),
    });
    await requestAgentRunCancellation(claim.runId);
    const messageId = identifier("msg");
    await finalizeAgentRunJournal({
      ...lease(claim),
      parts,
      aborted: false,
      status: "completed",
      message: {
        id: messageId,
        status: "ok",
        content: { version: 2, parts, metadata: { status: "completed" } },
      },
    });
    const [run] = await getDb().select().from(turns).where(eq(turns.id, claim.runId));
    const [message] = await getDb().select().from(threadItems).where(eq(threadItems.id, messageId));
    const [toolCall] = await getDb().select().from(toolExecutions).where(eq(toolExecutions.id, toolCallId));
    assert.equal(run?.status, "cancelled");
    assert.equal(message?.status, "failed");
    assert.equal(message?.content.metadata?.status, "cancelled");
    assert.ok(message);
    assert.equal((message.content.parts[0] as { state: string }).state, "output-error");
    assert.equal(toolCall?.status, "failed");
  } finally {
    await cleanup(sessionId);
  }
});

test(
  "late cleanup failure and stale orphan snapshots cannot overwrite a committed run",
  { skip: !enabled },
  async () => {
    const { sessionId, userId } = await createSession();
    try {
      const claim = await claimSubmit(sessionId, userId);
      await finalizeAgentRunJournal({
        ...lease(claim),
        parts: [],
        aborted: false,
        message: null,
        status: "completed",
      });
      await finishAgentRun({ ...lease(claim), status: "failed", error: "cleanup failed after commit" });
      let [run] = await getDb().select().from(turns).where(eq(turns.id, claim.runId));
      assert.equal(run?.status, "completed");
      await interruptRuns([claim.runId]);
      [run] = await getDb().select().from(turns).where(eq(turns.id, claim.runId));
      assert.equal(run?.status, "completed");
    } finally {
      await cleanup(sessionId);
    }
  },
);

test("orphan reconciliation rechecks a renewed lease before interrupting", { skip: !enabled }, async () => {
  const { sessionId, userId } = await createSession();
  try {
    const claim = await claimSubmit(sessionId, userId);
    await interruptRuns([claim.runId]);
    let [run] = await getDb().select().from(turns).where(eq(turns.id, claim.runId));
    assert.equal(run?.status, "running");
    await getDb()
      .update(turnLeases)
      .set({ expiresAt: new Date(0) })
      .where(eq(turnLeases.turnId, claim.runId));
    await interruptRuns([claim.runId]);
    [run] = await getDb().select().from(turns).where(eq(turns.id, claim.runId));
    assert.equal(run?.status, "interrupted");
  } finally {
    await cleanup(sessionId);
  }
});

test(
  "run input admission is idempotent, payload-bound, recoverable, and terminalized",
  { skip: !enabled },
  async () => {
    const { sessionId, userId } = await createSession();
    try {
      const claim = await claimSubmit(sessionId, userId);
      const clientMessageId = identifier("input");
      const input = {
        sessionId,
        runId: claim.runId,
        userId,
        clientMessageId,
        mode: "follow-up" as const,
        text: "use the other city",
      };
      const accepted = await acceptAgentRunInput(input);
      assert.equal(accepted.state, "accepted");
      assert.deepEqual(await acceptAgentRunInput(input), accepted);
      await assert.rejects(
        acceptAgentRunInput({ ...input, text: "changed payload" }),
        (error: unknown) => error instanceof ConflictError && error.code === "run_input_id_conflict",
      );
      assert.deepEqual(await listAgentRunInputs({ sessionId, runId: claim.runId, userId }), [accepted]);

      await finishAgentRun({ ...lease(claim), status: "completed" });
      const [settled] = await getDb().select().from(turnInputs).where(eq(turnInputs.id, clientMessageId));
      assert.equal(settled?.state, "not_delivered");
      assert.equal(settled?.reason, "finished");
      const retried = await acceptAgentRunInput(input);
      assert.equal(retried.state, "not_delivered");
      assert.equal(retried.reason, "finished");
    } finally {
      await cleanup(sessionId);
    }
  },
);
