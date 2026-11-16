import { experimental_createWebFetchTool as createWebFetchTool } from "@ai-sdk/tool-web-fetch";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { defineAgentTool, transformToolPreservingCaller } from "../manifest.js";
import { toolCompleted, toolFailed } from "../outcome.js";

export const webSearchInputSchema = z.object({
  query: z.string().min(1).max(2_000).describe("Focused natural-language search query."),
  max_results: z.number().int().min(1).max(8).default(5).describe("Maximum sources to return."),
  category: z.enum(["news", "research_paper"]).optional(),
  time_range: z.enum(["day", "week", "month", "year"]).optional(),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export const webSearchOutputSchema = z.object({
  query: z.string(),
  untrusted: z.literal(true),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
      published_date: z.string().nullable(),
      score: z.number().nullable(),
    }),
  ),
});
export type WebSearchInput = z.infer<typeof webSearchInputSchema>;
export type WebSearchOutput = z.infer<typeof webSearchOutputSchema>;

const readPolicy = {
  capability: "search" as const,
  effect: "read" as const,
  trust: "open-world" as const,
  execution: "inline" as const,
  modes: ["normal", "plan"] as const,
};

export function createWebSearchManifest(
  search: (input: WebSearchInput, options: { abortSignal?: AbortSignal }) => Promise<WebSearchOutput>,
) {
  return defineAgentTool(
    "web_search",
    tool({
      description:
        "Run one focused public-web query and return titled sources with URLs. Use directly for one query. For two or more independent queries or programmatic aggregation, use code_mode.",
      inputSchema: webSearchInputSchema,
      outputSchema: webSearchOutputSchema,
      execute: search,
    }),
    { ...readPolicy, callableByCodeMode: true, modes: [...readPolicy.modes] },
    { summary: "Search current and public web sources." },
  );
}

export function createWebFetchManifest() {
  const base = createWebFetchTool();
  const described = transformToolPreservingCaller(
    base,
    (definition) =>
      ({
        ...definition,
        description:
          "Read one known public URL and return its main content as Markdown or text. Use web_search to discover sources and code_mode for multi-page aggregation.",
      }) as ToolSet[string],
  );
  return defineAgentTool(
    "web_fetch",
    {
      ...described,
      execute: async (input, options) => {
        const result = await base.execute(input, options);
        options.abortSignal?.throwIfAborted();
        if (!("type" in result)) throw new Error("Web Fetch returned an unexpected streaming result.");
        return result.type === "error"
          ? toolFailed({ code: result.errorCode, message: result.message, retryable: false, source: "web-fetch" })
          : toolCompleted(result);
      },
    },
    { ...readPolicy, callableByCodeMode: true, modes: [...readPolicy.modes] },
    { summary: "Read a public web page or text URL as Markdown.", parallelizable: true },
  );
}
