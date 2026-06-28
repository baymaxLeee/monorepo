import { generateText, tool } from "ai";
import { z } from "zod";

import { getProvider } from "../clients/admin.js";
import {
  getDocumentSlice,
  getDocumentSource,
  listDocuments,
} from "../clients/knowledge.js";
import { getSettings } from "../config.js";
import { updatePlanInputSchema, updatePlanTool } from "./agent-plan.js";
import {
  beginArtifactTool,
  createArtifactTool,
  publishArtifactTool,
  updateArtifactTool,
  writeArtifactPartTool,
} from "./agent-tool-artifacts.js";
import { imageDataUrl } from "./agent-artifacts.js";
import { createProviderModel } from "./agent-provider.js";
import { createMemoryCandidate } from "./agent-state.js";
import { toolContextSchema, type ToolContext } from "./agent-types.js";

async function listDocumentsTool(_input: {}, { context }: { context: ToolContext }) {
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

async function webSearchTool(
  input: { query: string; max_results: number },
  { abortSignal }: { abortSignal?: AbortSignal },
) {
  const settings = getSettings();
  if (!settings.tavilyApiKey) return { ok: false, error: "TAVILY_API_KEY is not configured" };
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.tavilyApiKey}` },
      body: JSON.stringify({ query: input.query, max_results: input.max_results, search_depth: "advanced", include_answer: false, include_raw_content: false }),
      signal: abortSignal
        ? AbortSignal.any([abortSignal, AbortSignal.timeout(45_000)])
        : AbortSignal.timeout(45_000),
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
    if (abortSignal?.aborted) throw err;
    return { ok: false, error: String(err).slice(0, 500) };
  }
}

async function analyzeImageTool(
  input: { document_id: string; question: string },
  { context, abortSignal }: { context: ToolContext; abortSignal?: AbortSignal },
) {
  if (!context.multimodalProviderId) return { ok: false, error: "no multimodal provider configured for this run" };
  try {
    const provider = await getProvider(context.userId, context.multimodalProviderId);
    const { bytes, mimeType } = await getDocumentSource(context.userId, input.document_id);
    if (!mimeType.toLowerCase().startsWith("image/")) return { ok: false, error: `document ${input.document_id} is not an image (${mimeType})` };
    const result = await generateText({
      model: createProviderModel(provider),
      messages: [{ role: "user", content: [{ type: "text", text: input.question }, { type: "image", image: imageDataUrl(bytes, mimeType) }] }],
      timeout: { totalMs: 3 * 60_000, stepMs: 3 * 60_000 },
      abortSignal,
    });
    return { ok: true, document_id: input.document_id, mime_type: mimeType, analysis: result.text.trim() || "No analysis returned." };
  } catch (err) {
    if (abortSignal?.aborted) throw err;
    return { ok: false, error: String(err).slice(0, 500) };
  }
}

async function proposeMemoryTool(
  input: {
    category: "preference" | "profile" | "project" | "instruction";
    content: string;
    reason: string;
  },
  { context }: { context: ToolContext },
) {
  const candidate = await createMemoryCandidate({
    userId: context.userId,
    category: input.category,
    content: input.content,
    reason: input.reason,
    originRunId: context.runId,
    source: "user-requested",
  });
  const staged = candidate.status === "pending";
  return {
    ok: true,
    staged,
    candidate_id: candidate.id,
    note: staged
      ? "Queued for the user's review in the memory panel; it is not active yet."
      : `An equivalent memory already exists with status=${candidate.status}; no new proposal was created.`,
  };
}

export function buildAgentTools() {
  return {
    update_plan: tool({
      description: "Create or update the durable user-visible plan for a complex multi-step task. Use full snapshots and preserve completed items.",
      inputSchema: updatePlanInputSchema,
      contextSchema: toolContextSchema,
      execute: updatePlanTool,
    }),
    list_documents: tool({
      description: "List knowledge-base documents for this user.",
      inputSchema: z.object({}),
      contextSchema: toolContextSchema,
      execute: listDocumentsTool,
    }),
    read_document: tool({
      description: "Read a bounded slice of a document by document id.",
      inputSchema: z.object({ document_id: z.string(), start: z.number().int().min(0).default(0), max_chars: z.number().int().min(1).max(8000).default(4000) }),
      contextSchema: toolContextSchema,
      execute: readDocumentTool,
    }),
    web_search: tool({
      description: "Search the public web for current information using Tavily.",
      inputSchema: z.object({ query: z.string().min(1), max_results: z.number().int().min(1).max(8).default(5) }),
      contextSchema: toolContextSchema,
      execute: webSearchTool,
    }),
    create_artifact: tool({
      description: "Create a persistent markdown artifact from a compact brief. For HTML use begin_artifact, write_artifact_part, then publish_artifact.",
      inputSchema: z.object({ title: z.string().min(1).max(120), filename: z.string().min(1).max(160), kind: z.literal("markdown").default("markdown"), mode: z.enum(["document", "presentation", "dashboard"]).default("document"), brief: z.string().min(1).max(20_000) }),
      contextSchema: toolContextSchema,
      execute: createArtifactTool,
    }),
    begin_artifact: tool({
      description: "Reserve an HTML artifact and persist its part manifest. Call after update_plan and before writing parts.",
      inputSchema: z.object({
        planId: z.string().min(1).max(128), title: z.string().min(1).max(120), filename: z.string().min(1).max(160),
        mode: z.enum(["document", "presentation", "dashboard"]),
        theme: z.object({ preset: z.string().min(1).max(40), accent: z.string().min(1).max(40) }),
        parts: z.array(z.object({ planItemId: z.string().min(1).max(80), partId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(80), type: z.string().min(1).max(40), title: z.string().min(1).max(160) })).min(1).max(100),
      }),
      contextSchema: toolContextSchema,
      execute: beginArtifactTool,
    }),
    write_artifact_part: tool({
      description: "Persist one semantic HTML body fragment generated by the main agent. No html/head/body/style/script wrappers and no inline JavaScript. Render any chart as a single empty <div data-chart-option=\"{escaped ECharts option JSON}\"></div> — never a canvas or your own echarts script.",
      inputSchema: z.object({ generationId: z.string().min(1).max(32), planItemId: z.string().min(1).max(80), partId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(80), type: z.string().min(1).max(40), title: z.string().min(1).max(160), content: z.string().min(1).max(30_000) }),
      contextSchema: toolContextSchema,
      execute: writeArtifactPartTool,
    }),
    publish_artifact: tool({
      description: "Compile and publish a reserved HTML artifact after all planned parts have been written.",
      inputSchema: z.object({ generationId: z.string().min(1).max(32), title: z.string().min(1).max(120), filename: z.string().min(1).max(160), mode: z.enum(["document", "presentation", "dashboard"]), theme: z.object({ preset: z.string().min(1).max(40), accent: z.string().min(1).max(40) }), parts: z.array(z.object({ id: z.string().min(1).max(80), type: z.string().min(1).max(40), title: z.string().min(1).max(160) })).min(1).max(100) }),
      contextSchema: toolContextSchema,
      execute: publishArtifactTool,
    }),
    update_artifact: tool({
      description: "Update an artifact in place from a compact change brief, with optimistic concurrency protection.",
      inputSchema: z.object({ document_id: z.string().min(1).max(32), title: z.string().min(1).max(120).optional(), filename: z.string().min(1).max(160).optional(), kind: z.enum(["html", "markdown"]).optional(), brief: z.string().min(1).max(12_000) }),
      contextSchema: toolContextSchema,
      execute: updateArtifactTool,
    }),
    analyze_image: tool({
      description: "Analyze an uploaded image document with a multimodal model.",
      inputSchema: z.object({ document_id: z.string(), question: z.string().min(1).max(2000) }),
      contextSchema: toolContextSchema,
      execute: analyzeImageTool,
    }),
    ask_user: tool({
      description: "Ask the user for missing information required to continue.",
      inputSchema: z.object({
        question: z.string().min(1).max(240),
        choices: z.array(z.object({ label: z.string().min(1).max(80), value: z.string().min(1).max(160) })).max(8).default([]),
        mode: z.enum(["single", "multiple"]).default("single"),
        allow_freeform: z.boolean().default(true),
        freeform_label: z.string().min(1).max(40).default("其他"),
      }),
      // No server execute: useChat renders this client tool and posts the
      // answer as tool output, which starts the next ToolLoopAgent request.
    }),
    propose_memory: tool({
      description:
        "Stage a durable user memory for later review. The proposal is queued silently and the user confirms it in their memory panel afterward; it does not block the conversation and is not active immediately. Use only when the user explicitly asks you to remember something stable (a preference, profile fact, project fact, or standing instruction); background extraction handles the rest. Never stage one-off task details or inferred sensitive data.",
      inputSchema: z.object({
        category: z.enum(["preference", "profile", "project", "instruction"]),
        content: z.string().min(5).max(500),
        reason: z.string().min(1).max(200),
      }),
      contextSchema: toolContextSchema,
      execute: proposeMemoryTool,
    }),
  };
}
