import assert from "node:assert/strict";
import test from "node:test";

import { getTaskType } from "./registry.js";

test("registry exposes tenant-neutral durable media extensions", () => {
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

  const provider = {
    id: "provider",
    name: "Image Provider",
    model: "image-model",
    baseUrl: "https://provider.example/v1",
    apiKey: "secret",
    extraBody: {},
    contextWindow: 0,
    maxOutputTokens: 0,
    pricing: null,
    providerKind: "image",
    isDefault: true,
  };
  const valid = definition.inputSchema.safeParse({
    sessionId: "session",
    provider,
    prompts: ["first image", "second image"],
    idempotencyKey: "tool-call",
  });
  assert.equal(valid.success, true);

  const oversized = definition.inputSchema.safeParse({
    provider,
    prompts: Array.from({ length: 7 }, (_, index) => `image ${index}`),
    idempotencyKey: "tool-call",
  });
  assert.equal(oversized.success, false);
});

test("video generation validates a frozen provider capability without business identity", () => {
  const definition = getTaskType("video-generation");
  assert.ok(definition);

  const input = {
    sessionId: "session",
    provider: {
      id: "video-provider",
      name: "Video Provider",
      model: "video-model",
      baseUrl: "https://provider.example/v1",
      apiKey: "secret",
      extraBody: {},
      contextWindow: 0,
      maxOutputTokens: 0,
      pricing: { currency: "USD", unit: "generated_second", unitPriceMicros: 1 },
      providerKind: "video",
      isDefault: true,
    },
    filename: "demo.mp4",
    prompt: "Create a short demo in a clean studio with a moving light.",
    references: [],
    durationSeconds: 4,
    idempotencyKey: "tool-call",
  };
  const valid = definition.inputSchema.safeParse(input);
  assert.equal(valid.success, true);
  assert.equal("tenantId" in input, false);
  assert.equal("workspaceId" in input, false);
  assert.equal("userId" in input, false);
});
