import assert from "node:assert/strict";
import test from "node:test";

import { experimental_getToolCaller as getToolCaller } from "@ai-sdk/provider-utils";
import type {
  AgentPluginContext,
  ResolvedPluginSet,
  ResolvedTurnPluginSnapshot,
} from "@repo/agent-runtime/plugins/types";

import type { LanguageProviderSnapshot } from "#runtime/provider-model";

import { ToolCatalog, type PluginSkillAssetLoader, type TurnPluginLoader } from "./catalog.js";

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

const context: AgentPluginContext = {
  turnId: "turn",
  threadId: "thread",
  userId: "user",
  tenantId: "tenant",
  workspaceId: "workspace",
  workspaceRole: "workspace_admin",
};

const snapshot: ResolvedTurnPluginSnapshot = {
  schemaVersion: 1,
  snapshotId: "snapshot",
  snapshotDigest: `sha256:${"a".repeat(64)}`,
  workspaceRevision: 1,
  tenantId: "tenant",
  workspaceId: "workspace",
  resolvedAt: "2026-11-19T00:00:00Z",
  plugins: [],
  connectionGrants: [],
};

function pluginSet(overrides: Partial<ResolvedPluginSet> = {}): ResolvedPluginSet {
  return {
    snapshotId: snapshot.snapshotId,
    snapshotDigest: snapshot.snapshotDigest,
    manifests: [],
    activePlugins: [],
    skills: [],
    dispose: async () => undefined,
    ...overrides,
  };
}

function loader(load: TurnPluginLoader["load"] = async () => pluginSet()): TurnPluginLoader {
  return { load };
}

void test("tool catalog exposes the current inline research and sandbox workflow", async () => {
  const resolved = await new ToolCatalog(loader()).resolve(context, { textProvider }, snapshot);
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

void test("core tool catalog does not install plugins outside the resolved Turn snapshot", async () => {
  let receivedSnapshot: ResolvedTurnPluginSnapshot | undefined;
  const resolved = await new ToolCatalog(
    loader(async (value) => {
      receivedSnapshot = value;
      return pluginSet();
    }),
  ).resolve(context, { textProvider }, snapshot);
  try {
    assert.equal(receivedSnapshot, snapshot);
    assert.equal(
      resolved.manifests.some((manifest) => manifest.name === "knowledge_search"),
      false,
    );
    assert.equal(
      resolved.manifests.some((manifest) => manifest.name === "get_canvas"),
      false,
    );
  } finally {
    await resolved.dispose();
  }
});

void test("plugin skills use the host immutable loader through progressive disclosure", async () => {
  let disposed = false;
  let loaded = 0;
  const catalog = new ToolCatalog(
    loader(async () =>
      pluginSet({
        skills: [
          {
            pluginId: "knowledge@platform",
            id: "skill",
            name: "Research",
            description: "Research workspace knowledge.",
            assetId: "asset",
            revisionId: "revision",
            sha256: "a".repeat(64),
          },
        ],
        dispose: async () => {
          disposed = true;
        },
      }),
    ),
    {
      loadBody: async (skill) => {
        loaded += 1;
        assert.equal(skill.pluginId, "knowledge@platform");
        return "# Research";
      },
    } satisfies PluginSkillAssetLoader,
  );

  const resolved = await catalog.resolve(context, { textProvider }, snapshot);
  try {
    assert.equal(loaded, 0);
    assert.deepEqual(resolved.contributions.skills, [
      { name: "Research", description: "Research workspace knowledge." },
    ]);
    const output = await resolved.tools.load_skill!.execute?.({ name: "Research" }, {
      toolCallId: "load",
      messages: [],
      abortSignal: undefined,
    } as never);
    assert.equal(loaded, 1);
    assert.deepEqual(output, { ok: true, status: "completed", data: { name: "Research", instructions: "# Research" } });
  } finally {
    await resolved.dispose();
  }
  assert.equal(disposed, true);
});
