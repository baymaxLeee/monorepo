import assert from "node:assert/strict";
import test from "node:test";

import type { ProductConversation } from "../infrastructure/persistence/conversations.js";
import { projectConversation, projectRuntimeValue, runtimeRunBody } from "./conversations.js";

const product: ProductConversation = {
  id: "chat-conversation",
  runtime_session_id: "runtime-session",
  create_request_id: "request-1234",
  user_id: "user",
  tenant_id: "tenant",
  workspace_id: "workspace",
  title: "Product title",
  project_id: null,
  canvas_id: null,
  created_at: "2026-11-16T00:00:00.000Z",
  updated_at: "2026-11-16T00:00:00.000Z",
};

test("projects Runtime Session identifiers and resource URLs onto the Chat conversation", () => {
  assert.deepEqual(
    projectRuntimeValue(product, {
      session_id: "runtime-session",
      nested: {
        sessionId: "runtime-session",
        url: "/api/chat-server/sessions/runtime-session/files/file/content",
      },
      context: { id: "session", tokens: 42 },
    }),
    {
      conversation_id: "chat-conversation",
      nested: {
        conversationId: "chat-conversation",
        url: "/api/chat-server/conversations/chat-conversation/files/file/content",
      },
      context: { id: "conversation", tokens: 42 },
    },
  );
});

test("conversation metadata remains owned by Chat when Runtime detail is projected", () => {
  assert.deepEqual(
    projectConversation(product, {
      id: "runtime-session",
      title: "runtime must not own this",
      model: "model",
      messages: [{ session_id: "runtime-session", id: "message" }],
    }),
    {
      id: "chat-conversation",
      title: "Product title",
      model: "model",
      messages: [{ conversation_id: "chat-conversation", id: "message" }],
      user_id: "user",
      tenant_id: "tenant",
      workspace_id: "workspace",
      project_id: null,
      canvas_id: null,
      created_at: "2026-11-16T00:00:00.000Z",
      updated_at: "2026-11-16T00:00:00.000Z",
    },
  );
});

test("maps the SDK conversation id to the routed Runtime Session without changing message or retry ids", () => {
  const body = {
    id: product.id,
    request_id: "request-1234",
    messageId: "message-1234",
    expected_revision: 2,
    message: { id: "message-1234", role: "user", parts: [{ type: "text", text: product.id }] },
  };
  assert.deepEqual(runtimeRunBody(product, body), { ...body, id: product.runtime_session_id });
  assert.equal(body.id, product.id);
});

test("rejects SDK ids belonging to another conversation instead of silently retargeting them", () => {
  for (const id of ["another-conversation", product.runtime_session_id, 123, null, ""]) {
    assert.throws(() => runtimeRunBody(product, { id }), { status: 400, code: "bad_request" });
  }
});

test("accepts callers without an SDK id and binds Canvas context from the product mapping", () => {
  assert.deepEqual(
    runtimeRunBody(
      { ...product, project_id: "project", canvas_id: "canvas" },
      {
        request_id: "retry-key",
        host_context: { project_id: "untrusted", canvas_id: "untrusted" },
      },
    ),
    {
      id: product.runtime_session_id,
      request_id: "retry-key",
      host_context: { project_id: "project", canvas_id: "canvas" },
    },
  );
});
