import type { JSONSchema7 } from "@ai-sdk/provider";

import type { AgentToolPlanning, AgentToolPolicy, ToolSourceProjection } from "../tools/types.js";
import type {
  AgentPluginManifest,
  McpToolContribution,
  PersistedTurnPluginSnapshot,
  PluginActivation,
  ResolvedPluginActivation,
  ResolvedTurnPluginSnapshot,
} from "./types.js";

function cloneSchema(schema: JSONSchema7): JSONSchema7 {
  return structuredClone(schema);
}

function projectSourceProjection(source: ToolSourceProjection): ToolSourceProjection {
  return source.kind === "document-results" ? { kind: source.kind, resolver: source.resolver } : { kind: source.kind };
}

function projectPolicy(policy: McpToolContribution["policy"]): McpToolContribution["policy"] {
  return {
    capability: policy.capability,
    effect: policy.effect,
    trust: policy.trust,
    execution: policy.execution,
    ...(policy.callableByCodeMode === undefined ? {} : { callableByCodeMode: policy.callableByCodeMode }),
    ...(policy.sourceProjection ? { sourceProjection: projectSourceProjection(policy.sourceProjection) } : {}),
    ...(policy.streaming === undefined ? {} : { streaming: policy.streaming }),
    ...(policy.uiKind === undefined ? {} : { uiKind: policy.uiKind }),
  } satisfies Omit<AgentToolPolicy, "source" | "pluginId">;
}

function projectPlanning(planning: AgentToolPlanning): AgentToolPlanning {
  return {
    summary: planning.summary,
    ...(planning.constraints ? { constraints: [...planning.constraints] } : {}),
    ...(planning.prerequisites ? { prerequisites: [...planning.prerequisites] } : {}),
    ...(planning.parallelizable === undefined ? {} : { parallelizable: planning.parallelizable }),
  };
}

function projectTool(tool: McpToolContribution): McpToolContribution {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: cloneSchema(tool.inputSchema),
    ...(tool.outputSchema ? { outputSchema: cloneSchema(tool.outputSchema) } : {}),
    policy: projectPolicy(tool.policy),
    planning: projectPlanning(tool.planning),
  };
}

function projectManifest(manifest: AgentPluginManifest): AgentPluginManifest {
  return {
    schemaVersion: 1,
    id: manifest.id,
    version: manifest.version,
    digest: manifest.digest,
    displayName: manifest.displayName,
    description: manifest.description,
    source: manifest.source,
    trust: manifest.trust,
    mcpServers: manifest.mcpServers.map((server) => ({
      name: server.name,
      url: server.url,
      ...(server.requiredBindings ? { requiredBindings: [...server.requiredBindings] } : {}),
      ...(server.optionalBindings ? { optionalBindings: [...server.optionalBindings] } : {}),
      tools: server.tools.map(projectTool),
    })),
    ...(manifest.skills
      ? {
          skills: manifest.skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            assetId: skill.assetId,
            revisionId: skill.revisionId,
            sha256: skill.sha256,
          })),
        }
      : {}),
  };
}

function projectActivation(activation: PluginActivation): PluginActivation {
  return {
    pluginId: activation.pluginId,
    ...(activation.bindings
      ? {
          bindings: Object.fromEntries(
            Object.entries(activation.bindings)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, value]) => [key, value]),
          ),
        }
      : {}),
  };
}

function projectResolvedPlugin(resolved: ResolvedPluginActivation): ResolvedPluginActivation {
  return {
    manifest: projectManifest(resolved.manifest),
    activation: projectActivation(resolved.activation),
  };
}

/** Strip all ephemeral connection grants before a plugin snapshot crosses a persistence boundary. */
export function toPersistedTurnPluginSnapshot(snapshot: ResolvedTurnPluginSnapshot): PersistedTurnPluginSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: snapshot.snapshotId,
    snapshotDigest: snapshot.snapshotDigest,
    workspaceRevision: snapshot.workspaceRevision,
    tenantId: snapshot.tenantId,
    workspaceId: snapshot.workspaceId,
    resolvedAt: snapshot.resolvedAt,
    plugins: snapshot.plugins.map(projectResolvedPlugin),
  };
}
