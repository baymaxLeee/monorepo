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
  for (const name of ["code_mode", "subagents"]) {
    assert.equal(
      registry.manifests.find((manifest) => manifest.name === name)?.tool?.deferLoading,
      true,
      `${name} should load through tool_search`,
    );
  }
  for (const name of ["web_search", "web_fetch", "tool_search", "update_todos", "ask_user"]) {
    assert.notEqual(
      registry.manifests.find((manifest) => manifest.name === name)?.tool?.deferLoading,
      true,
      `${name} should remain in the hot tool surface`,
    );
  }
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
