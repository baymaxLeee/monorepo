import type { AgentMode } from "../agents/types.js";
import type { AgentProfile } from "./types.js";

const profiles: Record<AgentMode, AgentProfile> = {
  normal: { id: "normal", runtime: "tool-loop" },
  plan: { id: "plan", runtime: "tool-loop" },
};

export function resolveAgentProfile(mode: AgentMode): AgentProfile {
  return profiles[mode];
}
