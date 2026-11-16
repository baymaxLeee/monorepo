import assert from "node:assert/strict";
import test from "node:test";

import { MockLanguageModelV4 } from "ai/test";

import { createCoreToolManifests } from "./core.js";

const model = {
  name: "test-model",
  model: new MockLanguageModelV4(),
  maxOutputTokens: 4_000,
  supportsStoredContinuation: false,
};
const webSearch = async (input: { query: string }) => ({ query: input.query, untrusted: true as const, results: [] });

test("core tool ownership exposes one canonical portable capability set", () => {
  const resolved = createCoreToolManifests({ mode: "normal", model, webSearch });
  assert.deepEqual(resolved.manifests.map((manifest) => manifest.name).sort(), [
    "ask_user",
    "code_mode",
    "subagents",
    "tool_search",
    "update_todos",
    "web_fetch",
    "web_search",
  ]);
});

test("a host can declare only its missing client continuation protocol", () => {
  const resolved = createCoreToolManifests({ mode: "normal", model, webSearch, clientInteraction: false });
  assert.equal(
    resolved.manifests.some((manifest) => manifest.name === "ask_user"),
    false,
  );
  assert.equal(
    resolved.manifests.some((manifest) => manifest.name === "subagents"),
    true,
  );
});
