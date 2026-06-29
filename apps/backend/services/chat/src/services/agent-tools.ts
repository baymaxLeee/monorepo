import { tool } from "ai";
import { z } from "zod";

import {
  getDocument,
  getDocumentSlice,
  getDocumentSource,
  listDocuments,
} from "../clients/knowledge.js";
import { getSettings } from "../config.js";
import { editFileTool, writeFileTool } from "./agent-tool-artifacts.js";
import {
  updatePlanInputSchema,
  updatePlanTool,
  writePlanInputSchema,
  writePlanTool,
} from "./agent-plan.js";
import {
  createMemoryCandidate,
  listActiveMemories,
} from "./agent-state.js";
import { toolContextSchema, type ToolContext } from "./agent-types.js";

async function listFilesTool(_input: {}, { context }: { context: ToolContext }) {
  try {
    const rows = await listDocuments(context.userId, context.conversationId);
    return {
      ok: true,
      files: rows.map((row) => ({
        id: row.id,
        title: row.title,
        filename: row.filename,
        kind: row.kind,
        mime_type: row.mime_type,
        size: row.source_size,
        status: row.ingest_status,
        updated_at: row.updated_at,
      })),
    };
  } catch (error) {
    return { ok: false, error: `failed to list files: ${String(error).slice(0, 500)}` };
  }
}

async function readFileTool(
  input: { file_id: string; offset: number; max_chars: number },
  { context }: { context: ToolContext },
) {
  try {
    const document = await getDocument(context.userId, input.file_id);
    if (document.conversation_id !== context.conversationId) {
      return { ok: false, error: `file ${input.file_id} is not attached to this conversation` };
    }
    let content: string;
    if (document.content_md) {
      const slice = await getDocumentSlice(
        context.userId,
        input.file_id,
        input.offset,
        input.max_chars,
      );
      content = slice.content;
      return {
        ok: true,
        file_id: document.id,
        title: document.title,
        filename: document.filename,
        mime_type: document.mime_type,
        offset: slice.start,
        total_chars: slice.total_chars,
        next_offset: slice.next_start,
        content,
        untrusted: document.kind === "source",
      };
    }
    const source = await getDocumentSource(context.userId, input.file_id);
    const text = new TextDecoder().decode(source.bytes);
    content = text.slice(input.offset, input.offset + input.max_chars);
    const next = input.offset + content.length;
    return {
      ok: true,
      file_id: document.id,
      title: document.title,
      filename: document.filename,
      mime_type: source.mimeType,
      offset: input.offset,
      total_chars: text.length,
      next_offset: next < text.length ? next : null,
      content,
      untrusted: document.kind === "source",
    };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 500) };
  }
}

async function runCommandTool(
  input: { command: "validate_html" | "inspect_layout"; file_id: string },
  { context }: { context: ToolContext },
) {
  try {
    const document = await getDocument(context.userId, input.file_id);
    if (document.conversation_id !== context.conversationId) {
      return { ok: false, error: `file ${input.file_id} is not attached to this conversation` };
    }
    const source = await getDocumentSource(context.userId, input.file_id);
    if (source.mimeType !== "text/html") {
      return { ok: false, error: `${input.command} only supports HTML files` };
    }
    const html = new TextDecoder().decode(source.bytes);
    const pages = (html.match(/\bclass="[^"]*artifact-block\b/g) ?? []).length;
    const charts = (html.match(/\bdata-chart-option=/g) ?? []).length;
    const internalLinks = [...html.matchAll(/href=["']#([^"']+)["']/g)].map((match) => match[1]);
    const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
    const brokenLinks = internalLinks.filter((target) => !ids.has(target));
    const structuralErrors = [
      !/^\s*<!doctype html>/i.test(html) ? "missing doctype" : null,
      !/<\/html>\s*$/i.test(html) ? "missing closing html tag" : null,
      /\son[a-z]+\s*=/i.test(html) ? "inline event handler detected" : null,
      /javascript\s*:/i.test(html) ? "javascript URL detected" : null,
    ].filter((value): value is string => value != null);
    return {
      ok: structuralErrors.length === 0 && brokenLinks.length === 0,
      command: input.command,
      file_id: input.file_id,
      pages,
      charts,
      internal_links: internalLinks.length,
      broken_internal_links: brokenLinks,
      structural_errors: structuralErrors,
      total_chars: html.length,
    };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 500) };
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
      signal: abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
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
  } catch (error) {
    if (abortSignal?.aborted) throw error;
    return { ok: false, error: String(error).slice(0, 500) };
  }
}

type MemoryInput = {
  category: "preference" | "profile" | "project" | "instruction";
  content: string;
  reason: string;
};

async function createMemoryTool(input: MemoryInput, { context }: { context: ToolContext }) {
  try {
    const candidate = await createMemoryCandidate({
      userId: context.userId,
      category: input.category,
      content: input.content,
      reason: input.reason,
      originRunId: context.runId,
      source: "user-requested",
    });
    return { ok: true, staged: candidate.status === "pending", candidate_id: candidate.id, status: candidate.status };
  } catch (error) {
    return { ok: false, error: `failed to create memory proposal: ${String(error).slice(0, 500)}` };
  }
}

async function updateMemoryTool(
  input: MemoryInput & { memory_id: string },
  { context }: { context: ToolContext },
) {
  try {
    const active = (await listActiveMemories(context.userId)).find((memory) => memory.id === input.memory_id);
    if (!active) return { ok: false, error: `active memory ${input.memory_id} was not found` };
    const candidate = await createMemoryCandidate({
      userId: context.userId,
      category: input.category,
      content: input.content,
      reason: input.reason,
      originRunId: context.runId,
      source: "user-requested-update",
      supersedesId: active.id,
    });
    return { ok: true, staged: candidate.status === "pending", candidate_id: candidate.id, supersedes_id: active.id, status: candidate.status };
  } catch (error) {
    return { ok: false, error: `failed to update memory proposal: ${String(error).slice(0, 500)}` };
  }
}

const memorySchema = z.object({
  category: z.enum(["preference", "profile", "project", "instruction"]),
  content: z.string().min(5).max(500),
  reason: z.string().min(1).max(200),
});

export function buildAgentTools() {
  return {
    list_files: tool({
      description: "List files attached to the current conversation, including generated artifacts.",
      inputSchema: z.object({}),
      contextSchema: toolContextSchema,
      execute: listFilesTool,
    }),
    read_file: tool({
      description: "Read a bounded slice of a conversation file. Continue with next_offset for large files.",
      inputSchema: z.object({ file_id: z.string().min(1).max(32), offset: z.number().int().min(0).default(0), max_chars: z.number().int().min(1).max(20_000).default(8_000) }),
      contextSchema: toolContextSchema,
      execute: readFileTool,
    }),
    write_file: tool({
      description: "Generate and persist a new Markdown or HTML file from a compact brief. HTML is planned and generated in bounded concurrent blocks inside this tool, so use it for artifacts of any supported size instead of emitting HTML yourself.",
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        filename: z.string().min(1).max(160),
        kind: z.enum(["html", "markdown"]),
        mode: z.enum(["document", "presentation", "dashboard"]).default("document"),
        brief: z.string().min(1).max(20_000),
        page_count: z.number().int().min(1).max(100).optional(),
      }),
      contextSchema: toolContextSchema,
      execute: writeFileTool,
    }),
    edit_file: tool({
      description: "Edit an existing generated file from a change brief. Large HTML is revised by semantic blocks with optimistic immutable revisions; unchanged blocks are reused.",
      inputSchema: z.object({ document_id: z.string().min(1).max(32), title: z.string().min(1).max(120).optional(), filename: z.string().min(1).max(160).optional(), brief: z.string().min(1).max(12_000), block_ids: z.array(z.string().regex(/^page-[1-9]\d*$/)).max(100).optional() }),
      contextSchema: toolContextSchema,
      execute: editFileTool,
    }),
    run_command: tool({
      description: "Run a safe built-in inspection command against a stored HTML file. This is not host shell access.",
      inputSchema: z.object({ command: z.enum(["validate_html", "inspect_layout"]), file_id: z.string().min(1).max(32) }),
      contextSchema: toolContextSchema,
      execute: runCommandTool,
    }),
    web_search: tool({
      description: "Search the public web for current information using Tavily.",
      inputSchema: z.object({ query: z.string().min(1), max_results: z.number().int().min(1).max(8).default(5) }),
      execute: webSearchTool,
    }),
    ask_user: tool({
      description: "Ask the user for missing information that is required to continue.",
      inputSchema: z.object({
        question: z.string().min(1).max(240),
        choices: z.array(z.object({ label: z.string().min(1).max(80), value: z.string().min(1).max(160) })).max(8).default([]),
        mode: z.enum(["single", "multiple"]).default("single"),
        allow_freeform: z.boolean().default(true),
        freeform_label: z.string().min(1).max(40).default("其他"),
      }),
    }),
    write_plan: tool({
      description: "Create a new durable user-visible plan for a complex task. Do not use this to revise an existing plan.",
      inputSchema: writePlanInputSchema,
      contextSchema: toolContextSchema,
      execute: writePlanTool,
    }),
    update_plan: tool({
      description: "Update an existing durable plan using its planId and baseRevision. A conflict is returned as tool output and never aborts the chat stream.",
      inputSchema: updatePlanInputSchema,
      contextSchema: toolContextSchema,
      execute: updatePlanTool,
    }),
    create_memory: tool({
      description: "Stage a new long-term memory for non-blocking user review. It is not active until the user approves it in the memory panel.",
      inputSchema: memorySchema,
      contextSchema: toolContextSchema,
      execute: createMemoryTool,
    }),
    update_memory: tool({
      description: "Stage a replacement for an active memory. The old memory remains active until the user approves the candidate.",
      inputSchema: memorySchema.extend({ memory_id: z.string().min(1).max(32) }),
      contextSchema: toolContextSchema,
      execute: updateMemoryTool,
    }),
  };
}
