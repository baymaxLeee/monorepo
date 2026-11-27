import assert from "node:assert/strict";
import test from "node:test";

import { mcpAppClientCapabilities, type createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { JSONSchema7 } from "@ai-sdk/provider";

import { findAppCallback } from "./app-call.js";
import { loadMcpServer } from "./mcp.js";
import type { AgentPluginContext, AgentPluginManifest, PluginRuntimeEvent } from "./types.js";

const context: AgentPluginContext = {};

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

test("an MCP tool-level error is a failed tool outcome even when the transport succeeds", async () => {
  const loaded = loadMcpServer(
    resolved(),
    context,
    {},
    {
      createClient: async () => ({
        ...fakeClient({ closes: () => {}, calls: () => {} }),
        callTool: async () => ({ isError: true, content: [{ type: "text" as const, text: "Index unavailable" }] }),
      }),
    },
  );
  const tool = loaded.manifests[0]!.tool as {
    execute(input: unknown, options: object): Promise<{ status: string; error?: { message: string } }>;
    toModelOutput(options: { output: unknown }): { type: string };
  };
  try {
    const outcome = await tool.execute({ query: "runtime" }, {});
    assert.equal(outcome.status, "failed");
    assert.match(outcome.error!.message, /Index unavailable/);
    assert.equal(tool.toModelOutput({ output: outcome }).type, "error-json");
  } finally {
    await loaded.dispose?.();
  }
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

test("MCP Apps cache verified views within a connection and keep app-only tools out of model inventory", async () => {
  const uri = "ui://knowledge/results";
  let calls = 0;
  let reads = 0;
  let failRead = true;
  let appVisible = true;
  let html = "<main>Knowledge</main>";
  const base = fakeClient({ closes: () => {}, calls: () => {} });
  const client: MCPClient = {
    ...base,
    listTools: async () => ({
      tools: [
        { name: "search", inputSchema, _meta: { ui: { resourceUri: uri,visibility: appVisible ? ["model","app"] : ["model"] } } },
        { name: "expand", inputSchema, _meta: { ui: { visibility: ["app"] } } },
      ],
    }),
    callTool: async () => {
      calls++;
      return { content: [{ type: "text", text: "passage" }], _meta: { mcpAppResource: "forged", local: "host-only" } };
    },
    readResource: async (request) => {
      assert.equal(request.uri, uri);
      reads++;
      if (failRead) throw new Error("view unavailable");
      return { contents: [{ uri, mimeType: "text/html;profile=mcp-app", text: html }] };
    },
  };
  const loaded = loadMcpServer(
    resolved(),
    context,
    {},
    {
      createClient: async (config) => {
        assert.deepEqual(config.capabilities, mcpAppClientCapabilities);
        return client;
      },
    },
  );
  assert.equal(loaded.manifests.length, 1);
  const tool = loaded.manifests[0]!.tool as {
    execute(input: unknown, options: object): Promise<{ ok: boolean; data: { _meta: Record<string, unknown> } }>;
    toModelOutput(options: { output: unknown }): unknown;
  };
  try {
    const fallback = await tool.execute({ query: "first" }, {});
    assert.equal(fallback.ok, true);
    assert.deepEqual(fallback.data._meta, { local: "host-only" });
    failRead = false;
    const [result, cached] = await Promise.all(["second", "third"].map((query) => tool.execute({ query }, {})));
    assert.equal(result.ok, true);
    const part = {type:"dynamic-tool",toolName:"mcp__knowledge__search",toolMetadata:{agent:{source:"mcp",pluginId:manifest.id}},state:"output-available",toolCallId:"call",output:result};
    const receipt = findAppCallback([part],"call","search");
    assert.throws(()=>findAppCallback([part,part],"call","search"));
    assert.throws(()=>findAppCallback([part],"call","expand"));
    assert.throws(()=>findAppCallback([{...part, state:"input-available"}],"call","search"));
    assert.throws(()=>findAppCallback([{...part,toolName:"other"}],"call","search"));
    assert.deepEqual(result.data._meta.mcpAppResource, {
      callback:receipt,
      uri,
      mimeType: "text/html;profile=mcp-app",
      html: "<main>Knowledge</main>",
      meta: undefined,
    });
    assert.deepEqual(cached.data._meta.mcpAppResource, result.data._meta.mcpAppResource);
    assert.deepEqual(tool.toModelOutput({ output: result }), {
      type: "content",
      value: [{ type: "text", text: "passage" }],
    });
    assert.equal(reads, 2);
    assert.equal(calls, 3);
    await loaded.dispose?.();
    let closed = 0;
    const fresh = () => loadMcpServer(resolved(),{}, {}, {createClient: async()=>({...client,close:async()=>{closed++;}})});
    const again = fresh();
    try {
      assert.ok(await again.callAppTool(receipt,{query:"next"}));
      await assert.rejects(again.callAppTool(receipt,{query:5}));
      await assert.rejects(again.callAppTool({...receipt,digest:"old"},{query:"x"}));
      await assert.rejects(again.callAppTool({...receipt,bindings:{canvas_id:"other"}},{query:"x"}));
    } finally { await again.dispose?.(); }
    html = "<main>Changed</main>";
    const changed = fresh();
    try { await assert.rejects(changed.callAppTool(receipt,{query:"x"}),/resource changed/); }
    finally { await changed.dispose?.(); }
    appVisible = false;
    const hidden = fresh();
    try { await assert.rejects(hidden.callAppTool(receipt,{query:"x"}),/unavailable/); }
    finally { await hidden.dispose?.(); }
    assert.equal(closed,3);
    assert.equal(calls,4);
  } finally {
    await loaded.dispose?.();
  }
});
