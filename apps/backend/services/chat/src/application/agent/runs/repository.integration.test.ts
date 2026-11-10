import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";

import { eq } from "drizzle-orm";

import { getDb, getSql } from "../../../infrastructure/persistence/index.js";
import {
  agentRuns,
  agentSteps,
  agentToolCalls,
  conversations,
  conversationRunLeases,
  messages,
} from "../../../infrastructure/persistence/schema.js";
import { deleteConversation, listMessages, selectConversationHistory } from "../../conversations.js";
import { ConflictError } from "../../errors.js";
import {
  claimAgentRunOperation,
  finalizeAgentRunJournal,
  finishAgentRun,
  interruptRuns,
  requestAgentRunCancellation,
} from "./repository.js";

const enabled = process.env.CHAT_POSTGRES_INTEGRATION === "1";

function identifier(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

async function createConversation(): Promise<{
  conversationId: string;
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
  const conversationId = identifier("cv");
  const userId = identifier("u");
  const tenantId = identifier("t");
  const workspaceId = identifier("w");
  const now = new Date();
  await getDb().insert(conversations).values({
    id: conversationId,
    userId,
    tenantId,
    workspaceId,
    title: "integration test",
    model: "test-model",
    providerId: "test-provider",
    createdAt: now,
    updatedAt: now,
  });
  return {
    conversationId,
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
  conversationId: string,
  userId: string,
  requestId = identifier("req"),
  inputMessageId = identifier("msg"),
) {
  const claim = await claimAgentRunOperation({
    conversationId,
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

async function cleanup(conversationId: string): Promise<void> {
  await getDb().delete(conversations).where(eq(conversations.id, conversationId));
}

after(async () => {
  if (enabled) await getSql().end();
});

test("concurrent claims serialize on history revision", { skip: !enabled }, async () => {
  const { conversationId, userId } = await createConversation();
  try {
    const claims = await Promise.allSettled([
      claimSubmit(conversationId, userId, identifier("req")),
      claimSubmit(conversationId, userId, identifier("req")),
    ]);
    const fulfilled = claims.filter((result) => result.status === "fulfilled");
    const rejected = claims.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0]?.reason instanceof ConflictError);
    assert.equal(rejected[0]?.reason.code, "history_revision_conflict");

    const runs = await getDb().select().from(agentRuns).where(eq(agentRuns.conversationId, conversationId));
    const persistedMessages = await getDb().select().from(messages).where(eq(messages.conversationId, conversationId));
    const leases = await getDb()
      .select()
      .from(conversationRunLeases)
      .where(eq(conversationRunLeases.conversationId, conversationId));
    assert.equal(runs.length, 1);
    assert.equal(persistedMessages.length, 1);
    assert.equal(leases.length, 1);
  } finally {
    await cleanup(conversationId);
  }
});

test("history selection reclaims terminal and expired run leases", { skip: !enabled }, async () => {
  for (const staleKind of ["terminal", "expired"] as const) {
    const { conversationId, userId, auth } = await createConversation();
    try {
      const claim = await claimSubmit(conversationId, userId);
      if (staleKind === "terminal") {
        await getDb()
          .update(agentRuns)
          .set({ status: "completed", finishedAt: new Date() })
          .where(eq(agentRuns.id, claim.runId));
      } else {
        await getDb()
          .update(conversationRunLeases)
          .set({ expiresAt: new Date(0) })
          .where(eq(conversationRunLeases.runId, claim.runId));
      }

      const detail = await selectConversationHistory(auth, conversationId, {
        leaf_message_id: claim.inputMessageId,
        expected_revision: 1,
      });
      assert.equal(detail.selected_message_id, claim.inputMessageId);
      assert.equal(detail.revision, 2);
      const [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, claim.runId));
      assert.equal(run?.status, staleKind === "terminal" ? "completed" : "interrupted");
      const leases = await getDb()
        .select()
        .from(conversationRunLeases)
        .where(eq(conversationRunLeases.conversationId, conversationId));
      assert.equal(leases.length, 0);
    } finally {
      await cleanup(conversationId);
    }
  }
});

test("terminal run cleanup and conversation deletion cannot leave blocking leases", { skip: !enabled }, async () => {
  const finished = await createConversation();
  const deleted = await createConversation();
  try {
    const finishedClaim = await claimSubmit(finished.conversationId, finished.userId);
    await finishAgentRun({ runId: finishedClaim.runId, status: "failed", error: "provider failed" });
    assert.equal(
      (
        await getDb()
          .select()
          .from(conversationRunLeases)
          .where(eq(conversationRunLeases.conversationId, finished.conversationId))
      ).length,
      0,
    );

    const deletedClaim = await claimSubmit(deleted.conversationId, deleted.userId);
    await getDb()
      .update(agentRuns)
      .set({ status: "completed", finishedAt: new Date() })
      .where(eq(agentRuns.id, deletedClaim.runId));
    await deleteConversation(deleted.auth, deleted.conversationId);
    assert.equal(
      (await getDb().select().from(conversations).where(eq(conversations.id, deleted.conversationId))).length,
      0,
    );
    assert.equal(
      (
        await getDb()
          .select()
          .from(conversationRunLeases)
          .where(eq(conversationRunLeases.conversationId, deleted.conversationId))
      ).length,
      0,
    );
  } finally {
    await cleanup(finished.conversationId);
    await cleanup(deleted.conversationId);
  }
});

test("message listing reads the selected pointer and graph from one ordered snapshot", { skip: !enabled }, async () => {
  const { conversationId, userId } = await createConversation();
  try {
    const claim = await claimSubmit(conversationId, userId);
    const newLeafId = identifier("msg");
    let listing: ReturnType<typeof listMessages> | undefined;
    await getSql().begin(async (tx) => {
      const [blocker] = await tx`select pg_backend_pid() as pid`;
      await tx`lock table conversations in access exclusive mode`;
      listing = listMessages(conversationId);
      const deadline = Date.now() + 5_000;
      while (true) {
        const blocked = await getSql()`
          select pid from pg_stat_activity where ${blocker!.pid} = any(pg_blocking_pids(pid))
        `;
        if (blocked.length > 0) break;
        assert.ok(Date.now() < deadline, "message listing did not reach the conversation lock");
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
      }
      await tx`
        insert into messages (
          id, conversation_id, role, content, status, parent_message_id, branch_index, created_at
        ) values (
          ${newLeafId}, ${conversationId}, 'assistant',
          ${JSON.stringify({ version: 2, parts: [{ type: "text", text: "new leaf" }] })}::jsonb,
          'ok', ${claim.inputMessageId}, 0, now()
        )
      `;
      await tx`
        update conversations set selected_message_id = ${newLeafId}, updated_at = now()
        where id = ${conversationId}
      `;
    });

    const history = await listing;
    assert.deepEqual(
      history?.map((message) => message.id),
      [claim.inputMessageId, newLeafId],
    );
  } finally {
    await cleanup(conversationId);
  }
});

test("an exact request retry reuses its run while changed payload is rejected", { skip: !enabled }, async () => {
  const { conversationId, userId } = await createConversation();
  try {
    const requestId = identifier("req");
    const inputMessageId = identifier("msg");
    const first = await claimSubmit(conversationId, userId, requestId, inputMessageId);
    const duplicate = await claimSubmit(conversationId, userId, requestId, inputMessageId);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.runId, first.runId);
    assert.equal(duplicate.historyRevision, first.historyRevision);

    await assert.rejects(
      claimAgentRunOperation({
        conversationId,
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

    const runs = await getDb().select().from(agentRuns).where(eq(agentRuns.conversationId, conversationId));
    const persistedMessages = await getDb().select().from(messages).where(eq(messages.conversationId, conversationId));
    assert.equal(runs.length, 1);
    assert.equal(persistedMessages.length, 1);
  } finally {
    await cleanup(conversationId);
  }
});

test("journal finalization rolls tool updates back with message failure", { skip: !enabled }, async () => {
  const { conversationId, userId } = await createConversation();
  try {
    const claim = await claimSubmit(conversationId, userId);
    const toolCallId = identifier("tool");
    await getDb().insert(agentToolCalls).values({
      id: toolCallId,
      runId: claim.runId,
      toolName: "test_tool",
      status: "running",
      inputJson: {},
      createdAt: new Date(),
    });

    const output = { ok: true, status: "completed", data: { value: 1 } };
    await assert.rejects(
      finalizeAgentRunJournal({
        runId: claim.runId,
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

    const [toolCall] = await getDb().select().from(agentToolCalls).where(eq(agentToolCalls.id, toolCallId));
    const [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, claim.runId));
    const leases = await getDb()
      .select()
      .from(conversationRunLeases)
      .where(eq(conversationRunLeases.runId, claim.runId));
    const persistedMessages = await getDb().select().from(messages).where(eq(messages.conversationId, conversationId));
    assert.equal(toolCall?.status, "running");
    assert.equal(toolCall?.outputJson, null);
    assert.equal(run?.status, "running");
    assert.equal(run?.outputMessageId, null);
    assert.equal(leases.length, 1);
    assert.equal(persistedMessages.length, 1);
  } finally {
    await cleanup(conversationId);
  }
});

test("journal finalization is idempotent and cancellation closes tool state", { skip: !enabled }, async () => {
  const { conversationId, userId } = await createConversation();
  try {
    const claim = await claimSubmit(conversationId, userId);
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
      .insert(agentToolCalls)
      .values([
        {
          id: runningToolId,
          runId: claim.runId,
          toolName: "client_tool",
          status: "running",
          inputJson: {},
          createdAt: new Date(),
        },
        {
          id: todoToolId,
          runId: claim.runId,
          toolName: "update_todos",
          status: "completed",
          inputJson: {},
          outputJson: todoOutput,
          createdAt: new Date(),
          finishedAt: new Date(),
        },
      ]);
    const outputMessageId = identifier("msg");
    const first = await finalizeAgentRunJournal({
      runId: claim.runId,
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
      runId: claim.runId,
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
    const toolCalls = await getDb().select().from(agentToolCalls).where(eq(agentToolCalls.runId, claim.runId));
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
    const [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, claim.runId));
    const persistedMessages = await getDb().select().from(messages).where(eq(messages.conversationId, conversationId));
    const leases = await getDb()
      .select()
      .from(conversationRunLeases)
      .where(eq(conversationRunLeases.runId, claim.runId));
    assert.equal(run?.status, "cancelled");
    assert.equal(run?.outputMessageId, outputMessageId);
    assert.equal(persistedMessages.length, 2);
    assert.equal(leases.length, 0);
  } finally {
    await cleanup(conversationId);
  }
});

test("client continuation validation and journal merge share the claim transaction", { skip: !enabled }, async () => {
  const { conversationId, userId } = await createConversation();
  try {
    const claim = await claimSubmit(conversationId, userId);
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
      runId: claim.runId,
      parts: [awaiting],
      aborted: false,
      status: "completed",
      message: { id: assistantId, status: "ok", content: { version: 2, parts: [awaiting] } },
    });
    const operation = {
      conversationId,
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
    const [unchanged] = await getDb().select().from(conversations).where(eq(conversations.id, conversationId));
    const [message] = await getDb().select().from(messages).where(eq(messages.id, assistantId));
    assert.equal(unchanged?.historyRevision, 1n);
    assert.deepEqual(message?.content.parts, [awaiting]);
    assert.equal(
      (await getDb().select().from(agentRuns).where(eq(agentRuns.conversationId, conversationId))).length,
      1,
    );
    assert.equal(
      (
        await getDb()
          .select()
          .from(conversationRunLeases)
          .where(eq(conversationRunLeases.conversationId, conversationId))
      ).length,
      0,
    );
    const valid = { ...operation, continuationMessage: response("a") };
    const continued = await claimAgentRunOperation(valid);
    const retried = await claimAgentRunOperation(valid);
    assert.equal(retried.runId, continued.runId);
    assert.equal(retried.duplicate, true);
    const [merged] = await getDb().select().from(messages).where(eq(messages.id, assistantId));
    assert.deepEqual(merged?.content.parts, valid.continuationMessage.parts);
  } finally {
    await cleanup(conversationId);
  }
});

test(
  "finalization locks conversation before run so an expired lease claim cannot deadlock",
  { skip: !enabled },
  async () => {
    const { conversationId, userId } = await createConversation();
    let finalizing: ReturnType<typeof finalizeAgentRunJournal> | undefined;
    try {
      const claim = await claimSubmit(conversationId, userId);
      await getSql().begin(async (tx) => {
        const [blocker] = await tx`select pg_backend_pid() as pid`;
        await tx`select id from conversations where id = ${conversationId} for update`;
        finalizing = finalizeAgentRunJournal({
          runId: claim.runId,
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
          assert.ok(Date.now() < deadline, "finalizer did not reach the conversation lock");
          await new Promise((resolve) => {
            setTimeout(resolve, 10);
          });
        }
        await tx`select id from agent_runs where id = ${claim.runId} for update nowait`;
      });
    } finally {
      await finalizing;
      await cleanup(conversationId);
    }
  },
);

test("terminal cleanup locks conversation before run and lease", { skip: !enabled }, async () => {
  const { conversationId, userId } = await createConversation();
  let finishing: ReturnType<typeof finishAgentRun> | undefined;
  try {
    const claim = await claimSubmit(conversationId, userId);
    await getSql().begin(async (tx) => {
      const [blocker] = await tx`select pg_backend_pid() as pid`;
      await tx`select id from conversations where id = ${conversationId} for update`;
      finishing = finishAgentRun({ runId: claim.runId, status: "failed", error: "provider failed" });
      const deadline = Date.now() + 5_000;
      while (true) {
        const blocked = await getSql()`
          select pid from pg_stat_activity where ${blocker!.pid} = any(pg_blocking_pids(pid))
        `;
        if (blocked.length > 0) break;
        assert.ok(Date.now() < deadline, "terminal cleanup did not reach the conversation lock");
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
      }
      await tx`select id from agent_runs where id = ${claim.runId} for update nowait`;
      await tx`select run_id from conversation_run_leases where run_id = ${claim.runId} for update nowait`;
    });
  } finally {
    await finishing;
    await cleanup(conversationId);
  }
});

test("a trace completion gap cannot override the SDK outcome or leave a running step", { skip: !enabled }, async () => {
  const { conversationId, userId } = await createConversation();
  try {
    const claim = await claimSubmit(conversationId, userId);
    await getDb()
      .insert(agentSteps)
      .values({
        id: identifier("step"),
        runId: claim.runId,
        stepIndex: 0,
        kind: "model",
        status: "running",
        createdAt: new Date(),
      });
    const messageId = identifier("msg");
    await finalizeAgentRunJournal({
      runId: claim.runId,
      parts: [{ type: "text", text: "partial" }],
      aborted: false,
      status: "completed",
      message: {
        id: messageId,
        status: "ok",
        content: { version: 2, parts: [{ type: "text", text: "partial" }], metadata: { status: "completed" } },
      },
    });
    const [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, claim.runId));
    const [message] = await getDb().select().from(messages).where(eq(messages.id, messageId));
    const [step] = await getDb().select().from(agentSteps).where(eq(agentSteps.runId, claim.runId));
    assert.equal(run?.status, "completed");
    assert.equal(message?.status, "ok");
    assert.equal(message?.content.metadata?.status, "completed");
    assert.equal(step?.status, "failed");
    assert.match(step?.summary ?? "", /trace/);
    assert.deepEqual(message?.content.parts, [{ type: "text", text: "partial" }]);
  } finally {
    await cleanup(conversationId);
  }
});

test("cancellation committed after the stream snapshot wins in journal finalization", { skip: !enabled }, async () => {
  const { conversationId, userId } = await createConversation();
  try {
    const claim = await claimSubmit(conversationId, userId);
    const toolCallId = identifier("tool");
    const parts = [{ type: "tool-ask_user", toolCallId, state: "input-available", input: {} }];
    await getDb().insert(agentToolCalls).values({
      id: toolCallId,
      runId: claim.runId,
      toolName: "ask_user",
      status: "running",
      inputJson: {},
      createdAt: new Date(),
    });
    await requestAgentRunCancellation(claim.runId);
    const messageId = identifier("msg");
    await finalizeAgentRunJournal({
      runId: claim.runId,
      parts,
      aborted: false,
      status: "completed",
      message: {
        id: messageId,
        status: "ok",
        content: { version: 2, parts, metadata: { status: "completed" } },
      },
    });
    const [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, claim.runId));
    const [message] = await getDb().select().from(messages).where(eq(messages.id, messageId));
    const [toolCall] = await getDb().select().from(agentToolCalls).where(eq(agentToolCalls.id, toolCallId));
    assert.equal(run?.status, "cancelled");
    assert.equal(message?.status, "failed");
    assert.equal(message?.content.metadata?.status, "cancelled");
    assert.ok(message);
    assert.equal((message.content.parts[0] as { state: string }).state, "output-error");
    assert.equal(toolCall?.status, "failed");
  } finally {
    await cleanup(conversationId);
  }
});

test(
  "late cleanup failure and stale orphan snapshots cannot overwrite a committed run",
  { skip: !enabled },
  async () => {
    const { conversationId, userId } = await createConversation();
    try {
      const claim = await claimSubmit(conversationId, userId);
      await finalizeAgentRunJournal({
        runId: claim.runId,
        parts: [],
        aborted: false,
        message: null,
        status: "completed",
      });
      await finishAgentRun({ runId: claim.runId, status: "failed", error: "cleanup failed after commit" });
      let [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, claim.runId));
      assert.equal(run?.status, "completed");
      await interruptRuns([claim.runId]);
      [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, claim.runId));
      assert.equal(run?.status, "completed");
    } finally {
      await cleanup(conversationId);
    }
  },
);

test("orphan reconciliation rechecks a renewed lease before interrupting", { skip: !enabled }, async () => {
  const { conversationId, userId } = await createConversation();
  try {
    const claim = await claimSubmit(conversationId, userId);
    await interruptRuns([claim.runId]);
    let [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, claim.runId));
    assert.equal(run?.status, "running");
    await getDb()
      .update(conversationRunLeases)
      .set({ expiresAt: new Date(0) })
      .where(eq(conversationRunLeases.runId, claim.runId));
    await interruptRuns([claim.runId]);
    [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, claim.runId));
    assert.equal(run?.status, "interrupted");
  } finally {
    await cleanup(conversationId);
  }
});
