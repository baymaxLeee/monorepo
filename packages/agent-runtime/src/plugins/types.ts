import type { JSONSchema7 } from "@ai-sdk/provider";

import type { AgentToolManifest, AgentToolPlanning, AgentToolPolicy } from "../tools/types.js";

export type PluginSourceKind = "system" | "external-mcp" | "local";
export type PluginTrustLevel = "system" | "verified" | "unverified";

/** User-owned selection. Endpoints, credentials and tool policy never enter this shape. */
export interface PluginActivation {
  /** Stable `name@marketplace` identity selected by the product host. */
  pluginId: string;
  /** Manifest-declared, non-secret resource bindings such as project or canvas IDs. */
  bindings?: Readonly<Record<string, string>>;
}

export interface AgentPluginContext {
  signal?: AbortSignal;
}

export interface PluginSkillContribution {
  id: string;
  name: string;
  description: string;
  assetId: string;
  revisionId: string;
  sha256: string;
}

/** Manifest skill annotated with the immutable plugin release that owns it. */
export interface ResolvedPluginSkillContribution extends PluginSkillContribution {
  pluginId: string;
}

export interface McpToolContribution {
  /** Tool name as advertised and invoked on the MCP server. */
  name: string;
  description: string;
  /** Immutable schema reviewed when the plugin release was published. */
  inputSchema: JSONSchema7;
  outputSchema?: JSONSchema7;
  policy: Omit<AgentToolPolicy, "source" | "pluginId">;
  planning: AgentToolPlanning;
}

export interface McpServerContribution {
  /** Stable server namespace across plugin releases. */
  name: string;
  /** Admin-resolved fixed endpoint. It is never accepted from Chat or the renderer. */
  url: string;
  requiredBindings?: readonly string[];
  optionalBindings?: readonly string[];
  tools: readonly McpToolContribution[];
}

/** Immutable, digest-addressed release manifest governed by Admin or the local installer. */
export interface AgentPluginManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  digest: string;
  displayName: string;
  description: string;
  source: PluginSourceKind;
  trust: PluginTrustLevel;
  mcpServers: readonly McpServerContribution[];
  skills?: readonly PluginSkillContribution[];
}

/** Secret-bearing connection material is deliberately outside the persisted manifest digest. */
export interface McpConnectionGrant {
  pluginId: string;
  serverName: string;
  headers: Readonly<Record<string, string>>;
  expiresAt?: string;
}

export interface ResolvedPluginActivation {
  manifest: AgentPluginManifest;
  activation: PluginActivation;
}

/**
 * Trusted, Turn-frozen resolution result. Runtime persists the manifest/activation projection and
 * keeps connection grants in memory only. Every host obtains this shape through a trusted resolver;
 * Chat and browser renderers only carry PluginActivation.
 */
export interface ResolvedTurnPluginSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  snapshotDigest: string;
  plugins: readonly ResolvedPluginActivation[];
  connectionGrants: readonly McpConnectionGrant[];
}

/**
 * Durable audit/recovery projection of a Turn-frozen plugin resolution.
 *
 * This shape is intentionally declared field-by-field instead of deriving from
 * `ResolvedTurnPluginSnapshot`: adding new connection material to the resolved
 * shape must never make it persist by default.
 */
export interface PersistedTurnPluginSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  snapshotDigest: string;
  plugins: readonly ResolvedPluginActivation[];
}

export type PluginRuntimeStatus = "connecting" | "connected" | "failed" | "closed";

export type PluginRuntimeEvent =
  | {
      type: "mcp-connection";
      pluginId: string;
      serverName: string;
      status: PluginRuntimeStatus;
      error?: string;
    }
  | {
      type: "mcp-inventory";
      pluginId: string;
      serverName: string;
      tools: readonly string[];
    };

export interface PluginRuntimeOptions {
  observe?: (event: PluginRuntimeEvent) => void | Promise<void>;
  onUncaughtError?: (error: unknown) => void;
}

export interface LoadedPluginContribution {
  manifests: AgentToolManifest[];
  skills: PluginSkillContribution[];
  dispose?: () => void | Promise<void>;
}

export interface ResolvedPluginSet {
  snapshotId: string;
  snapshotDigest: string;
  manifests: AgentToolManifest[];
  activePlugins: AgentPluginManifest[];
  skills: ResolvedPluginSkillContribution[];
  dispose(): Promise<void>;
}
