import assert from "node:assert/strict";
import { test } from "node:test";

import { toPersistedTurnPluginSnapshot } from "./snapshot.js";
import type { ResolvedTurnPluginSnapshot } from "./types.js";

test("persisted plugin snapshot strips grants and unknown secret-bearing fields", () => {
  const resolved = {
    schemaVersion: 1,
    snapshotId: "snapshot-1",
    snapshotDigest: `sha256:${"a".repeat(64)}`,
    tenantId: "host-owned-tenant",
    workspaceId: "host-owned-workspace",
    workspaceRevision: 7,
    resolvedAt: "2026-11-19T00:00:00.000Z",
    plugins: [
      {
        manifest: {
          schemaVersion: 1,
          id: "knowledge@platform",
          version: "1.0.0",
          digest: `sha256:${"b".repeat(64)}`,
          displayName: "Knowledge",
          description: "Search workspace knowledge.",
          source: "system",
          trust: "system",
          mcpServers: [
            {
              name: "knowledge",
              url: "http://knowledge:8010/mcp",
              tools: [
                {
                  name: "knowledge_search",
                  description: "Search knowledge.",
                  inputSchema: { type: "object", properties: { query: { type: "string" } } },
                  policy: {
                    capability: "search",
                    effect: "read",
                    trust: "private-untrusted",
                    execution: "inline",
                  },
                  planning: { summary: "Search knowledge." },
                  hiddenCredential: "must-not-persist",
                },
              ],
              headers: { authorization: "must-not-persist" },
            },
          ],
          credential: "must-not-persist",
        },
        activation: { pluginId: "knowledge@platform", bindings: { project_id: "project-1" } },
        token: "must-not-persist",
      },
    ],
    connectionGrants: [
      {
        pluginId: "knowledge@platform",
        serverName: "knowledge",
        headers: { authorization: "Bearer must-not-persist" },
      },
    ],
  } as unknown as ResolvedTurnPluginSnapshot;

  const persisted = toPersistedTurnPluginSnapshot(resolved);
  const serialized = JSON.stringify(persisted);

  assert.equal("connectionGrants" in persisted, false);
  assert.equal(serialized.includes("host-owned"), false);
  assert.equal(serialized.includes("must-not-persist"), false);
  assert.deepEqual(persisted.plugins[0]?.activation.bindings, { project_id: "project-1" });
  assert.deepEqual(
    persisted.plugins[0]?.manifest.mcpServers[0]?.tools.map((tool) => tool.name),
    ["knowledge_search"],
  );
});
