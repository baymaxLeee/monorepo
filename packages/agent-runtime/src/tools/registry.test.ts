import assert from "node:assert/strict";
import test from "node:test";

import { MockLanguageModelV4 } from "ai/test";

import { createPortableToolRegistry } from "./registry.js";

const model = {
  name: "test-model",
  model: new MockLanguageModelV4(),
  maxOutputTokens: 4_000,
  supportsStoredContinuation: false,
};
const webSearch = async (input: { query: string }) => ({ query: input.query, untrusted: true as const, results: [] });

test("portable registry exposes the shared host tool set", () => {
  const registry = createPortableToolRegistry({ model, webSearch });
  assert.deepEqual(registry.manifests.map((manifest) => manifest.name).sort(), [
    "ask_user",
    "code_mode",
    "subagents",
    "tool_search",
    "update_todos",
    "web_fetch",
    "web_search",
  ]);
});

test("a host declares only its missing client continuation protocol", () => {
  const registry = createPortableToolRegistry({ model, webSearch, clientInteraction: false });
  assert.equal(
    registry.manifests.some((manifest) => manifest.name === "ask_user"),
    false,
  );
  assert.equal(
    registry.manifests.some((manifest) => manifest.name === "subagents"),
    true,
  );
});
