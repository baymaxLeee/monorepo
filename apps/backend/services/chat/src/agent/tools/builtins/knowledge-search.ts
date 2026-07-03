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
    const emptyNote =
      "no relevant knowledge base passages found; if the answer is public information use web_search, otherwise tell the user the knowledge base does not cover this — do not fabricate";
    return {
      ok: true,
      query: result.query,
      note: result.chunks.length === 0 ? (result.note ?? emptyNote) : (result.note ?? null),
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
        // What it does.
        "Search the user's knowledge base — their uploaded/ingested documents, internal " +
        "policies (规章制度), and organization-specific content — and return passages with " +
        "their source document title for citation. " +
        // When to use it.
        "Use this FIRST for any question about the user's own or their company/team information " +
        "(e.g. 'our reimbursement limit', '公司年假政策', 'what does our handbook say', anything " +
        "referencing their documents or internal rules). " +
        // When NOT to use it.
        "Do NOT use it for current or public information that is not in their documents (use " +
        "web_search), or for general knowledge you already know. If it returns no relevant " +
        "passages, fall back to web_search for public info or tell the user the knowledge base " +
        "does not cover it.",
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
