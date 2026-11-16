import type { AgentToolManifest } from "./types.js";

/**
 * Selects the shared defaults for one agent. Agent/host-specific manifests are
 * supplied separately and are enabled by construction, matching Eve's model of
 * framework defaults plus agent-owned additions, replacements and disables.
 */
export interface AgentToolProfile {
  defaultTools?: boolean;
  include?: readonly string[];
  disable?: readonly string[];
}

export const primaryAgentToolProfile = {
  defaultTools: true,
} as const satisfies AgentToolProfile;

function manifestMap(manifests: readonly AgentToolManifest[], source: string): Map<string, AgentToolManifest> {
  const result = new Map<string, AgentToolManifest>();
  for (const manifest of manifests) {
    if (result.has(manifest.name)) {
      throw new Error(`duplicate ${source} agent tool ${manifest.name}`);
    }
    result.set(manifest.name, manifest);
  }
  return result;
}

/**
 * Resolves the exact capability surface passed to a ToolLoopAgent.
 *
 * Shared defaults are reusable definitions, not a global tool bag. A profile
 * may turn them off and opt back into selected slots. Agent-specific tools are
 * overlaid afterward, so a host can bind a shared logical slot to its concrete
 * executor without changing the profile or duplicating the definition.
 */
export function resolveAgentToolProfile({
  defaults,
  additions = [],
  profile,
}: {
  defaults: readonly AgentToolManifest[];
  additions?: readonly AgentToolManifest[];
  profile: AgentToolProfile;
}): AgentToolManifest[] {
  const defaultRegistry = manifestMap(defaults, "default");
  const additionRegistry = manifestMap(additions, "additional");
  const resolved = profile.defaultTools === false ? new Map<string, AgentToolManifest>() : new Map(defaultRegistry);

  for (const name of profile.include ?? []) {
    const manifest = additionRegistry.get(name) ?? defaultRegistry.get(name);
    if (!manifest) {
      throw new Error(`agent tool profile includes unknown tool ${name}`);
    }
    resolved.set(name, manifest);
  }

  // Agent-owned additions are enabled for that agent and replace a framework
  // default with the same logical name, as in Eve's built-in tool slots.
  for (const [name, manifest] of additionRegistry) {
    resolved.set(name, manifest);
  }

  for (const name of profile.disable ?? []) {
    resolved.delete(name);
  }

  return [...resolved.values()];
}
