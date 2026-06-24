import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, tool } from "ai";
import { z } from "zod";

import type { ProviderSnapshot } from "../clients/admin.js";
import {
  createArtifact,
  getDocumentSlice,
  getDocumentSource,
  listDocuments,
  type KnowledgeDocument,
} from "../clients/knowledge.js";
import { getSettings } from "../config.js";
import type { AuthContext } from "../middleware/auth.js";

interface ArtifactBuilder {
  title: string;
  filename: string;
  parts: string[];
  length: number;
}

export interface AgentToolContext {
  auth: AuthContext;
  conversationId: string;
  placeholderMap: Map<string, string>;
  createdDocuments: KnowledgeDocument[];
  placeholderCounter: number;
  multimodalProvider?: ProviderSnapshot | null;
  artifactBuilders: Map<string, ArtifactBuilder>;
  artifactTotalChars: number;
}

function nextPlaceholder(ctx: AgentToolContext, documentId: string): string {
  ctx.placeholderCounter += 1;
  const placeholder = `⟦artifact:${ctx.placeholderCounter}⟧`;
  ctx.placeholderMap.set(placeholder, documentId);
  return placeholder;
}

export function buildAgentTools(ctx: AgentToolContext) {
  const settings = getSettings();

  return {
    list_documents: tool({
      description: "List knowledge-base documents for this user (optionally filtered by conversation tag).",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await listDocuments(ctx.auth.userId, ctx.conversationId);
        if (!rows.length) return "No documents.";
        return rows
          .map((r) => `- ${r.id}: ${r.title} (${r.kind}, ${r.filename}, ${r.mime_type})`)
          .join("\n");
      },
    }),

    read_document: tool({
      description: "Read a slice of a document's markdown/html content by artifact id.",
      inputSchema: z.object({
        document_id: z.string(),
        start: z.number().int().min(0).default(0),
        max_chars: z.number().int().min(1).max(8000).default(4000),
      }),
      execute: async ({ document_id, start, max_chars }) => {
        try {
          const slice = await getDocumentSlice(ctx.auth.userId, document_id, start, max_chars);
          let out = slice.content;
          if (slice.next_start != null) {
            out += `\n\n[truncated; next start=${slice.next_start}; total chars=${slice.total_chars}]`;
          }
          return out;
        } catch (err) {
          return `Tool error in read_document: ${String(err)}`;
        }
      },
    }),

    analyze_image: tool({
      description:
        "Analyze an uploaded image document with a multimodal model and answer a question about it. Use for charts, screenshots, photos, or scanned pages when the markdown preview is insufficient.",
      inputSchema: z.object({
        document_id: z.string(),
        question: z.string().min(1).max(2000),
      }),
      execute: async ({ document_id, question }) => {
        const provider = ctx.multimodalProvider;
        if (!provider) {
          return "Tool unavailable: no multimodal provider configured for this run. Ask the user to select a multimodal model, or rely on the document's markdown preview via read_document.";
        }
        try {
          const { bytes, mimeType } = await getDocumentSource(ctx.auth.userId, document_id);
          if (!mimeType.toLowerCase().startsWith("image/")) {
            return `Tool error in analyze_image: document ${document_id} is not an image (${mimeType}). Use read_document instead.`;
          }
          const vision = createOpenAICompatible({
            name: provider.name,
            baseURL: provider.baseUrl,
            apiKey: provider.apiKey,
          });
          const result = await generateText({
            model: vision(provider.model),
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: question },
                  { type: "image", image: bytes, mediaType: mimeType },
                ],
              },
            ],
            maxOutputTokens: settings.llmMaxOutputTokens,
          });
          return result.text.trim() || "No analysis returned by the multimodal model.";
        } catch (err) {
          return `Tool error in analyze_image: ${String(err)}`;
        }
      },
    }),

    create_artifact: tool({
      description:
        "Create a persistent markdown or html artifact in the knowledge base in a single call. Returns a placeholder token to cite in the final answer. For content larger than the per-call limit, use append_artifact_chunk instead.",
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        filename: z.string().min(1).max(160),
        content: z.string().min(1).max(settings.agentArtifactMaxChars),
      }),
      execute: async ({ title, filename, content }) => {
        if (ctx.artifactTotalChars + content.length > settings.agentArtifactTotalMaxChars) {
          return `Tool error in create_artifact: total artifact budget (${settings.agentArtifactTotalMaxChars} chars) exceeded for this run.`;
        }
        const doc = await createArtifact({
          userId: ctx.auth.userId,
          conversationId: ctx.conversationId,
          title,
          filename,
          content,
        });
        ctx.createdDocuments.push(doc);
        ctx.artifactTotalChars += content.length;
        const placeholder = nextPlaceholder(ctx, doc.id);
        return `Created artifact ${doc.id}. Cite it in your answer using exactly this placeholder: ${placeholder}`;
      },
    }),

    append_artifact_chunk: tool({
      description:
        "Build a large artifact incrementally across multiple calls. Call repeatedly with the same filename to append content, then call once with done=true to persist. Returns a placeholder token only on the final (done) call.",
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        filename: z.string().min(1).max(160),
        content: z.string().max(settings.agentArtifactMaxChars),
        done: z.boolean().default(false),
      }),
      execute: async ({ title, filename, content, done }) => {
        let builder = ctx.artifactBuilders.get(filename);
        if (!builder) {
          builder = { title, filename, parts: [], length: 0 };
          ctx.artifactBuilders.set(filename, builder);
        }
        builder.title = title;
        if (content) {
          if (
            builder.length + content.length > settings.agentArtifactMaxChars ||
            ctx.artifactTotalChars + builder.length + content.length > settings.agentArtifactTotalMaxChars
          ) {
            ctx.artifactBuilders.delete(filename);
            return `Tool error in append_artifact_chunk: artifact "${filename}" exceeds size budget; persist smaller chunks.`;
          }
          builder.parts.push(content);
          builder.length += content.length;
        }
        if (!done) {
          return `Appended ${content.length} chars to "${filename}" (total ${builder.length}). Call again with more content, or with done=true to persist.`;
        }
        ctx.artifactBuilders.delete(filename);
        const merged = builder.parts.join("");
        if (!merged.trim()) {
          return `Tool error in append_artifact_chunk: no content accumulated for "${filename}".`;
        }
        const doc = await createArtifact({
          userId: ctx.auth.userId,
          conversationId: ctx.conversationId,
          title: builder.title,
          filename,
          content: merged,
        });
        ctx.createdDocuments.push(doc);
        ctx.artifactTotalChars += merged.length;
        const placeholder = nextPlaceholder(ctx, doc.id);
        return `Persisted artifact ${doc.id} (${merged.length} chars). Cite it using exactly this placeholder: ${placeholder}`;
      },
    }),

    web_search: tool({
      description: "Search the public web once per run for current information.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      execute: async ({ query }) => {
        try {
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const res = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; ChatAgent/1.0)",
              Accept: "text/html",
            },
          });
          if (!res.ok) return `Tool error in web_search: HTTP ${res.status}`;
          const html = await res.text();
          const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"/gi)].slice(0, 5);
          if (!links.length) return "No web results.";
          return links.map((m, i) => `${i + 1}. ${m[1]}`).join("\n");
        } catch (err) {
          return `Tool error in web_search: ${String(err)}`;
        }
      },
    }),
  };
}

export function applyPlaceholderReplacements(
  text: string,
  placeholderMap: Map<string, string>,
  created: KnowledgeDocument[],
): string {
  let out = text;
  for (const [placeholder, id] of placeholderMap) {
    out = out.split(placeholder).join(`[${id}]`);
  }
  const missing = [...placeholderMap.values()].filter((id) => !out.includes(`[${id}]`));
  if (missing.length === 1) {
    out = `${out.trim()}\n\n[${missing[0]}]`.trim();
  } else if (missing.length > 1) {
    out = `${out.trim()}\n\n${missing.map((id) => `[${id}]`).join(" ")}`.trim();
  }
  if (!out.trim() && created.length === 1) {
    return `已生成文档: ${created[0]!.title}\n\n[${created[0]!.id}]`;
  }
  return out.trim() || "已完成。";
}

export function extractSlotIds(text: string): string[] {
  const re = /\[([a-f0-9]{16})\]/gi;
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ids.add(m[1]!);
  return [...ids];
}
