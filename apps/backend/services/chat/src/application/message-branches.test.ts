import assert from "node:assert/strict";
import test from "node:test";

import { buildMessageBranches, hasKnowledgeSourceReference, selectMessagePath, type Message } from "./conversations.js";

function message(id: string, parent: string | null, branchIndex: number, created: number): Message {
  return {
    id,
    conversation_id: "conversation",
    role: id.startsWith("a") ? "assistant" : "user",
    content: { version: 2, parts: [{ type: "text", text: id }] },
    status: "ok",
    parent_message_id: parent,
    branch_index: branchIndex,
    created_at: `2026-11-10T00:00:0${created}.000Z`,
  };
}

const graph = [
  message("u0", null, 0, 0),
  message("a0", "u0", 0, 1),
  message("a1", "u0", 1, 2),
  message("u1", "a0", 0, 3),
  message("a2", "u1", 0, 4),
];

test("only the selected root-to-leaf path enters UI and model history", () => {
  assert.deepEqual(
    selectMessagePath(graph, "a2").map((item) => item.id),
    ["u0", "a0", "u1", "a2"],
  );
  assert.deepEqual(
    selectMessagePath(graph, "a1").map((item) => item.id),
    ["u0", "a1"],
  );
});

test("branch metadata preserves old candidates and points each candidate at a selectable leaf", () => {
  const selected = selectMessagePath(graph, "a1");
  assert.deepEqual(buildMessageBranches(graph, selected), [
    {
      parent_message_id: "u0",
      selected_message_id: "a1",
      candidates: [
        { message_id: "a0", leaf_message_id: "a2", role: "assistant", created_at: graph[1]!.created_at },
        { message_id: "a1", leaf_message_id: "a1", role: "assistant", created_at: graph[2]!.created_at },
      ],
    },
  ]);
});

test("missing parents and cycles are rejected instead of leaking a partial history", () => {
  assert.throws(() => selectMessagePath([message("a0", "missing", 0, 1)], "a0"), /missing/);
  assert.throws(() => selectMessagePath([message("a0", "a1", 0, 1), message("a1", "a0", 0, 2)], "a0"), /cycle/);
});

test("document delivery requires an explicit knowledge source resolver relationship in the journal", () => {
  const source = message("a-source", null, 0, 0);
  source.content = {
    version: 2,
    parts: [
      {
        type: "source-document",
        sourceId: "knowledge-document",
        title: "Knowledge",
        mediaType: "application/pdf",
        providerMetadata: { chat: { resolver: "knowledge-document" } },
      },
      {
        type: "source-document",
        sourceId: "provider-document",
        title: "Provider",
        mediaType: "application/pdf",
      },
    ],
  };

  assert.equal(hasKnowledgeSourceReference([source], "knowledge-document"), true);
  assert.equal(hasKnowledgeSourceReference([source], "provider-document"), false);
  assert.equal(hasKnowledgeSourceReference([source], "guessed-document"), false);
});
