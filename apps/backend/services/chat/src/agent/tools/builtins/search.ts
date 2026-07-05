import { tool } from "ai";
import { z } from "zod";

import { getSettings } from "../../../config.js";
import { retrieveKnowledge } from "../../../clients/knowledge.js";
import {
  knowledgeSearchToolContextSchema,
  type KnowledgeSearchToolContext,
} from "../context.js";
import { defineAgentTool } from "../manifest.js";

const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  published_date: z.string().nullable(),
  score: z.number().nullable(),
});

const webSearchOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    query: z.string(),
    untrusted: z.literal(true),
    results: z.array(searchResultSchema),
  }),
  z.object({
    status: z.literal("blocked"),
    code: z.literal("WEB_SEARCH_NOT_CONFIGURED"),
    message: z.string(),
  }),
]);

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
): Promise<z.infer<typeof webSearchOutputSchema>> {
  const settings = getSettings();
  if (!settings.tavilyApiKey) {
    return {
      status: "blocked",
      code: "WEB_SEARCH_NOT_CONFIGURED",
      message: "TAVILY_API_KEY is not configured",
    };
  }
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
    throw new Error(`Tavily HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
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
    status: "completed",
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

const knowledgeSearchOutputSchema = z.object({
  status: z.literal("completed"),
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
  { context }: { context: KnowledgeSearchToolContext },
): Promise<z.infer<typeof knowledgeSearchOutputSchema>> {
  const result = await retrieveKnowledge(context.userId, context.orgId, input.query, input.top_k);
  const emptyNote =
    "no relevant knowledge base passages found; use web_search for public information or report that private knowledge does not cover the question";
  return {
    status: "completed",
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
        description: "Search current or public web information and return titled sources with URLs.",
        inputSchema: z.object({
          query: z.string().min(1).max(2_000),
          max_results: z.number().int().min(1).max(8).default(5),
          topic: z.enum(["general", "news", "finance"]).default("general"),
          time_range: z.enum(["day", "week", "month", "year"]).optional(),
          start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
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
          query: z.string().min(1).max(2_000),
          top_k: z.number().int().min(1).max(20).optional(),
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

