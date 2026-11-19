import { loadMcpServer } from "./mcp.js";
import type {
  AgentPluginContext,
  LoadedPluginContribution,
  McpConnectionGrant,
  PluginRuntimeOptions,
  ResolvedPluginSet,
  ResolvedTurnPluginSnapshot,
} from "./types.js";
import { assertPluginId, validateResolvedSnapshot } from "./validation.js";

function connectionGrant(
  grants: readonly McpConnectionGrant[],
  pluginId: string,
  serverName: string,
): McpConnectionGrant {
  const matches = grants.filter((grant) => grant.pluginId === pluginId && grant.serverName === serverName);
  if (matches.length !== 1) {
    throw new Error(`agent plugin ${pluginId} MCP server ${serverName} requires exactly one connection grant`);
  }
  return matches[0]!;
}

/** Turn-scoped loader for an already authorized Admin/local-installer snapshot. */
export class PluginManager {
  readonly #options: PluginRuntimeOptions;

  constructor(options: PluginRuntimeOptions = {}) {
    this.#options = options;
  }

  async load(snapshot: ResolvedTurnPluginSnapshot, context: AgentPluginContext): Promise<ResolvedPluginSet> {
    validateResolvedSnapshot(snapshot, context);
    const loaded: LoadedPluginContribution[] = [];
    const activePlugins = [];
    const manifests = [];
    const skills = [];

    try {
      for (const resolved of snapshot.plugins) {
        const plugin = resolved.manifest;
        assertPluginId(plugin.id);
        activePlugins.push(plugin);
        skills.push(...(plugin.skills ?? []).map((skill) => ({ pluginId: plugin.id, ...skill })));
        for (const server of plugin.mcpServers) {
          const contribution = loadMcpServer(
            {
              plugin,
              activation: resolved.activation,
              server,
              grant: connectionGrant(snapshot.connectionGrants, plugin.id, server.name),
            },
            context,
            this.#options,
          );
          loaded.push(contribution);
          manifests.push(...contribution.manifests);
        }
      }
      return {
        snapshotId: snapshot.snapshotId,
        snapshotDigest: snapshot.snapshotDigest,
        manifests,
        activePlugins,
        skills,
        dispose: async () => {
          await Promise.allSettled(
            loaded
              .slice()
              .reverse()
              .map((item) => item.dispose?.()),
          );
        },
      };
    } catch (error) {
      await Promise.allSettled(
        loaded
          .slice()
          .reverse()
          .map((item) => item.dispose?.()),
      );
      throw error;
    }
  }
}
