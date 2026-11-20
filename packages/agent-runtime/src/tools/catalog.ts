import { DIRECT_TOOL_CALL } from "@ai-sdk/code-mode";

import { deferAgentToolLoading, manifestsToTools } from "./manifest.js";
import type { AgentToolManifest } from "./types.js";

/** Freeze one host's declarations into the settings consumed by the SDK loop. */
export function compileTurnTools(builtins: AgentToolManifest[], plugins: AgentToolManifest[]) {
  const manifests = [...builtins];
  for (const plugin of plugins) {
    if (plugin.policy.source !== "mcp") {
      throw new Error(`agent plugin ${plugin.policy.pluginId ?? "unknown"} contributed a non-MCP tool`);
    }
    manifests.push(deferAgentToolLoading(plugin));
  }
  const tools = manifestsToTools(manifests);
  const toolCallers: Record<string, (string | typeof DIRECT_TOOL_CALL)[]> = {};
  for (const { name, tool, policy } of manifests) {
    if (!tool || !policy.callableByCodeMode) continue;
    if (policy.effect !== "read" || policy.execution !== "inline" || policy.trust !== "open-world") {
      throw new Error(`Code Mode tool ${name} must be an inline, open-world read`);
    }
    toolCallers[name] = ["code_mode", DIRECT_TOOL_CALL];
  }
  return {
    manifests,
    tools,
    activeTools: Object.keys(tools),
    toolSources: new Map(manifests.map(({ name, policy }) => [name, policy.source])),
    toolCallers,
  };
}
