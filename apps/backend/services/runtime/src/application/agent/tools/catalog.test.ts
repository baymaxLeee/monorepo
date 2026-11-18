import assert from "node:assert/strict";
import test from "node:test";

import { experimental_getToolCaller as getToolCaller } from "@ai-sdk/provider-utils";

import type { LanguageProviderSnapshot } from "#runtime/provider-model";

import { ToolCatalog } from "./catalog.js";

const textProvider: LanguageProviderSnapshot = {
  id: "provider",
  name: "Provider",
  model: "model",
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
      sessionId: "session",
    },
    { textProvider, imageProvider: null, videoProviderId: null },
  );
  try {
    const subagents = resolved.manifests.find((manifest) => manifest.name === "subagents");
    assert.equal(subagents?.policy.uiKind, "subagent");
    assert.equal(subagents?.policy.execution, "inline");
    for (const name of ["bash", "refresh_session_sources", "upload_artifacts", "subagents"]) {
      assert.ok(resolved.activeTools.includes(name), `${name} should be active`);
    }
    assert.deepEqual([...resolved.codeModeTools].sort(), ["web_fetch", "web_search"]);
    const codeModeCaller = getToolCaller(resolved.tools.code_mode);
    assert.equal(codeModeCaller?.type, "local");
    if (codeModeCaller?.type !== "local") throw new Error("code_mode must use a local tool caller");
    assert.equal(codeModeCaller.prepareModelMessage, undefined);
    const bound = codeModeCaller.bind(
      Object.fromEntries(resolved.codeModeTools.map((name) => [name, resolved.tools[name]])),
    );
    assert.equal(typeof bound.description, "string");
    if (typeof bound.description !== "string") throw new Error("code_mode must have a static description");
    assert.match(bound.description, /web_fetch/);
    assert.match(bound.description, /web_search/);
  } finally {
    await resolved.dispose();
  }
});
