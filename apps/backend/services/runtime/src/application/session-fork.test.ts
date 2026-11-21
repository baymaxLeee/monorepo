import assert from "node:assert/strict";
import test from "node:test";

import { forkMessageContent } from "./session-fork-content.js";
import { forkSession, selectForkMessages } from "./session-fork.js";
import type { Message } from "./sessions.js";

const auth = {
  userId: "user",
  username: "user",
  email: "",
  tenantId: "tenant",
  workspaceId: "workspace",
  workspaceRole: "member",
  roles: [],
};
const history: Message[] = ["user", "assistant", "user"].map((role, index) => ({
  id: String(index),
  session_id: "source",
  role: role as Message["role"],
  content: { version: 1, parts: [{ type: "text", text: String(index) }] },
  status: "ok",
  parent_message_id: index === 0 ? null : String(index - 1),
  branch_index: 0,
  created_at: new Date().toISOString(),
}));
function setup() {
  const calls: string[] = [];
  const deps: NonNullable<Parameters<typeof forkSession>[3]> = {
    getSessionRow: async (scope, id) => {
      assert.equal(scope, auth);
      assert.equal(id, "source");
      calls.push("authorize");
      return {
        id: "source",
        userId: "user",
        tenantId: "tenant",
        workspaceId: "workspace",
        createRequestId: "create-source",
        title: "原会话",
        model: "model",
        providerId: "provider",
        reasoningEffort: "medium",
        approvalPolicy: "on-request",
        permissionProfile: ":workspace",
        executionMode: "cloud",
        turnSequence: 0n,
        itemSequence: 3n,
        historyRevision: 0n,
        selectedItemId: "2",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    listMessages: async () => history,
    hasActiveRun: async () => false,
    reserve: async () => {
      calls.push("reserve");
    },
    forkSessionDocuments: async (input) => {
      assert.equal(input.sourceSessionId, "source");
      assert.notEqual(input.sessionId, "source");
      assert.equal(input.workspaceId, "workspace");
      calls.push("documents");
      return { document_ids: {} };
    },
    publish: async (_source, _id, _now, messages, documentIds) => {
      calls.push("publish");
      assert.equal(messages.length, 2);
      assert.equal(messages[1]?.id, "1");
      assert.deepEqual(documentIds, {});
    },
    release: async () => {
      calls.push("release");
    },
  };
  return { calls, deps };
}

test("fork publishes only through the selected reply after files are ready", async () => {
  const { calls, deps } = setup();
  const original = structuredClone(history);
  const branch = await forkSession(auth, "source", "1", deps);
  assert.notEqual(branch.id, "source");
  assert.deepEqual(calls, ["authorize", "reserve", "documents", "publish"]);
  assert.deepEqual(history, original);
});
test("authorization failure and live runs cannot create orphan copies", async () => {
  const { calls, deps } = setup();
  deps.getSessionRow = async () => {
    throw new Error("not found");
  };
  await assert.rejects(forkSession(auth, "source", "1", deps), /not found/);
  assert.deepEqual(calls, []);
  const active = setup();
  active.deps.hasActiveRun = async () => true;
  await assert.rejects(forkSession(auth, "source", "1", active.deps), /停止/);
  assert.deepEqual(active.calls, ["authorize"]);
});
test("invalid checkpoint does not copy documents or files", () => {
  assert.throws(() => selectForkMessages(history, "outside"), /不存在/);
  assert.throws(() => selectForkMessages(history, "0"), /完成/);
  assert.throws(() => selectForkMessages([{ ...history[1], status: "streaming" }], "1"), /完成/);
});
for (const step of ["forkSessionDocuments", "publish"] as const) {
  test(`failed ${step} releases durable compensation and never mutates source`, async () => {
    const { calls, deps } = setup();
    deps[step] = async () => {
      throw new Error("failed");
    };
    await assert.rejects(forkSession(auth, "source", "1", deps), /failed/);
    assert.equal(calls.at(-1), "release");
    assert.ok(!calls.includes("publish"));
  });
}
test("forked attachment points at the file owned by the child session", () => {
  const part = { type: "file", mediaType: "text/plain", url: "/api/chat-server/sessions/source/files/input/content" };
  const input = {
    sourceId: "source",
    sessionId: "branch",
    messageId: "reply",
    documentIds: {},
    fileIds: { input: "copy" },
  };
  const content = { version: 1, parts: [part] };
  assert.deepEqual(forkMessageContent(content, input).parts, [
    { ...part, url: "/api/chat-server/sessions/branch/files/copy/content" },
  ]);
  assert.throws(() => forkMessageContent(content, { ...input, fileIds: {} }), /无法创建完整分支/);
});

test("file references remap while completed results remain history and unfinished tools cannot resume", () => {
  const content = {
    version: 1,
    metadata: { runId: "old", responseId: "old-response" },
    parts: [
      {
        type: "file",
        mediaType: "image/png",
        url: "/api/chat-server/sessions/source/documents/doc/content?document_id=doc",
      },
      {
        type: "tool-upload_artifacts",
        state: "output-available",
        toolCallId: "done",
        output: { files: [{ file_id: "file", filename: "report.md" }] },
      },
      {
        type: "tool-bash",
        state: "approval-requested",
        toolCallId: "pending",
        input: { command: "delete" },
        approval: { id: "old-approval" },
      },
    ],
  };
  const clone = forkMessageContent(content, {
    sourceId: "source",
    sessionId: "branch",
    messageId: "reply",
    documentIds: { doc: "copy" },
    fileIds: { file: "file-copy" },
  });
  const parts = clone.parts as Record<string, unknown>[];
  assert.equal(parts[0].url, "/api/chat-server/sessions/branch/documents/copy/content?document_id=copy");
  assert.deepEqual(parts[1].output, { files: [{ file_id: "file-copy", filename: "report.md" }] });
  assert.equal(parts[1].state, "output-available");
  assert.equal(parts[2].state, "output-error");
  assert.equal(parts[2].approval, undefined);
  assert.equal(clone.metadata?.responseId, undefined);
  assert.equal((content.parts[2] as { state: string }).state, "approval-requested");
});

test("preliminary output and unfinished todo state are frozen without replay", () => {
  const result = forkMessageContent(
    {
      version: 2,
      parts: [
        {
          type: "tool-subagents",
          toolCallId: "subagents",
          state: "output-available",
          preliminary: true,
          output: { ok: true, status: "running" },
        },
        {
          type: "tool-update_plan",
          toolCallId: "todos",
          state: "output-available",
          output: {
            ok: true,
            status: "completed",
            data: {
              plan: [
                { id: "t", status: "in_progress" },
                { id: "done", status: "completed" },
              ],
            },
          },
        },
      ],
    },
    { sourceId: "source", sessionId: "branch", messageId: "failed-reply", documentIds: {}, fileIds: {} },
  );
  const parts = result.parts as Record<string, unknown>[];
  assert.equal(parts[0].state, "output-error");
  assert.equal(parts[0].preliminary, undefined);
  assert.equal(parts[0].output, undefined);
  assert.deepEqual(parts[1].output, {
    ok: true,
    status: "completed",
    data: {
      plan: [
        { id: "t", status: "cancelled" },
        { id: "done", status: "completed" },
      ],
    },
  });
});
