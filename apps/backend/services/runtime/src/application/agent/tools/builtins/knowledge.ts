import { defineAgentTool } from "@repo/agent-runtime/tools/manifest";
import { tool } from "ai";
import { z } from "zod";

import { retrieveKnowledge } from "../../../../infrastructure/clients/knowledge.js";
import { knowledgeSearchToolContextSchema, type KnowledgeSearchToolContext } from "../context.js";

const knowledgeSearchOutputSchema = z.object({
  query: z.string(),
  note: z.string().nullable(),
  untrusted: z.literal(true),
  results: z.array(
    z.object({
      document_id: z.string(),
      title: z.string(),
      filename: z.string(),
      media_type: z.string(),
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
  const result = await retrieveKnowledge(
    context.userId,
    context.tenantId,
    context.workspaceId,
    input.query,
    input.top_k,
    abortSignal,
  );
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
      media_type: chunk.media_type,
      chunk_index: chunk.chunk_index,
      score: chunk.score,
      content: chunk.content,
    })),
  };
}

export function createKnowledgeToolManifests() {
  return [
    defineAgentTool(
      "knowledge_search",
      tool({
        description:
          "Search the team's shared knowledge base for uploaded documents, past incident write-ups, runbooks, internal policies, and workspace-specific facts.",
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
      },
      { summary: "Search uploaded and workspace-private knowledge." },
    ),
  ];
}
