import {
  createMCPTools,
  createMCPClient,
  mcpAppClientCapabilities,
  readMCPAppResource,
  fingerprintMCPAppResource,
  detectMCPAppResourceDrift,
  type CallToolResult,
  splitMCPAppTools,
  type MCPAppResource,
  type ListToolsResult,
  type MCPClient,
} from "@ai-sdk/mcp";
import type { JSONSchema7, JSONValue } from "@ai-sdk/provider";
import { jsonSchema, type ToolResultOutput } from "@ai-sdk/provider-utils";
import { dynamicTool, type ToolSet } from "ai";
import { z } from "zod";

import { defineAgentTool } from "../tools/core/manifest.js";
import { normalizeToolIssue, toolFailed } from "../tools/core/outcome.js";
import type {
  AgentPluginContext,
  AgentPluginManifest,
  LoadedPluginContribution,
  McpConnectionGrant,
  McpServerContribution,
  PluginActivation,
  PluginRuntimeEvent,
  PluginRuntimeOptions,
} from "./types.js";

const MAX_TOOL_PAGES = 100;
const MCP_HANDSHAKE_TIMEOUT_MS = 10_000;

export interface ResolvedMcpServer {
  plugin: AgentPluginManifest;
  activation: PluginActivation;
  server: McpServerContribution;
  grant: McpConnectionGrant;
}

interface McpPluginDependencies {
  createClient(config: Parameters<typeof createMCPClient>[0]): Promise<MCPClient>;
}

function component(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJSON(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedInputSchema(schema: JSONSchema7): JSONSchema7 {
  return {
    ...schema,
    properties: schema.properties ?? {},
    additionalProperties: false,
  };
}

async function listAllTools(client: MCPClient, signal?: AbortSignal): Promise<ListToolsResult["tools"]> {
  const tools: ListToolsResult["tools"] = [];
  const names = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
    signal?.throwIfAborted();
    const result = await client.listTools({
      ...(cursor ? { params: { cursor } } : {}),
      options: { ...(signal ? { signal } : {}), timeout: MCP_HANDSHAKE_TIMEOUT_MS },
    });
    for (const tool of result.tools) {
      if (names.has(tool.name)) {
        throw new Error(`MCP server returned duplicate tool ${tool.name}`);
      }
      names.add(tool.name);
      tools.push(tool);
    }
    cursor = result.nextCursor;
    if (!cursor) return tools;
  }
  throw new Error(`MCP tool catalog exceeded ${MAX_TOOL_PAGES} pages`);
}

function mcpToModelOutput({ output }: { output: unknown }): ToolResultOutput {
  if (typeof output === "string") return { type: "text", value: output };
  if (output == null || typeof output !== "object" || !("content" in output) || !Array.isArray(output.content)) {
    const visible =
      output && typeof output === "object" && "_meta" in output
        ? Object.fromEntries(Object.entries(output).filter(([key]) => key !== "_meta"))
        : output;
    return { type: "json", value: (visible ?? null) as JSONValue };
  }
  return {
    type: "content",
    value: output.content.map((part: Record<string, unknown>) => {
      if (part?.type === "text" && typeof part.text === "string") {
        return { type: "text" as const, text: part.text };
      }
      if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
        return {
          type: "file" as const,
          mediaType: part.mimeType,
          data: { type: "data" as const, data: part.data },
        };
      }
      return { type: "text" as const, text: JSON.stringify(part) };
    }),
  };
}

async function observe(options: PluginRuntimeOptions, event: PluginRuntimeEvent): Promise<void> {
  await options.observe?.(event);
}

function connectHttpMcp(
  url: string,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
  createClient: McpPluginDependencies["createClient"],
  options: PluginRuntimeOptions = {},
) {
  return createClient({
    clientName: "monorepo-agent-runtime",
    capabilities: mcpAppClientCapabilities,
    version: "1.0.0",
    maxRetries: 0,
    initializationOptions: { signal, timeout: MCP_HANDSHAKE_TIMEOUT_MS },
    ...(options.onUncaughtError ? { onUncaughtError: options.onUncaughtError } : {}),
    transport: { type: "http", url, headers: { ...headers }, redirect: "error", terminateSessionOnClose: true },
  });
}

/** Local installations have no Admin release inventory. Freeze the advertised
 * schemas before exposing tools, and keep privileges independent of server annotations. */
export async function discoverInstalledMcpServer(
  name: string,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<McpServerContribution> {
  const client = await connectHttpMcp(url, headers, signal, createMCPClient);
  try {
    const { modelVisible } = splitMCPAppTools({ tools: await listAllTools(client, signal) });
    return {
      name,
      url,
      tools: modelVisible.tools
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({
          name: item.name,
          description: item.description?.trim() || item.name,
          inputSchema: item.inputSchema as JSONSchema7,
          ...(item.outputSchema ? { outputSchema: item.outputSchema as JSONSchema7 } : {}),
          policy: { capability: "external", effect: "unknown", trust: "open-world", execution: "inline" },
          planning: { summary: item.description?.trim() || item.name },
        })),
    };
  } finally {
    await client.close();
  }
}

// Only the execution host writes this receipt into a completed tool result.
export const mcpAppCallbackSchema = z.object({
  pluginId: z.string(),
  digest: z.string(),
  server: z.string(),
  tool: z.string(),
  bindings: z.record(z.string(), z.string()),
  uri: z.string().startsWith("ui://"),
  fingerprint: z.string(),
});
type AppCallback = z.infer<typeof mcpAppCallbackSchema>;

/**
 * Builds tools from the immutable release manifest and establishes the MCP connection lazily on
 * first use. The live server may supply results, but it cannot redefine policy, descriptions or
 * input schemas after Admin/local installation review.
 */
export function loadMcpServer(
  resolved: ResolvedMcpServer,
  context: AgentPluginContext,
  options: PluginRuntimeOptions = {},
  dependencies: McpPluginDependencies = { createClient: createMCPClient },
): LoadedPluginContribution & {
  callAppTool(receipt: AppCallback, args: Record<string, unknown>): Promise<CallToolResult>;
} {
  const { plugin, server, grant } = resolved;
  const appTools = new Set<string>();
  const appUris = new Map<string, string>();
  let clientPromise: Promise<MCPClient> | undefined;
  const lifetime = new AbortController();
  const signal = context.signal ? AbortSignal.any([context.signal, lifetime.signal]) : lifetime.signal;
  let closing: Promise<void> | undefined;

  const resources = new Map<string, Promise<MCPAppResource>>();
  const loadResource = (client: MCPClient, uri: string, caller: AbortSignal) => {
    caller.throwIfAborted();
    let resource = resources.get(uri);
    if (!resource) {
      resource = readMCPAppResource({ client, uri, options: { signal, timeout: MCP_HANDSHAKE_TIMEOUT_MS } }).catch(
        (error) => {
          resources.delete(uri);
          throw error;
        },
      );
      resources.set(uri, resource);
    }
    // The connection owns the shared read. An individual cancelled caller may
    // stop waiting without cancelling another tool's copy of the same view.
    return new Promise<MCPAppResource>((resolve, reject) => {
      const abort = () => reject(caller.reason);
      caller.addEventListener("abort", abort, { once: true });
      void resource.then(resolve, reject).finally(() => caller.removeEventListener("abort", abort));
    });
  };

  const connect = (): Promise<MCPClient> => {
    signal.throwIfAborted();
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
      await observe(options, {
        type: "mcp-connection",
        pluginId: plugin.id,
        serverName: server.name,
        status: "connecting",
      });
      try {
        signal.throwIfAborted();
        const client = await connectHttpMcp(server.url, grant.headers, signal, dependencies.createClient, options);
        try {
          const { modelVisible, appVisible } = splitMCPAppTools({ tools: await listAllTools(client, signal) });
          for (const tool of appVisible.tools) appTools.add(tool.name);
          const inventory = modelVisible.tools;
          if (inventory.length !== server.tools.length) {
            throw new Error(`MCP server ${server.name} inventory differs from the installed release`);
          }
          const definitions = new Map(inventory.map((tool) => [tool.name, tool]));
          for (const expected of server.tools) {
            const actual = definitions.get(expected.name);
            if (!actual) {
              throw new Error(`MCP server ${server.name} is missing manifest tool ${expected.name}`);
            }
            if (
              stableJSON(normalizedInputSchema(actual.inputSchema as JSONSchema7)) !==
                stableJSON(normalizedInputSchema(expected.inputSchema)) ||
              stableJSON(actual.outputSchema) !== stableJSON(expected.outputSchema)
            ) {
              throw new Error(
                `MCP server ${server.name} tool ${expected.name} schema differs from the installed release`,
              );
            }
          }
          // Normalize both current and legacy MCP Apps metadata with the SDK.
          for (const [name, tool] of Object.entries(createMCPTools(inventory.filter((item) => item._meta)))) {
            const app = tool.metadata?.app;
            if (app && typeof app === "object" && "resourceUri" in app && typeof app.resourceUri === "string") {
              appUris.set(name, app.resourceUri);
            }
          }
          await observe(options, {
            type: "mcp-inventory",
            pluginId: plugin.id,
            serverName: server.name,
            tools: inventory.map((tool) => tool.name),
          });
          await observe(options, {
            type: "mcp-connection",
            pluginId: plugin.id,
            serverName: server.name,
            status: "connected",
          });
          return client;
        } catch (error) {
          await client.close().catch(() => undefined);
          throw error;
        }
      } catch (error) {
        await observe(options, {
          type: "mcp-connection",
          pluginId: plugin.id,
          serverName: server.name,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    })();
    return clientPromise;
  };

  const exposedNames = new Set<string>();
  const manifests = server.tools.map((contribution) => {
    const exposedName = `mcp__${component(server.name)}__${component(contribution.name)}`;
    if (exposedNames.has(exposedName)) {
      throw new Error(`MCP tool namespace collision at ${exposedName}`);
    }
    exposedNames.add(exposedName);
    const definition = dynamicTool({
      description: contribution.description,
      inputSchema: jsonSchema(normalizedInputSchema(contribution.inputSchema)),
      execute: async (input, execution) => {
        const callSignal = execution.abortSignal ? AbortSignal.any([signal, execution.abortSignal]) : signal;
        callSignal.throwIfAborted();
        const client = await connect();
        callSignal.throwIfAborted();
        const result = await client.callTool({
          name: contribution.name,
          arguments: input as Record<string, unknown>,
          options: { signal: callSignal },
        });
        if (result.isError) {
          const message = (Array.isArray(result.content) ? result.content : [])
            .flatMap((part) => (part?.type === "text" && typeof part.text === "string" ? [part.text] : []))
            .join("\n");
          return toolFailed(
            normalizeToolIssue(new Error(message || "MCP tool reported an error"), {
              code: "MCP_TOOL_ERROR",
              source: exposedName,
            }),
          );
        }
        // Only the authenticated connection may supply the view for this call.
        // Preserve the successful action even when its optional view cannot load.
        const { _meta, ...payload } = result;
        // Code Mode passes the raw result to model-authored code, bypassing toModelOutput.
        if (contribution.policy.callableByCodeMode) return payload;
        const { mcpAppResource: _untrustedView, mcpAppCallback: _untrustedCallback, ...serverMeta } = _meta ?? {};
        const publicResult = { ...payload, ...(Object.keys(serverMeta).length ? { _meta: serverMeta } : {}) };
        const uri = appUris.get(contribution.name);
        if (!uri) return publicResult;
        try {
          const resource = await loadResource(client, uri, callSignal);
          const callback =
            contribution.policy.effect === "read" &&
            contribution.policy.execution === "inline" &&
            appTools.has(contribution.name)
              ? {
                  pluginId: plugin.id,
                  digest: plugin.digest,
                  server: server.name,
                  tool: contribution.name,
                  bindings: { ...resolved.activation.bindings },
                  uri,
                  fingerprint: await fingerprintMCPAppResource(resource),
                }
              : undefined;
          return {
            ...payload,
            _meta: { ...serverMeta, mcpAppResource: callback ? { ...resource, callback } : resource },
          };
        } catch {
          callSignal.throwIfAborted();
          return publicResult;
        }
      },
      toModelOutput: mcpToModelOutput,
    }) as ToolSet[string];
    return defineAgentTool(
      exposedName,
      definition,
      {
        ...contribution.policy,
        source: "mcp",
        pluginId: plugin.id,
      },
      contribution.planning,
    );
  });

  return {
    manifests,
    skills: [],
    async callAppTool(receipt, args) {
      const tool = server.tools.find((candidate) => candidate.name === receipt.tool);
      if (
        receipt.pluginId !== plugin.id ||
        receipt.digest !== plugin.digest ||
        receipt.server !== server.name ||
        stableJSON(receipt.bindings) !== stableJSON(resolved.activation.bindings ?? {}) ||
        !tool ||
        tool.policy.effect !== "read" ||
        tool.policy.execution !== "inline"
      ) {
        throw new Error("MCP App release or tool binding changed");
      }
      const checkGrant = () => {
        if (grant.expiresAt && !(Date.parse(grant.expiresAt) > Date.now())) throw new Error("MCP App grant expired");
        signal.throwIfAborted();
      };
      checkGrant();
      const client = await connect();
      if (!appTools.has(tool.name) || appUris.get(tool.name) !== receipt.uri)
        throw new Error("MCP App tool is unavailable");
      const resource = await loadResource(client, receipt.uri, signal);
      if (detectMCPAppResourceDrift(await fingerprintMCPAppResource(resource), receipt.fingerprint))
        throw new Error("MCP App resource changed");
      z.fromJSONSchema(normalizedInputSchema(tool.inputSchema) as Parameters<typeof z.fromJSONSchema>[0]).parse(args);
      checkGrant();
      return client.callTool({ name: tool.name, arguments: args, options: { signal } });
    },
    dispose: () => {
      if (closing) return closing;
      lifetime.abort();
      resources.clear();
      closing = (async () => {
        const client = await clientPromise?.catch(() => undefined);
        await client?.close();
        await observe(options, {
          type: "mcp-connection",
          pluginId: plugin.id,
          serverName: server.name,
          status: "closed",
        });
      })();
      return closing;
    },
  };
}
