import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../../../bootstrap/server-app.js";
import { markBootReady } from "../../../infrastructure/health/readiness.js";

const workloadHeaders = {
  "Content-Type": "application/json",
  "X-Caller-Service": "chat",
  "X-Internal-Token": "dev-chat-internal-token",
};

const provider = {
  id: "provider-1",
  name: "Provider",
  model: "model-1",
  baseUrl: "https://provider.example/v1",
  apiKey: "secret",
  extraBody: {},
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
  supportsImageInput: true,
  providerKind: "chat",
};

test("local inference consumes an upper-host provider capability without exposing its secret", async () => {
  markBootReady();
  const response = await createApp().request("/local-inference/config", {
    method: "POST",
    headers: workloadHeaders,
    body: JSON.stringify({ provider, reasoningEffort: "medium" }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const config = (await response.json()) as {
    providerId: string;
    model: string;
    reasoningEffort: string;
  };
  assert.equal(config.providerId, provider.id);
  assert.equal(config.model, provider.model);
  assert.equal(config.reasoningEffort, "medium");
  assert.equal(JSON.stringify(config).includes(provider.apiKey), false);
  assert.equal(JSON.stringify(config).includes(provider.baseUrl), false);
});

test("Runtime no longer exposes product plugin resolution", async () => {
  markBootReady();
  const response = await createApp().request("/local-inference/plugins/resolve", {
    method: "POST",
    headers: workloadHeaders,
    body: JSON.stringify({ activations: [] }),
  });
  assert.equal(response.status, 404);
});
