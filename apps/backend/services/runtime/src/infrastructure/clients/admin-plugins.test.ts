import assert from "node:assert/strict";
import test from "node:test";

import type { ResolvedTurnPluginSnapshot } from "@repo/agent-runtime";

import { AdminUnavailableError } from "../../application/errors.js";
import { assertLocalPluginExecutionAllowed, attachPlatformMcpCredential, bindTurnPluginGrants } from "./admin.js";

function snapshot(url = "http://knowledge:8010/mcp"): ResolvedTurnPluginSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: "snapshot",
    snapshotDigest: "a".repeat(64),
    plugins: [
      {
        activation: { pluginId: "knowledge@platform" },
        manifest: {
          schemaVersion: 1,
          id: "knowledge@platform",
          version: "1.0.0",
          digest: "b".repeat(64),
          displayName: "Knowledge",
          description: "Search private knowledge.",
          source: "system",
          trust: "system",
          mcpServers: [{ name: "knowledge", url, tools: [] }],
        },
      },
    ],
    connectionGrants: [
      {
        pluginId: "knowledge@platform",
        serverName: "knowledge",
        headers: {
          "X-Caller-Service": "runtime",
          "X-Auth-User-ID": "user",
          "X-Auth-Tenant-ID": "tenant",
          "X-Auth-Workspace-ID": "workspace",
          "X-Auth-Workspace-Role": "member",
        },
      },
    ],
  };
}

const settings = {
  internalApiToken: "runtime-secret",
  knowledgeServiceUrl: "http://knowledge:8010",
  canvasServiceUrl: "http://canvas:8012",
};

test("platform credential is injected only after the fixed endpoint and system trust are verified", () => {
  const resolved = attachPlatformMcpCredential(snapshot(), settings);
  assert.equal(resolved.connectionGrants[0]?.headers["X-Internal-Token"], "runtime-secret");
  assert.equal(resolved.connectionGrants[0]?.headers["X-Runtime-Scope-Credential"], undefined);
  const bound = bindTurnPluginGrants(resolved, { runId: "run", attemptEpoch: 2 });
  assert.equal(bound.connectionGrants[0]?.headers["X-Runtime-Turn-ID"], "run");
  assert.equal(bound.connectionGrants[0]?.headers["X-Runtime-Attempt-Epoch"], "2");
  assert.match(bound.connectionGrants[0]?.headers["X-Runtime-Scope-Credential"] ?? "", /^v1\.[\w-]+$/);
  assert.throws(
    () => attachPlatformMcpCredential(snapshot("https://attacker.example/mcp"), settings),
    /configured platform MCP endpoint/,
  );
});

test("admin cannot supply or override the Runtime workload credential", () => {
  const value = snapshot();
  const forged: ResolvedTurnPluginSnapshot = {
    ...value,
    connectionGrants: [
      {
        ...value.connectionGrants[0],
        headers: { ...value.connectionGrants[0].headers, "x-internal-token": "attacker" },
      },
    ],
  };
  assert.throws(() => attachPlatformMcpCredential(forged, settings), AdminUnavailableError);
});

test("Desktop cannot receive system plugin grants from the service trust domain", () => {
  assert.throws(() => assertLocalPluginExecutionAllowed(snapshot()), /requires cloud Runtime execution/);
  const value = snapshot();
  const external: ResolvedTurnPluginSnapshot = {
    ...value,
    plugins: [
      {
        manifest: {
          ...value.plugins[0].manifest,
          id: "docs@external",
          source: "external-mcp",
          trust: "unverified",
        },
        activation: { pluginId: "docs@external" },
      },
    ],
    connectionGrants: [
      {
        ...value.connectionGrants[0],
        pluginId: "docs@external",
      },
    ],
  };
  assert.equal(assertLocalPluginExecutionAllowed(external), external);
});
