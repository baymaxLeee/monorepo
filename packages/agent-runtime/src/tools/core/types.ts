import type { ToolSet } from "ai";

export type ToolCapability = "search" | "files" | "planning" | "interaction" | "media" | "memory" | "external";

export type ToolEffect = "read" | "write" | "add" | "update" | "destructive" | "none" | "unknown";
export type ToolTrust = "closed" | "private-untrusted" | "open-world" | "unknown";
export type ToolExecution = "client" | "inline" | "durable";
export type ToolSource = "builtin" | "skill" | "mcp";
export type ToolAvailability = "available" | "requires-configuration";

/** Independent model-facing surfaces. A tool stays executable only on the
 * surfaces selected by its exposure; registration alone grants no visibility. */
export type ToolExposure =
  | "direct"
  | "deferred"
  | "deferred-model-only"
  | "direct-model-only"
  | "code-mode-only"
  | "hidden";

export type ToolSourceProjection = { kind: "url-results" } | { kind: "document-results"; resolver: string };

export interface AgentToolPolicy {
  capability: ToolCapability;
  callableByCodeMode?: boolean;
  effect: ToolEffect;
  trust: ToolTrust;
  execution: ToolExecution;
  source: ToolSource;
  pluginId?: string;
  sourceProjection?: ToolSourceProjection;
  streaming?: boolean;
  uiKind?: "artifact" | "ask-user" | "image-gallery" | "todo-list" | "video" | "terminal" | "subagent" | "agent-ui";
}

export interface AgentToolPlanning {
  summary: string;
  constraints?: string[];
  prerequisites?: string[];
  parallelizable?: boolean;
}

export interface AgentToolManifest {
  name: string;
  tool?: ToolSet[string];
  exposure: ToolExposure;
  policy: AgentToolPolicy;
  planning: AgentToolPlanning;
  availability: ToolAvailability;
}
