import assert from "node:assert/strict";
import test from "node:test";

import { agentTools } from "@ui-sdk/core/agent";
import { asSchema, generateText, isStepCount, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import { DIRECT_TOOL_CALL } from "../research/code-mode.js";
import { buildAgentToolRouter, createPortableToolRegistry } from "./catalog.js";
import { defineAgentTool, withToolExposure } from "./manifest.js";
import { AgentToolRegistry } from "./registry.js";

const model = {
  name: "test-model",
  model: new MockLanguageModelV4(),
  contextLimits: {
    contextWindow: 32_000,
    maxOutputTokens: 4_000,
  },
};
const webSearch = async (input: { query: string }) => ({ query: input.query, untrusted: true as const, results: [] });

test("portable manifests do not duplicate shared runtime core tools", () => {
  const portable = createPortableToolRegistry({ model, webSearch });
  assert.deepEqual(portable.manifests.map((manifest) => manifest.name).sort(), [
    "code_mode",
    "subagents",
    "update_plan",
    "web_fetch",
    "web_search",
  ]);
  const registry = buildAgentToolRouter(portable.manifests, []);
  for (const name of ["code_mode", "subagents", "web_search", "web_fetch", "tool_search", "update_plan", "ask_user"]) {
    assert.notEqual(
      registry.manifests.find((manifest) => manifest.name === name)?.tool?.deferLoading,
      true,
      `${name} should remain in the hot tool surface`,
    );
  }
});

test("interaction and tool discovery are public runtime tools", () => {
  const core = new AgentToolRegistry().finalize();
  assert.deepEqual(
    core.manifests.map(({ name }) => name),
    ["ask_user", "tool_search"],
  );

  const registry = createPortableToolRegistry({ model, webSearch });
  const withoutDeferred = buildAgentToolRouter(registry.manifests, []);
  assert.equal(
    withoutDeferred.manifests.some(({ name }) => name === "tool_search"),
    true,
  );
  assert.equal("tool_search" in withoutDeferred.tools, true);
  assert.equal("ask_user" in withoutDeferred.tools, true);

  const deferred = withToolExposure(
    defineAgentTool(
      "optional_media",
      tool({ description: "Create optional media.", inputSchema: z.object({}) }),
      { capability: "media", effect: "add", execution: "inline", trust: "closed" },
      { summary: "Create optional media." },
    ),
    "deferred",
  );
  const withDeferred = buildAgentToolRouter([...registry.manifests, deferred], []);
  assert.equal(
    withDeferred.manifests.some(({ name }) => name === "tool_search"),
    true,
  );
  const description = withDeferred.tools.tool_search?.description;
  if (typeof description !== "string") assert.fail("tool_search must have a static description");
  assert.match(description, /optional_media/);
});

test("router finalization keeps direct, deferred, model-only, code-mode-only and hidden surfaces distinct", () => {
  const create = (name: string, exposure: Parameters<typeof withToolExposure>[1], callableByCodeMode = false) =>
    withToolExposure(
      defineAgentTool(
        name,
        tool({ description: name, inputSchema: z.object({}) }),
        {
          capability: "search",
          effect: "read",
          execution: "inline",
          trust: "open-world",
          ...(callableByCodeMode ? { callableByCodeMode: true } : {}),
        },
        { summary: name },
      ),
      exposure,
    );
  const registry = new AgentToolRegistry();
  registry.registerAll([
    create("direct", "direct", true),
    create("deferred", "deferred", true),
    create("direct_model", "direct-model-only"),
    create("deferred_model", "deferred-model-only"),
    create("code_only", "code-mode-only", true),
    create("hidden", "hidden"),
  ]);
  const router = registry.finalize();

  assert.equal(router.tools.deferred?.deferLoading, true);
  assert.equal(router.tools.deferred_model?.deferLoading, true);
  assert.equal(router.tools.direct?.deferLoading, undefined);
  assert.deepEqual(router.toolCallers.direct, ["code_mode", DIRECT_TOOL_CALL]);
  assert.deepEqual(router.toolCallers.deferred, ["code_mode", DIRECT_TOOL_CALL]);
  assert.deepEqual(router.toolCallers.code_only, ["code_mode"]);
  assert.equal(router.toolCallers.direct_model, undefined);
  assert.equal(router.toolCallers.deferred_model, undefined);
  assert.ok(router.activeTools.includes("code_only"));
  assert.ok(!router.activeTools.includes("hidden"));
  assert.ok(router.activeTools.includes("tool_search"));
});

test("restored discoveries load once and append their schemas after the hot surface", () => {
  const hot = defineAgentTool(
    "hot",
    tool({ description: "hot", inputSchema: z.object({}) }),
    { capability: "search", effect: "read", execution: "inline", trust: "open-world" },
    { summary: "hot" },
  );
  const optional = withToolExposure(
    defineAgentTool(
      "optional",
      tool({ description: "optional", inputSchema: z.object({}) }),
      { capability: "search", effect: "read", execution: "inline", trust: "open-world" },
      { summary: "optional" },
    ),
    "deferred",
  );
  const router = buildAgentToolRouter([hot, optional], [], { loadedTools: ["optional"] });
  assert.equal(router.tools.optional?.deferLoading, undefined);
  assert.equal("tool_search" in router.tools, true);
  assert.deepEqual(router.toolOrder, ["ask_user", "hot", "tool_search", "optional"]);
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

test("the first model request advertises research strategies and searchable tools without their schemas", async () => {
  const registry = createPortableToolRegistry({ model, webSearch });
  const image = withToolExposure(
    defineAgentTool(
      "generate_images",
      tool({
        description: "Generate an image",
        inputSchema: z.object({ prompt: z.string() }),
      }),
      { capability: "media", effect: "add", execution: "inline", trust: "closed" },
      { summary: "Generate images." },
    ),
    "deferred",
  );
  const plugin = { ...image, name: "mcp__knowledge__search", policy: { ...image.policy, source: "mcp" as const } };
  const unavailable = { ...image, name: "unavailable_video", tool: undefined };
  const compiled = buildAgentToolRouter([...registry.manifests, image, unavailable], [plugin]);
  const probe = new MockLanguageModelV4({
    doGenerate: async () => {
      const first = probe.doGenerateCalls.length === 1;
      return {
        content: first
          ? [{ type: "tool-call", toolCallId: "search", toolName: "tool_search", input: '{"query":"generate_images"}' }]
          : [{ type: "text", text: "done" }],
        finishReason: { unified: first ? "tool-calls" : "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  await generateText({
    model: probe,
    tools: compiled.tools,
    // Both hosts bind callers from a dynamic ToolSet, whose keys the SDK cannot infer.
    experimental_toolCallers: compiled.toolCallers as never,
    prompt: "Research repositories and illustrate the result",
    stopWhen: isStepCount(2),
  });
  const first = probe.doGenerateCalls[0].tools ?? [];
  assert.deepEqual(first.map((t) => t.name).sort(), [
    "ask_user",
    "code_mode",
    "subagents",
    "tool_search",
    "update_plan",
    "web_fetch",
    "web_search",
  ]);
  const search = first.find((t) => t.name === "tool_search");
  assert.ok(search?.type === "function");
  assert.match(search.description ?? "", /generate_images/);
  assert.match(search.description ?? "", /mcp__knowledge/);
  assert.doesNotMatch(search.description ?? "", /unavailable_video/);
  assert.ok(probe.doGenerateCalls[1].tools?.some((t) => t.name === "generate_images"));
});

test("Code Mode can call scheduled catalog tools without deadlocking on its own admission", async () => {
  const registry = createPortableToolRegistry({ model, webSearch });
  const compiled = buildAgentToolRouter(registry.manifests, []);
  const probe = new MockLanguageModelV4({
    doGenerate: async () => {
      const first = probe.doGenerateCalls.length === 1;
      return {
        content: first
          ? [
              {
                type: "tool-call",
                toolCallId: "code",
                toolName: "code_mode",
                input: JSON.stringify({
                  js: 'return await tools.web_search({ query: "runtime scheduler" })',
                }),
              },
            ]
          : [{ type: "text", text: "done" }],
        finishReason: { unified: first ? "tool-calls" : "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });

  const result = await generateText({
    model: probe,
    tools: compiled.tools,
    experimental_toolCallers: compiled.toolCallers as never,
    prompt: "Search from Code Mode",
    stopWhen: isStepCount(2),
    abortSignal: AbortSignal.timeout(500),
  });

  assert.equal(result.text, "done");
});
