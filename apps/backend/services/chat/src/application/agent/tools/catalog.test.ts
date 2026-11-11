import assert from "node:assert/strict";
import test from "node:test";

import { experimental_getToolCaller as getToolCaller } from "@ai-sdk/provider-utils";
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

void test("tool catalog exposes the current inline research and sandbox workflow", async () => {
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
    const subagents = resolved.manifests.find((manifest) => manifest.name === "subagents");
    assert.equal(subagents?.policy.uiKind, "subagent");
    assert.equal(subagents?.policy.execution, "inline");
    for (const name of ["bash", "refresh_conversation_sources", "save_sandbox_file", "subagents"]) {
      assert.ok(resolved.activeTools.includes(name), `${name} should be active`);
    }
    assert.deepEqual([...resolved.codeModeTools].sort(), ["web_fetch", "web_search"]);
    const codeModeCaller = getToolCaller(resolved.tools.code_mode);
    assert.ok(codeModeCaller?.type === "local" && codeModeCaller.prepareModelMessage);
    const catalog = codeModeCaller.prepareModelMessage(
      Object.fromEntries(resolved.codeModeTools.map((name) => [name, resolved.tools[name]])),
    );
    assert.match(catalog ?? "", /web_fetch/);
    assert.match(catalog ?? "", /web_search/);
  } finally {
    await resolved.dispose();
  }
});
