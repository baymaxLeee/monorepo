import assert from "node:assert/strict";
import test from "node:test";

import { agentTools } from "@ui-sdk/core/agent";
import { asSchema } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { createPortableToolRegistry } from "./catalog.js";

const model = {
  name: "test-model",
  model: new MockLanguageModelV4(),
  maxOutputTokens: 4_000,
};
const webSearch = async (input: { query: string }) => ({ query: input.query, untrusted: true as const, results: [] });

test("portable registry exposes the shared host tool set", () => {
  const registry = createPortableToolRegistry({ model, webSearch });
  assert.deepEqual(registry.manifests.map((manifest) => manifest.name).sort(), [
    "ask_user",
    "code_mode",
    "subagents",
    "tool_search",
    "update_plan",
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
  for (const name of ["web_search", "web_fetch", "tool_search", "update_plan", "ask_user"]) {
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

test("UI agent bridge tools are opt-in for a turn", async () => {
  const ordinary = createPortableToolRegistry({ model, webSearch });
  assert.equal(
    ordinary.manifests.some((manifest) => manifest.name === "snapshot"),
    false,
  );

  const enabled = createPortableToolRegistry({ model, webSearch, uiAgent: true });
  for (const { name, description, inputSchema } of agentTools) {
    const manifest = enabled.manifests.find((candidate) => candidate.name === name);
    assert.ok(manifest?.tool);
    assert.equal(manifest.tool.description, description);
    assert.deepEqual(await asSchema(manifest.tool.inputSchema).jsonSchema, inputSchema);
    assert.equal(manifest.tool.strict, false);
    assert.equal(manifest.policy.trust, "private-untrusted");
    assert.equal(manifest.policy.effect, name === "snapshot" ? "read" : "update");
    assert.equal(manifest.policy.execution, "client");
    assert.equal(manifest?.policy.uiKind, "agent-ui");
  }
});
