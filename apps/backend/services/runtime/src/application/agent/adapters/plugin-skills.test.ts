import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { AgentPluginContext, ResolvedPluginSkillContribution } from "@repo/agent-runtime/plugins/types";

import { RuntimePluginSkillAssetLoader, type PluginSkillContentSource } from "./plugin-skills.js";

const context: AgentPluginContext = {
  turnId: "turn",
  threadId: "thread",
  userId: "user",
  tenantId: "tenant",
  workspaceId: "workspace",
  workspaceRole: "member",
};

function source(body: string): PluginSkillContentSource {
  return {
    content: async (input) => {
      assert.deepEqual(input, {
        tenantId: "tenant",
        workspaceId: "workspace",
        assetId: "asset",
        revisionId: "revision",
        signal: undefined,
      });
      const bytes = new TextEncoder().encode(body);
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 3));
          controller.enqueue(bytes.subarray(3));
          controller.close();
        },
      });
    },
  };
}

function skill(
  body: string,
  sha256 = createHash("sha256").update(body).digest("hex"),
): ResolvedPluginSkillContribution {
  return {
    pluginId: "knowledge@platform",
    id: "research",
    name: "Research",
    description: "Research instructions.",
    assetId: "asset",
    revisionId: "revision",
    sha256,
  };
}

void test("plugin skill loader reads the exact revision and verifies its digest", async () => {
  const body = "# Research\n\nUse evidence.";
  assert.equal(await new RuntimePluginSkillAssetLoader(source(body)).loadBody(skill(body), context), body);
});

void test("plugin skill loader fails closed on asset drift", async () => {
  const body = "# Changed";
  await assert.rejects(
    () => new RuntimePluginSkillAssetLoader(source(body)).loadBody(skill(body, "a".repeat(64)), context),
    /asset digest mismatch/,
  );
});
