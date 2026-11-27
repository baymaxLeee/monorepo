import assert from "node:assert/strict";
import test from "node:test";

import { agentTools } from "@ui-sdk/core/agent";
import { asSchema, generateText, isStepCount, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import { compileTurnTools, createPortableToolRegistry } from "./catalog.js";
import { defineAgentTool, deferAgentToolLoading } from "./manifest.js";

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
  for (const name of ["code_mode", "subagents", "web_search", "web_fetch", "tool_search", "update_plan", "ask_user"]) {
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

test("tool search is present only when this turn has deferred tools", () => {
  const registry = createPortableToolRegistry({ model, webSearch });
  const withoutDeferred = compileTurnTools(registry.manifests, []);
  assert.equal(
    withoutDeferred.manifests.some(({ name }) => name === "tool_search"),
    false,
  );
  assert.equal("tool_search" in withoutDeferred.tools, false);

  const deferred = deferAgentToolLoading(
    defineAgentTool(
      "optional_media",
      tool({ description: "Create optional media.", inputSchema: z.object({}) }),
      { capability: "media", effect: "add", execution: "inline", trust: "closed" },
      { summary: "Create optional media." },
    ),
  );
  const withDeferred = compileTurnTools([...registry.manifests, deferred], []);
  assert.equal(
    withDeferred.manifests.some(({ name }) => name === "tool_search"),
    true,
  );
  const description = withDeferred.tools.tool_search?.description;
  if (typeof description !== "string") assert.fail("tool_search must have a static description");
  assert.match(description, /optional_media/);
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
  const image = deferAgentToolLoading(
    defineAgentTool(
      "generate_images",
      tool({
        description: "Generate an image",
        inputSchema: z.object({ prompt: z.string() }),
      }),
      { capability: "media", effect: "add", execution: "inline", trust: "closed" },
      { summary: "Generate images." },
    ),
  );
  const plugin = { ...image, name: "mcp__knowledge__search", policy: { ...image.policy, source: "mcp" as const } };
  const unavailable = { ...image, name: "unavailable_video", tool: undefined };
  const compiled = compileTurnTools([...registry.manifests, image, unavailable], [plugin]);
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
  assert.match(search.description ?? "", /mcp__knowledge__search/);
  assert.doesNotMatch(search.description ?? "", /unavailable_video/);
  assert.ok(probe.doGenerateCalls[1].tools?.some((t) => t.name === "generate_images"));
});
