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
      description: "Search the public web for current information using Tavily.",
      inputSchema: z.object({
        query: z.string().min(1),
        max_results: z.number().int().min(1).max(8).default(5),
      }),
      execute: webSearch,
    }),
  };
}
