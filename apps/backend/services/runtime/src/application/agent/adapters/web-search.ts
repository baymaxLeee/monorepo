import { type WebSearchInput, type WebSearchOutput, ToolBlockedError } from "@repo/agent-runtime";

import { getServerSettings } from "../../../config/server.js";

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

type WebSearchCompleted = WebSearchOutput;

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

function searchHttpError(provider: string, response: Response, body: string): Error {
  return Object.assign(new Error(`${provider} HTTP ${response.status}: ${body.slice(0, 500)}`), {
    code: `${provider.toUpperCase()}_REQUEST_FAILED`,
    statusCode: response.status,
    responseHeaders: Object.fromEntries(response.headers),
    details: { provider, status_code: response.status, body: body.slice(0, 500) },
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
    signal: abortSignal,
  });
  if (!response.ok) {
    throw searchHttpError("exa", response, await response.text());
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
    signal: abortSignal,
  });
  if (!response.ok) {
    throw searchHttpError("tavily", response, await response.text());
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

export async function webSearch(
  input: WebSearchInput,
  { abortSignal }: { abortSignal?: AbortSignal },
): Promise<WebSearchOutput> {
  const settings = getServerSettings();
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
