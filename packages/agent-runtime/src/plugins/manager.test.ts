import assert from "node:assert/strict";
import test from "node:test";

import { PluginManager } from "./manager.js";
import type { AgentPluginContext, AgentPluginManifest, ResolvedTurnPluginSnapshot } from "./types.js";

const context: AgentPluginContext = {
  turnId: "turn",
  threadId: "thread",
  userId: "user",
  tenantId: "tenant",
  workspaceId: "workspace",
  workspaceRole: "member",
};

function manifest(id = "knowledge@platform"): AgentPluginManifest {
  return {
    schemaVersion: 1,
    id,
    version: "1.0.0",
    digest: `sha256:${"a".repeat(64)}`,
    displayName: "Knowledge",
    description: "Search workspace knowledge.",
    source: "system",
    trust: "system",
    mcpServers: [
      {
        name: "knowledge",
        url: "http://knowledge.internal/mcp",
        tools: [
          {
            name: "search",
            description: "Search workspace knowledge.",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
            policy: {
              capability: "search",
              effect: "read",
              trust: "private-untrusted",
              execution: "inline",
            },
            planning: { summary: "Search workspace knowledge." },
          },
        ],
      },
    ],
  };
}

function snapshot(
  plugin = manifest(),
  overrides: Partial<ResolvedTurnPluginSnapshot> = {},
): ResolvedTurnPluginSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: "snapshot",
    snapshotDigest: `sha256:${"b".repeat(64)}`,
    workspaceRevision: 1,
    tenantId: "tenant",
    workspaceId: "workspace",
    resolvedAt: "2026-11-19T00:00:00Z",
    plugins: [{ manifest: plugin, activation: { pluginId: plugin.id } }],
    connectionGrants: [
      {
        pluginId: plugin.id,
        serverName: plugin.mcpServers[0]!.name,
        headers: { "X-Caller-Service": "runtime" },
      },
    ],
    ...overrides,
  };
}

void test("plugin manager freezes trusted snapshot ownership without connecting eagerly", async () => {
  const loaded = await new PluginManager().load(snapshot(), context);
  assert.equal(loaded.snapshotId, "snapshot");
  assert.deepEqual(
    loaded.activePlugins.map((plugin) => plugin.id),
    ["knowledge@platform"],
  );
  assert.deepEqual(
    loaded.manifests.map((tool) => tool.name),
    ["mcp__knowledge__search"],
  );
  assert.equal(loaded.manifests[0]?.policy.pluginId, "knowledge@platform");
  await loaded.dispose();
});

void test("plugin manager rejects cross-workspace, duplicate and ungranted snapshots", async () => {
  const manager = new PluginManager();
  await assert.rejects(
    () => manager.load(snapshot(manifest(), { workspaceId: "other" }), context),
    /does not belong to the active workspace/,
  );
  const plugin = manifest();
  await assert.rejects(
    () =>
      manager.load(
        snapshot(plugin, {
          plugins: [
            { manifest: plugin, activation: { pluginId: plugin.id } },
            { manifest: plugin, activation: { pluginId: plugin.id } },
          ],
        }),
        context,
      ),
    /duplicate plugin identities/,
  );
  await assert.rejects(
    () => manager.load(snapshot(plugin, { connectionGrants: [] }), context),
    /requires exactly one connection grant/,
  );
});

void test("external plugins cannot elevate themselves to system trust", async () => {
  const plugin = { ...manifest("github@external"), source: "external-mcp" as const };
  await assert.rejects(() => new PluginManager().load(snapshot(plugin), context), /cannot claim system trust/);
});

void test("plugins cannot expose unsafe tools to Code Mode", async () => {
  const base = manifest();
  const tool = base.mcpServers[0]!.tools[0]!;
  const plugin: AgentPluginManifest = {
    ...base,
    mcpServers: [
      {
        ...base.mcpServers[0]!,
        tools: [
          {
            ...tool,
            policy: { ...tool.policy, callableByCodeMode: true, effect: "write" },
          },
        ],
      },
    ],
  };
  await assert.rejects(
    () => new PluginManager().load(snapshot(plugin), context),
    /Code Mode tool search has an unsafe policy/,
  );
});
