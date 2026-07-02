import { tool } from "ai";
import { z } from "zod";

import { retrieveKnowledge } from "../../../clients/knowledge.js";
import { knowledgeSearchToolContextSchema, type KnowledgeSearchToolContext } from "../context.js";

async function searchKnowledge(
  input: { query: string; top_k?: number },
  { context }: { context: KnowledgeSearchToolContext },
) {
  try {
    const result = await retrieveKnowledge(context.userId, input.query, input.top_k);
    return {
      ok: true,
      query: result.query,
      note: result.note ?? null,
      results: result.chunks.map((chunk) => ({
        document_id: chunk.document_id,
        title: chunk.title,
        filename: chunk.filename,
        chunk_index: chunk.chunk_index,
        score: chunk.score,
        content: chunk.content,
      })),
    };
  } catch (error) {
    return { ok: false, error: `knowledge search failed: ${String(error).slice(0, 500)}` };
  }
}

export function createKnowledgeSearchTools() {
  return {
    search_knowledge: tool({
      description:
        "Search the user's knowledge base (their uploaded/ingested documents) for passages " +
        "relevant to a question. Returns passages with their source document title for citation. " +
        "Use this to answer questions grounded in the user's own or enterprise documents; use " +
        "web_search instead for current public information not in the knowledge base.",
      inputSchema: z.object({
        query: z.string().min(1).max(2000).describe("A focused natural-language search query."),
        top_k: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("How many passages to return (default is server-configured)."),
      }),
      contextSchema: knowledgeSearchToolContextSchema,
      execute: searchKnowledge,
    }),
  };
}
