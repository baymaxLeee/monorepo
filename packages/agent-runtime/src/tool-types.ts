import type { ToolSet } from "ai";

import type { AgentMode } from "./types.js";

export type ToolCapability =
  | "canvas"
  | "search"
  | "files"
  | "planning"
  | "interaction"
  | "media"
  | "memory"
  | "external";

export type ToolEffect = "read" | "write" | "add" | "update" | "destructive" | "none" | "unknown";
export type ToolTrust = "closed" | "private-untrusted" | "open-world" | "unknown";
export type ToolExecution = "client" | "inline" | "durable";
export type ToolSource = "builtin" | "skill" | "mcp";
export type ToolAvailability = "available" | "requires-configuration";

export interface AgentToolPolicy {
  capability: ToolCapability;
  callableByCodeMode?: boolean;
  effect: ToolEffect;
  trust: ToolTrust;
  execution: ToolExecution;
  modes: AgentMode[];
  source: ToolSource;
  uiKind?: "artifact" | "ask-user" | "image-gallery" | "todo-list" | "video" | "terminal" | "subagent";
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
  policy: AgentToolPolicy;
  planning: AgentToolPlanning;
  availability: ToolAvailability;
}
