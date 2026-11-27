import { toolSearch } from "ai";

import type { AgentToolManifest, AgentToolPolicy } from "./types.js";

export function createToolSearchManifest(deferredNames: readonly string[] = []): AgentToolManifest {
  const policy: AgentToolPolicy = {
    capability: "search",
    effect: "none",
    trust: "closed",
    execution: "inline",
    source: "builtin",
  };
  const search = toolSearch();
  const description = deferredNames.length
    ? `${search.description} Searchable tools in this turn: ${deferredNames.join(", ")}.`
    : search.description;
  return {
    name: "tool_search",
    // The SDK consumes this result to activate deferred definitions. Keep its
    // native schema and tool-search marker instead of wrapping it in ToolOutcome.
    tool: { ...search, description, metadata: { agent: { ...policy } } },
    policy,
    planning: { summary: "Discover optional tools by name or description." },
    availability: "available",
  };
}
