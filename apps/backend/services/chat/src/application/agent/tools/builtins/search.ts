import { tool } from "ai";
import { z } from "zod";

import { getSettings } from "../../../../bootstrap/config.js";
import { retrieveKnowledge } from "../../../../infrastructure/clients/knowledge.js";
import { knowledgeSearchToolContextSchema, type KnowledgeSearchToolContext } from "../context.js";
import { defineAgentTool } from "../manifest.js";
import { ToolBlockedError } from "../outcome.js";

const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  published_date: z.string().nullable(),
  score: z.number().nullable(),
});

const webSearchOutputSchema = z.object({
  query: z.string(),
  untrusted: z.literal(true),
  results: z.array(searchResultSchema),
});

type WebSearchInput = {
  query: string;
  max_results: number;
  category?: "news" | "research_paper";
  time_range?: "day" | "week" | "month" | "year";
  start_date?: string;
  end_date?: string;
};

const EXA_CATEGORY: Record<NonNullable<WebSearchInput["category"]>, string> = {
  news: "news",
  research_paper: "research paper",
};

// Exa splits freshness across two independent levers: startPublishedDate biases
// WHICH results come back (by publish date), while maxAgeHours controls how
// stale the fetched page CONTENT may be before Exa livecrawls it. Recency intent
// needs both; an explicit historical range needs only the date filter.
const TIME_RANGE_HOURS: Record<NonNullable<WebSearchInput["time_range"]>, number> = {
  day: 24,
  week: 168,
  month: 744,
  year: 8760,
};

type WebSearchCompleted = z.infer<typeof webSearchOutputSchema>;

interface ExaSearchResult {
  title?: string | null;
  url?: string;
  publishedDate?: string | null;
  summary?: string | null;
  text?: string | null;
  highlights?: string[];
  highlightScores?: number[];
}

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string | null;
  score?: number;
}

function searchHttpError(provider: string, status: number, body: string): Error {
  return Object.assign(new Error(`${provider} HTTP ${status}: ${body.slice(0, 500)}`), {
    code: `${provider.toUpperCase()}_REQUEST_FAILED`,
    statusCode: status,
    details: { provider, status_code: status, body: body.slice(0, 500) },
  });
}

function errorSummary(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error) ?? `non-Error ${typeof error}`;
  } catch {
    return `non-Error ${typeof error}`;
  }
}

function timeoutSignal(abortSignal?: AbortSignal): AbortSignal {
  return abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000);
}

function startDateForRange(range: WebSearchInput["time_range"]): string | undefined {
  if (!range) {
    return undefined;
  }
  const date = new Date();
  const days = { day: 1, week: 7, month: 31, year: 366 }[range];
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function startOfDayIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function endOfDayIso(date: string): string {
  return `${date}T23:59:59.999Z`;
}

async function searchExa(
  apiKey: string,
  input: WebSearchInput,
  abortSignal?: AbortSignal,
): Promise<WebSearchCompleted> {
  const startPublishedDate = input.start_date ? startOfDayIso(input.start_date) : startDateForRange(input.time_range);

  // highlights are the token-efficient snippet Exa recommends for agents; the
  // heavier whole-page summary is only worth its extra cost/latency for research.
  const contents: Record<string, unknown> = { highlights: true };
  if (input.category === "research_paper") {
    contents.summary = true;
  }
  if (input.time_range) {
    contents.maxAgeHours = TIME_RANGE_HOURS[input.time_range];
  }

  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query: input.query,
      numResults: input.max_results,
      type: "auto",
      ...(input.category ? { category: EXA_CATEGORY[input.category] } : {}),
      ...(startPublishedDate ? { startPublishedDate } : {}),
      ...(input.end_date ? { endPublishedDate: endOfDayIso(input.end_date) } : {}),
      contents,
    }),
    signal: timeoutSignal(abortSignal),
  });
  if (!response.ok) {
    throw searchHttpError("exa", response.status, await response.text());
  }
  const data = (await response.json()) as { results?: ExaSearchResult[] };
  return {
    query: input.query,
    untrusted: true,
    results: (data.results ?? []).map((row) => ({
      title: row.title ?? "",
      url: row.url ?? "",
      snippet:
        row.highlights && row.highlights.length > 0 ? row.highlights.join(" … ") : (row.summary ?? row.text ?? ""),
      published_date: row.publishedDate ?? null,
      score: row.highlightScores?.[0] ?? null,
    })),
  };
}

async function searchTavily(
  apiKey: string,
  input: WebSearchInput,
  abortSignal?: AbortSignal,
): Promise<WebSearchCompleted> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: input.query,
      max_results: input.max_results,
      search_depth: "advanced",
      include_answer: false,
      include_raw_content: false,
      topic: input.category === "news" ? "news" : "general",
      ...(input.time_range ? { time_range: input.time_range } : {}),
      ...(input.start_date ? { start_date: input.start_date } : {}),
      ...(input.end_date ? { end_date: input.end_date } : {}),
    }),
    signal: timeoutSignal(abortSignal),
  });
  if (!response.ok) {
    throw searchHttpError("tavily", response.status, await response.text());
  }
  const data = (await response.json()) as { results?: TavilySearchResult[] };
  return {
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
}

async function webSearch(
  input: WebSearchInput,
  { abortSignal }: { abortSignal?: AbortSignal },
): Promise<z.infer<typeof webSearchOutputSchema>> {
  const settings = getSettings();
  if (!settings.exaApiKey && !settings.tavilyApiKey) {
    throw new ToolBlockedError({
      code: "WEB_SEARCH_NOT_CONFIGURED",
      message: "EXA_API_KEY or TAVILY_API_KEY is not configured",
      retryable: false,
      source: "web-search",
    });
  }

  let exaError: unknown;
  if (settings.exaApiKey) {
    try {
      const exa = await searchExa(settings.exaApiKey, input, abortSignal);
      if (exa.results.length > 0 || !settings.tavilyApiKey) {
        return exa;
      }
    } catch (error) {
      exaError = error;
      if (!settings.tavilyApiKey) {
        throw error;
      }
    }
  }

  try {
    return await searchTavily(settings.tavilyApiKey, input, abortSignal);
  } catch (error) {
    if (exaError) {
      throw Object.assign(new Error(`Exa primary failed, then Tavily fallback failed: ${errorSummary(error)}`), {
        code: "WEB_SEARCH_PROVIDERS_FAILED",
        details: { exa: errorSummary(exaError), tavily: errorSummary(error) },
      });
    }
    throw error;
  }
}

const knowledgeSearchOutputSchema = z.object({
  query: z.string(),
  note: z.string().nullable(),
  untrusted: z.literal(true),
  results: z.array(
    z.object({
      document_id: z.string(),
      title: z.string(),
      filename: z.string(),
      chunk_index: z.number(),
      score: z.number(),
      content: z.string(),
    }),
  ),
});

async function knowledgeSearch(
  input: { query: string; top_k?: number },
  { context, abortSignal }: { context: KnowledgeSearchToolContext; abortSignal?: AbortSignal },
): Promise<z.infer<typeof knowledgeSearchOutputSchema>> {
  const result = await retrieveKnowledge(context.userId, context.orgId, input.query, input.top_k, abortSignal);
  const emptyNote =
    "no relevant knowledge base passages found; use web_search for public information or report that private knowledge does not cover the question";
  return {
    query: result.query,
    note: result.chunks.length === 0 ? (result.note ?? emptyNote) : (result.note ?? null),
    untrusted: true,
    results: result.chunks.map((chunk) => ({
      document_id: chunk.document_id,
      title: chunk.title,
      filename: chunk.filename,
      chunk_index: chunk.chunk_index,
      score: chunk.score,
      content: chunk.content,
    })),
  };
}

export function createSearchToolManifests() {
  return [
    defineAgentTool(
      "web_search",
      tool({
        description:
          "Search current or public web information and return titled sources with URLs. Set category to 'news' for current events/trends or 'research_paper' for academic and technical papers; use time_range or start_date/end_date to bound recency.",
        inputSchema: z.object({
          query: z.string().min(1).max(2_000).describe("Focused natural-language search query."),
          max_results: z.number().int().min(1).max(8).default(5).describe("Maximum sources to return."),
          category: z
            .enum(["news", "research_paper"])
            .optional()
            .describe("Optional source category; omit for general web search."),
          time_range: z
            .enum(["day", "week", "month", "year"])
            .optional()
            .describe("Relative freshness window. Do not combine with explicit start_date/end_date."),
          start_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe("Optional inclusive publication start date in YYYY-MM-DD format."),
          end_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe("Optional inclusive publication end date in YYYY-MM-DD format."),
        }),
        inputExamples: [
          {
            input: {
              query: "Vercel AI SDK tool calling reliability",
              category: "research_paper",
              max_results: 5,
            },
          },
        ],
        outputSchema: webSearchOutputSchema,
        execute: webSearch,
      }),
      {
        capability: "search",
        effect: "read",
        trust: "open-world",
        execution: "inline",
        modes: ["normal", "plan"],
      },
      { summary: "Search current and public web sources." },
    ),
    defineAgentTool(
      "knowledge_search",
      tool({
        description:
          "Search the team's shared knowledge base for uploaded documents, past incident write-ups, runbooks, internal policies, and organization-specific facts.",
        inputSchema: z.object({
          query: z.string().min(1).max(2_000).describe("Focused semantic query for private knowledge."),
          top_k: z.number().int().min(1).max(20).optional().describe("Optional maximum passage count."),
        }),
        outputSchema: knowledgeSearchOutputSchema,
        contextSchema: knowledgeSearchToolContextSchema,
        execute: knowledgeSearch,
      }),
      {
        capability: "search",
        effect: "read",
        trust: "private-untrusted",
        execution: "inline",
        modes: ["normal", "plan"],
      },
      { summary: "Search uploaded and organization-private knowledge." },
    ),
  ];
}
