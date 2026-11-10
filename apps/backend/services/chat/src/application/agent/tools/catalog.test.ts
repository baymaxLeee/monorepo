import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";

import { ToolCatalog } from "./catalog.js";

const textProvider: LanguageProviderSnapshot = {
  id: "provider",
  name: "Provider",
  model: "model",
  responsesDialect: "openai_responses",
  baseUrl: "https://example.com/v1",
  apiKey: "test",
  extraBody: {},
  contextWindow: 128_000,
  maxOutputTokens: 4_096,
};

void test("tool catalog exposes inline research without legacy virtual file tools", async () => {
  const resolved = await new ToolCatalog().resolve(
    {
      mode: "normal",
      runId: "run",
      userId: "user",
      conversationId: "conversation",
    },
    { textProvider, imageProvider: null, videoProviderId: null },
  );
  try {
    const research = resolved.manifests.find((manifest) => manifest.name === "research");
    assert.equal(research?.policy.uiKind, "subagent");
    assert.equal(research?.policy.execution, "inline");
    assert.ok(resolved.activeTools.includes("research"));
    assert.ok(!resolved.activeTools.includes("delegate_tasks"));
    assert.ok(!resolved.activeTools.includes("write_plan"));
    assert.ok(!resolved.activeTools.includes("read_conversation_file"));
    assert.ok(!resolved.activeTools.includes("list_conversation_files"));
  } finally {
    await resolved.dispose();
  }
});
