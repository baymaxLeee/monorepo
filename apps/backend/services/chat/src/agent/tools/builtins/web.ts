import { tool } from "ai";
import { z } from "zod";

import { getSettings } from "../../../config.js";

async function webSearch(
  input: { query: string; max_results: number },
  { abortSignal }: { abortSignal?: AbortSignal },
) {
  const settings = getSettings();
  if (!settings.tavilyApiKey) {
    return { ok: false, error: "TAVILY_API_KEY is not configured" };
  }
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.tavilyApiKey}`,
      },
      body: JSON.stringify({
        query: input.query,
        max_results: input.max_results,
        search_depth: "advanced",
        include_answer: false,
        include_raw_content: false,
      }),
      signal: abortSignal
        ? AbortSignal.any([abortSignal, AbortSignal.timeout(45_000)])
        : AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `Tavily HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`,
      };
    }
    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        published_date?: string | null;
        score?: number;
      }>;
    };
    return {
      ok: true,
      query: input.query,
      untrusted: true,
      results: (data.results ?? []).map((row) => ({
        title: row.title ?? "",
        url: row.url ?? "",
        snippet: row.content ?? "",
        published_date: row.published_date ?? null,
        score: row.score ?? null,
      })),
    };
  } catch (error) {
    if (abortSignal?.aborted) throw error;
    return { ok: false, error: String(error).slice(0, 500) };
  }
}

export function createWebTools() {
  return {
    web_search: tool({
      description:
        // What it does.
        "Search the public web (Tavily) and return titled results with URLs and dates. " +
        // When to use it.
        "Use this for current, public, or time-sensitive information that is NOT in the user's " +
        "knowledge base — news, prices, weather, product releases, public reference, anything " +
        "'latest/today/this year'. Put the requested date or freshness window directly in the query. " +
        // When NOT to use it.
        "Do NOT use it for the user's own or organization-internal content (use search_knowledge " +
        "first), or for general knowledge/reasoning you can answer directly.",
      inputSchema: z.object({
        query: z.string().min(1),
        max_results: z.number().int().min(1).max(8).default(5),
      }),
      execute: webSearch,
    }),
  };
}
