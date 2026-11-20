import assert from "node:assert/strict";
import test from "node:test";

import type { createMCPClient, MCPClient } from "@ai-sdk/mcp";
import type { JSONSchema7 } from "@ai-sdk/provider";

import { loadMcpServer } from "./mcp.js";
import type { AgentPluginContext, AgentPluginManifest, PluginRuntimeEvent } from "./types.js";

const context: AgentPluginContext = {
  turnId: "turn",
  threadId: "thread",
  userId: "user",
  tenantId: "tenant",
  workspaceId: "workspace",
  workspaceRole: "member",
};

const inputSchema = {
  type: "object" as const,
  properties: { query: { type: "string" as const } },
  required: ["query"],
};

const manifest: AgentPluginManifest = {
  schemaVersion: 1,
  id: "knowledge@platform",
  version: "1.0.0",
  digest: `sha256:${"a".repeat(64)}`,
  displayName: "Knowledge",
  description: "Private knowledge search.",
  source: "system",
  trust: "system",
  mcpServers: [
    {
      name: "knowledge",
      url: "http://knowledge.internal/mcp",
      tools: [
        {
          name: "search",
          description: "Search private documents.",
          inputSchema,
          policy: {
            capability: "search",
            effect: "read",
            trust: "private-untrusted",
            execution: "inline",
            sourceProjection: {
              kind: "document-results",
              resolver: "knowledge-document",
            },
          },
          planning: { summary: "Search private documents." },
        },
      ],
    },
  ],
};

function fakeClient(input: { schema?: JSONSchema7; closes: () => void; calls: (value: unknown) => void }): MCPClient {
  return {
    serverInfo: { name: "knowledge", version: "1.0.0" },
    initializeResult: {
      protocolVersion: "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "knowledge", version: "1.0.0" },
    },
    instructions: undefined,
    listTools: async () => ({
      tools: [
        {
          name: "search",
          description: "Live description is not authoritative.",
          inputSchema: input.schema ?? inputSchema,
        },
      ],
    }),
    callTool: async (request: unknown) => {
      input.calls(request);
      return { content: [{ type: "text", text: "found" }] };
    },
    close: async () => input.closes(),
  } as unknown as MCPClient;
}

function resolved() {
  return {
    plugin: manifest,
    activation: { pluginId: manifest.id },
    server: manifest.mcpServers[0]!,
    grant: {
      pluginId: manifest.id,
      serverName: "knowledge",
      headers: { Authorization: "Bearer opaque" },
    },
  };
}

void test("MCP connections are lazy and use immutable manifest policy", async () => {
  let connects = 0;
  let closes = 0;
  const calls: unknown[] = [];
  const events: PluginRuntimeEvent[] = [];
  const loaded = loadMcpServer(
    resolved(),
    context,
    {
      observe: (event) => {
        events.push(event);
      },
    },
    {
      createClient: (async () => {
        connects += 1;
        return fakeClient({ closes: () => closes++, calls: (value) => calls.push(value) });
      }) as unknown as typeof createMCPClient,
    },
  );
  assert.equal(connects, 0);
  const manifestTool = loaded.manifests[0]!;
  assert.equal(manifestTool.policy.pluginId, "knowledge@platform");
  assert.deepEqual(manifestTool.policy.sourceProjection, {
    kind: "document-results",
    resolver: "knowledge-document",
  });
  const executable = manifestTool.tool as {
    execute(input: unknown, options: { abortSignal?: AbortSignal }): Promise<unknown>;
  };
  const result = await executable.execute({ query: "runtime" }, {});
  assert.equal(connects, 1);
  assert.equal(calls.length, 1);
  const call = calls[0] as { options: { signal: AbortSignal } };
  assert.equal(call.options.signal.aborted, false);
  assert.deepEqual(calls[0], {
    name: "search",
    arguments: { query: "runtime" },
    options: { signal: call.options.signal },
  });
  assert.deepEqual(result, {
    ok: true,
    status: "completed",
    data: { content: [{ type: "text", text: "found" }] },
  });
  assert.deepEqual(
    events.map((event) => (event.type === "mcp-connection" ? event.status : event.type)),
    ["connecting", "mcp-inventory", "connected"],
  );
  await loaded.dispose?.();
  await loaded.dispose?.();
  assert.equal(closes, 1);
  const lastEvent = events.at(-1);
  assert.equal(lastEvent?.type, "mcp-connection");
  assert.equal(lastEvent?.type === "mcp-connection" && lastEvent.status, "closed");
});

void test("MCP catalog drift fails before the first tool side effect and closes the client", async () => {
  let closes = 0;
  let calls = 0;
  const loaded = loadMcpServer(
    resolved(),
    context,
    {},
    {
      createClient: (async () =>
        fakeClient({
          schema: {
            type: "object",
            properties: { query: { type: "number" } },
            required: ["query"],
          },
          closes: () => closes++,
          calls: () => calls++,
        })) as unknown as typeof createMCPClient,
    },
  );
  const executable = loaded.manifests[0]!.tool as {
    execute(input: unknown, options: { abortSignal?: AbortSignal }): Promise<unknown>;
  };
  const result = await executable.execute({ query: "runtime" }, {});
  assert.equal(calls, 0);
  assert.equal(closes, 1);
  assert.equal((result as { status: string }).status, "failed");
  assert.match((result as { error: { message: string } }).error.message, /schema differs from the installed release/);
});

test("a close failure reaches the owning turn and concurrent disposal closes once", async () => {
  let closes = 0;
  const contribution = loadMcpServer(
    resolved(),
    context,
    {},
    {
      createClient: async () =>
        fakeClient({
          calls: () => {},
          closes: () => {
            closes++;
            throw new Error("disconnect failed");
          },
        }),
    },
  );
  const executable = contribution.manifests[0]!.tool as { execute(input: unknown, options: object): Promise<unknown> };
  await executable.execute({ query: "runtime" }, {});
  const results = await Promise.allSettled([contribution.dispose!(), contribution.dispose!()]);
  assert.deepEqual(
    results.map(({ status }) => status),
    ["rejected", "rejected"],
  );
  assert.equal(closes, 1);
});
