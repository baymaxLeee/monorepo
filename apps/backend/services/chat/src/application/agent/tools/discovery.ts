import { toolSearch } from "ai";

import type { AgentToolManifest, AgentToolPolicy } from "./types.js";

export function createToolSearchManifest(): AgentToolManifest {
  const policy: AgentToolPolicy = {
    capability: "search",
    effect: "none",
    trust: "closed",
    execution: "inline",
    modes: ["normal", "plan"],
    source: "builtin",
  };
  return {
    name: "tool_search",
    // The SDK consumes this result to activate deferred definitions. Keep its
    // native schema and tool-search marker instead of wrapping it in ToolOutcome.
    tool: { ...toolSearch(), metadata: { agent: { ...policy } } },
    policy,
    planning: { summary: "Discover optional integration tools by name or description." },
    availability: "available",
  };
}
