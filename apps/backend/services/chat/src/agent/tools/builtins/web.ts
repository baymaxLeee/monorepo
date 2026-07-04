import { tool } from "ai";
import { z } from "zod";

import { getSettings } from "../../../config.js";

async function webSearch(
  input: {
    query: string;
    max_results: number;
    topic: "general" | "news" | "finance";
    time_range?: "day" | "week" | "month" | "year";
    start_date?: string;
    end_date?: string;
  },
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
        topic: input.topic,
        ...(input.time_range ? { time_range: input.time_range } : {}),
        ...(input.start_date ? { start_date: input.start_date } : {}),
        ...(input.end_date ? { end_date: input.end_date } : {}),
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
        "Search the public web (Tavily) and return titled results with URLs and dates. " +
        "Use this for current, public, or time-sensitive information that is NOT in the user's " +
        "knowledge base — news, prices, weather, product releases, public reference, anything " +
        "'latest/today/this year'. " +
        "IMPORTANT — freshness: read the current date from your <environment> context. When a " +
        "query is time-sensitive, put the CURRENT year in it and never default to an earlier " +
        "year such as 2025 (e.g. search 'React 19 release notes 2026', not '... 2025'). For " +
        "'latest/today/recent' questions, prefer the structured filters over a date in the query: " +
        "set topic='news' for current events, and narrow with time_range (day/week/month/year) OR " +
        "start_date/end_date (YYYY-MM-DD) — use one, not both. " +
        "Do NOT use it for the user's own or organization-internal content (use search_knowledge " +
        "first), or for general knowledge/reasoning you can answer directly.",
      inputSchema: z.object({
        query: z.string().min(1),
        max_results: z.number().int().min(1).max(8).default(5),
        topic: z
          .enum(["general", "news", "finance"])
          .default("general")
          .describe(
            "Search category. Use 'news' for current events / breaking topics (results then include published_date); 'finance' for markets; else 'general'.",
          ),
        time_range: z
          .enum(["day", "week", "month", "year"])
          .optional()
          .describe(
            "Relative freshness window back from today. Prefer this for 'latest/recent' queries. Mutually exclusive with start_date/end_date.",
          ),
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
          .optional()
          .describe(
            "Only results published on/after this date (YYYY-MM-DD). Use instead of time_range for an explicit range.",
          ),
        end_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
          .optional()
          .describe("Only results published on/before this date (YYYY-MM-DD)."),
      }),
      execute: webSearch,
    }),
  };
}
