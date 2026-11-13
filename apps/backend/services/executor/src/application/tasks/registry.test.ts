import assert from "node:assert/strict";
import test from "node:test";

import { getTaskType } from "./registry.js";

test("registry exposes only durable media generation tasks", () => {
  const image = getTaskType("image-generation");
  const video = getTaskType("video-generation");

  assert.ok(image);
  assert.ok(video);
  assert.equal(getTaskType("knowledge-document-process"), undefined);
  assert.equal(getTaskType("canvas-archive"), undefined);
});

test("image generation validates a bounded durable batch", () => {
  const definition = getTaskType("image-generation");
  assert.ok(definition);

  const valid = definition.inputSchema.safeParse({
    tenantId: "tenant",
    workspaceId: "workspace",
    userId: "user",
    conversationId: "conversation",
    providerId: "provider",
    prompts: ["first image", "second image"],
    idempotencyKey: "tool-call",
  });
  assert.equal(valid.success, true);

  const oversized = definition.inputSchema.safeParse({
    tenantId: "tenant",
    workspaceId: "workspace",
    userId: "user",
    providerId: "provider",
    prompts: Array.from({ length: 7 }, (_, index) => `image ${index}`),
    idempotencyKey: "tool-call",
  });
  assert.equal(oversized.success, false);
});
