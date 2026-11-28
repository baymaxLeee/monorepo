import { asSchema, toolSearch } from "ai";

import type { AgentToolManifest, AgentToolPolicy } from "../core/types.js";
import { appendSchemaSearchText, rankToolSearch, type ToolSearchDocument } from "./tool-search-ranker.js";

const DEFAULT_TOOL_SEARCH_LIMIT = 8;

function namespaceFor(name: string): string | undefined {
  const segments = name.split("__");
  return segments.length > 2 ? segments.slice(0, -1).join("__") : undefined;
}

export function createToolSearchManifest(deferred: readonly AgentToolManifest[] = []): AgentToolManifest {
  const policy: AgentToolPolicy = {
    capability: "search",
    effect: "none",
    trust: "closed",
    execution: "inline",
    source: "builtin",
  };
  const byName = new Map(deferred.map((manifest) => [manifest.name, manifest]));
  let documents: Promise<ToolSearchDocument[]> | undefined;
  const searchOptions = deferred.length
    ? {
        maxResults: DEFAULT_TOOL_SEARCH_LIMIT,
        search: async ({ query, tools }: { query: string; tools: Array<{ name: string; description?: string }> }) => {
          documents ??= Promise.all(
            deferred.map(async (manifest) => {
              const parts = [
                typeof manifest.tool?.description === "string" ? manifest.tool.description : "",
                manifest.planning.summary,
              ];
              if (manifest.tool && "inputSchema" in manifest.tool) {
                appendSchemaSearchText(await asSchema(manifest.tool.inputSchema).jsonSchema, parts);
              }
              return {
                name: manifest.name,
                text: parts.filter(Boolean).join(" "),
                namespaceText: namespaceFor(manifest.name),
              };
            }),
          );
          const eligible = new Set(tools.map(({ name }) => name));
          return rankToolSearch(
            query,
            (await documents).filter(({ name }) => eligible.has(name) && byName.has(name)),
            DEFAULT_TOOL_SEARCH_LIMIT,
          ).map(({ name }) => name);
        },
      }
    : { maxResults: DEFAULT_TOOL_SEARCH_LIMIT };
  const search = toolSearch(searchOptions);
  const sources = [...new Set(deferred.map(({ name }) => namespaceFor(name) ?? name))].sort();
  const description = sources.length
    ? `${search.description} Searchable capability sources in this turn: ${sources.join(", ")}.`
    : search.description;
  return {
    name: "tool_search",
    // The SDK consumes this result to activate deferred definitions. Keep its
    // native schema and tool-search marker instead of wrapping it in ToolOutcome.
    tool: { ...search, description, metadata: { agent: { ...policy } } },
    exposure: "direct-model-only",
    policy,
    planning: { summary: "Discover optional tools by name or description." },
    availability: "available",
  };
}
