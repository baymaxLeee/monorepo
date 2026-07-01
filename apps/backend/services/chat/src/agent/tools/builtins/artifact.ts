import { tool } from "ai";
import { z } from "zod";

import { buildArtifactTextModel, collectText, combinedSignal } from "../../artifacts/generator.js";
import { inspectArtifactHtml, validateArtifactHtml } from "../../artifacts/compiler.js";
import {
  artifactSystemPrompt,
  artifactRevisionPrompt,
  normalizeArtifactContent,
  safeFilename,
  validateArtifactContent,
} from "../../artifacts/template.js";
import { ARTIFACT_GENERATION_TIMEOUT } from "../../artifacts/config.js";
import { getDocument, getDocumentSource, createArtifact, updateArtifact } from "../../../clients/knowledge.js";
import { startTask } from "../../../clients/executor.js";
import { artifactToolContextSchema, type ArtifactToolContext } from "../context.js";
import { streamText } from "ai";

async function inspectArtifact(
  input: { command: "validate_html" | "inspect_layout"; file_id: string },
  { context }: { context: ArtifactToolContext },
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
    if (input.command === "validate_html") {
      const validation = validateArtifactHtml(html);
      return {
        ok: validation.ok,
        command: input.command,
        file_id: input.file_id,
        structural_errors: validation.structural_errors,
        broken_internal_links: validation.broken_internal_links,
      };
    }
    return {
      ok: true,
      command: input.command,
      file_id: input.file_id,
      ...inspectArtifactHtml(html),
    };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 500) };
  }
}

export function createArtifactTools() {
  return {
    write_file: tool({
      description:
        "Generate and persist a new Markdown or HTML file from a compact brief. HTML runs as a durable background task (bounded concurrent block generation, planning, and compilation) and does not block this turn — the result appears as an artifact card once ready. Markdown is generated immediately.",
      inputSchema: z.object({
        title: z.string().min(1).max(120).describe("Human-readable artifact title."),
        filename: z.string().min(1).max(160).describe("Filename including .html or .md extension."),
        kind: z.enum(["html", "markdown"]).describe("Output file format."),
        mode: z
          .enum(["document", "presentation", "dashboard"])
          .default("document")
          .describe("Content intent only. It affects outlining and default page count, never theme, color scheme, or layout."),
        brief: z.string().min(1).max(20_000).describe("Content and visual requirements. Preserve explicit user design requests."),
        page_count: z.number().int().min(1).max(100).optional().describe("Requested number of generated blocks or pages."),
      }),
      contextSchema: artifactToolContextSchema,
      execute: writeFileTool,
    }),
    edit_file: tool({
      description:
        "Edit an existing generated file from a change brief. HTML block content, CSS, theme, layout, and charts may all be revised. HTML edits run as a durable background task and do not block this turn.",
      inputSchema: z.object({
        document_id: z.string().min(1).max(32),
        title: z.string().min(1).max(120).optional(),
        filename: z.string().min(1).max(160).optional(),
        brief: z.string().min(1).max(12_000),
        block_ids: z.array(z.string().regex(/^page-[1-9]\d*$/)).max(100).optional(),
      }),
      contextSchema: artifactToolContextSchema,
      execute: editFileTool,
    }),
    run_command: tool({
      description:
        "Inspect a stored HTML artifact. validate_html is a correctness gate; inspect_layout reports pages, charts, invalid charts, broken links, and failed blocks.",
      inputSchema: z.object({
        command: z.enum(["validate_html", "inspect_layout"]),
        file_id: z.string().min(1).max(32),
      }),
      contextSchema: artifactToolContextSchema,
      execute: inspectArtifact,
    }),
  };
}

export async function writeFileTool(
  input: {
    title: string;
    filename: string;
    kind: "html" | "markdown";
    mode: "document" | "presentation" | "dashboard";
    brief: string;
    page_count?: number;
  },
  { context, toolCallId, abortSignal }: { context: ArtifactToolContext; toolCallId: string; abortSignal?: AbortSignal },
) {
  const filename = safeFilename(input.filename);
  try {
    if (input.kind === "markdown") {
      const tools = await buildArtifactTextModel(context.userId, context.providerId);
      const signal = combinedSignal(abortSignal);
      const result = streamText({
        model: tools.model,
        maxOutputTokens: tools.maxOutputTokens,
        instructions: artifactSystemPrompt("markdown"),
        prompt: input.brief,
        timeout: ARTIFACT_GENERATION_TIMEOUT,
        abortSignal: signal,
      });
      const content = normalizeArtifactContent("markdown", await collectText(result));
      const validation = validateArtifactContent("markdown", content);
      if (!validation.ok) return { ok: false, error: validation.error };
      const document = await createArtifact({
        userId: context.userId,
        conversationId: context.conversationId,
        title: input.title,
        filename,
        content,
        mimeType: "text/markdown",
        idempotencyKey: toolCallId,
      });
      return { ok: true, status: "persisted", document_id: document.id, title: document.title, filename: document.filename, kind: "markdown", total_chars: content.length };
    }

    // HTML: hand off to executor as a durable, non-blocking background task.
    // This tool call returns immediately; ChatArtifactCard then subscribes to
    // the task's progress stream (GET /tasks/:taskId/stream) and renders live
    // progress + the final artifact — no polling.
    const task = await startTask({
      type: "html-artifact",
      ownerRef: toolCallId,
      payload: {
        userId: context.userId,
        conversationId: context.conversationId,
        providerId: context.providerId,
        title: input.title,
        filename,
        mode: input.mode,
        brief: input.brief,
        pageCount: input.page_count,
        idempotencyKey: toolCallId,
      },
    });
    return {
      ok: true,
      status: task.status,
      task_id: task.id,
      title: input.title,
      filename,
      kind: "html",
    };
  } catch (error) {
    if (abortSignal?.aborted) throw error;
    console.error("[chat-agent] write_file failed", { toolCallId, error });
    return { ok: false, error: String(error).slice(0, 500) };
  }
}

export async function editFileTool(
  input: { document_id: string; title?: string; filename?: string; brief: string; block_ids?: string[] },
  { context, toolCallId, abortSignal }: { context: ArtifactToolContext; toolCallId: string; abortSignal?: AbortSignal },
) {
  try {
    const current = await getDocument(context.userId, input.document_id);
    if (current.kind !== "artifact") return { ok: false, error: `file ${input.document_id} is not editable` };
    const isHtml = current.mime_type === "text/html" || current.filename.toLowerCase().endsWith(".html");
    if (!isHtml) {
      const tools = await buildArtifactTextModel(context.userId, context.providerId);
      const signal = combinedSignal(abortSignal);
      const result = streamText({
        model: tools.model,
        maxOutputTokens: tools.maxOutputTokens,
        instructions: artifactSystemPrompt("markdown"),
        prompt: artifactRevisionPrompt("markdown", current.content_md ?? "", input.brief),
        timeout: ARTIFACT_GENERATION_TIMEOUT,
        abortSignal: signal,
      });
      const content = normalizeArtifactContent("markdown", await collectText(result));
      const document = await updateArtifact({
        userId: context.userId,
        documentId: current.id,
        title: input.title,
        filename: input.filename ? safeFilename(input.filename) : undefined,
        content,
        mimeType: "text/markdown",
        expectedUpdatedAt: current.updated_at,
      });
      return { ok: true, status: "persisted", document_id: document.id, title: document.title, filename: document.filename, kind: "markdown", total_chars: content.length };
    }

    const task = await startTask({
      type: "html-artifact",
      ownerRef: toolCallId,
      payload: {
        userId: context.userId,
        conversationId: context.conversationId,
        providerId: context.providerId,
        title: input.title ?? current.title,
        filename: input.filename ? safeFilename(input.filename) : current.filename,
        mode: "document",
        brief: input.brief,
        documentId: current.id,
        blockIds: input.block_ids,
        idempotencyKey: toolCallId,
      },
    });
    return {
      ok: true,
      status: task.status,
      task_id: task.id,
      title: input.title ?? current.title,
      filename: input.filename ? safeFilename(input.filename) : current.filename,
      kind: "html",
    };
  } catch (error) {
    if (abortSignal?.aborted) throw error;
    console.error("[chat-agent] edit_file failed", { toolCallId, documentId: input.document_id, error });
    return { ok: false, error: String(error).slice(0, 500) };
  }
}
