import { z } from "zod";

import { askUserHook } from "./agent-hooks.js";
import { createArtifactTool, updateArtifactTool } from "./agent-tool-artifacts.js";
import { imageDataUrl } from "./agent-artifacts.js";
import { createProviderModel } from "./agent-provider.js";
import { toolContextSchema, type ToolContext } from "./agent-types.js";

async function listDocumentsTool(_input: {}, { context }: { context: ToolContext }) {
  "use step";
  const { listDocuments } = await import("../clients/knowledge.js");
  const rows = await listDocuments(context.userId, context.conversationId);
  return {
    ok: true,
    documents: rows.map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      filename: row.filename,
      mime_type: row.mime_type,
      ingest_status: row.ingest_status,
    })),
  };
}

async function readDocumentTool(
  input: { document_id: string; start: number; max_chars: number },
  { context }: { context: ToolContext },
) {
  "use step";
  const { getDocumentSlice } = await import("../clients/knowledge.js");
  try {
    const slice = await getDocumentSlice(context.userId, input.document_id, input.start, input.max_chars);
    return {
      ok: true,
      document_id: slice.id,
      title: slice.title,
      filename: slice.filename,
      mime_type: slice.mime_type,
      start: slice.start,
      total_chars: slice.total_chars,
      next_start: slice.next_start,
      content: slice.content,
      untrusted: true,
    };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 500) };
  }
}

async function webSearchTool(input: { query: string; max_results: number }) {
  "use step";
  const { getSettings } = await import("../config.js");
  const settings = getSettings();
  if (!settings.tavilyApiKey) return { ok: false, error: "TAVILY_API_KEY is not configured" };
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.tavilyApiKey}` },
      body: JSON.stringify({ query: input.query, max_results: input.max_results, search_depth: "advanced", include_answer: false, include_raw_content: false }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return { ok: false, error: `Tavily HTTP ${response.status}: ${(await response.text()).slice(0, 500)}` };
    const data = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string; published_date?: string | null; score?: number }>;
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
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 500) };
  }
}

async function analyzeImageTool(
  input: { document_id: string; question: string },
  { context }: { context: ToolContext },
) {
  "use step";
  if (!context.multimodalProviderId) return { ok: false, error: "no multimodal provider configured for this run" };
  const [{ getProvider }, { getDocumentSource }, { generateText }] = await Promise.all([
    import("../clients/admin.js"),
    import("../clients/knowledge.js"),
    import("ai"),
  ]);
  try {
    const provider = await getProvider(context.userId, context.multimodalProviderId);
    const { bytes, mimeType } = await getDocumentSource(context.userId, input.document_id);
    if (!mimeType.toLowerCase().startsWith("image/")) return { ok: false, error: `document ${input.document_id} is not an image (${mimeType})` };
    const result = await generateText({
      model: createProviderModel(provider),
      messages: [{ role: "user", content: [{ type: "text", text: input.question }, { type: "image", image: imageDataUrl(bytes, mimeType) }] }],
      timeout: { totalMs: 3 * 60_000, stepMs: 3 * 60_000 },
    });
    return { ok: true, document_id: input.document_id, mime_type: mimeType, analysis: result.text.trim() || "No analysis returned." };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 500) };
  }
}

async function askUserTool(
  _input: { question: string; choices: Array<{ label: string; value: string }>; mode: "single" | "multiple"; allow_freeform: boolean; freeform_label: string },
  { toolCallId }: { toolCallId: string },
) {
  const answer = await askUserHook.create({ token: toolCallId });
  return { ok: true, ...answer };
}

export function buildWorkflowTools() {
  return {
    list_documents: { description: "List knowledge-base documents for this user.", inputSchema: z.object({}), contextSchema: toolContextSchema, execute: listDocumentsTool },
    read_document: {
      description: "Read a bounded slice of a document by document id.",
      inputSchema: z.object({ document_id: z.string(), start: z.number().int().min(0).default(0), max_chars: z.number().int().min(1).max(8000).default(4000) }),
      contextSchema: toolContextSchema,
      execute: readDocumentTool,
    },
    web_search: {
      description: "Search the public web for current information using Tavily.",
      inputSchema: z.object({ query: z.string().min(1), max_results: z.number().int().min(1).max(8).default(5) }),
      contextSchema: toolContextSchema,
      execute: webSearchTool,
    },
    create_artifact: {
      description: "Create a persistent markdown or html artifact from a compact brief.",
      inputSchema: z.object({ title: z.string().min(1).max(120), filename: z.string().min(1).max(160), kind: z.enum(["html", "markdown"]).default("markdown"), brief: z.string().min(1).max(12_000) }),
      contextSchema: toolContextSchema,
      execute: createArtifactTool,
    },
    update_artifact: {
      description: "Update an artifact in place from a compact change brief, with optimistic concurrency protection.",
      inputSchema: z.object({ document_id: z.string().min(1).max(32), title: z.string().min(1).max(120).optional(), filename: z.string().min(1).max(160).optional(), kind: z.enum(["html", "markdown"]).optional(), brief: z.string().min(1).max(12_000) }),
      contextSchema: toolContextSchema,
      execute: updateArtifactTool,
    },
    analyze_image: {
      description: "Analyze an uploaded image document with a multimodal model.",
      inputSchema: z.object({ document_id: z.string(), question: z.string().min(1).max(2000) }),
      contextSchema: toolContextSchema,
      execute: analyzeImageTool,
    },
    ask_user: {
      description: "Ask the user for missing information required to continue.",
      inputSchema: z.object({
        question: z.string().min(1).max(240),
        choices: z.array(z.object({ label: z.string().min(1).max(80), value: z.string().min(1).max(160) })).max(8).default([]),
        mode: z.enum(["single", "multiple"]).default("single"),
        allow_freeform: z.boolean().default(true),
        freeform_label: z.string().min(1).max(40).default("其他"),
      }),
      execute: askUserTool,
    },
  };
}
