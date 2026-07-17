import type { AgentMode } from "../agents/types.js";

export type AgentRuntimeKind = "tool-loop" | "workflow" | "harness";

export interface AgentProfile {
  id: AgentMode;
  runtime: AgentRuntimeKind;
}
