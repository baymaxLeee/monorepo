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
import { type Task } from "../../../clients/executor.js";
import type { ChatProvider } from "@backend/transport-ts/provider-model";
import { artifactToolContextSchema, type ArtifactToolContext } from "../context.js";
import {
  MAX_TASK_WAIT_MS,
  startTaskResilient,
  TaskWaitTimeoutError,
  waitForTaskTerminal,
} from "../task-runner.js";
import { streamText } from "ai";

function taskResultFields(result: unknown): { documentId?: string; totalChars?: number; blocksFailed?: number } {
  if (!result || typeof result !== "object") return {};
  const r = result as Record<string, unknown>;
  return {
    documentId: typeof r.documentId === "string" ? r.documentId : undefined,
    totalChars: typeof r.totalChars === "number" ? r.totalChars : undefined,
    blocksFailed: typeof r.blocksFailed === "number" ? r.blocksFailed : undefined,
  };
}

async function* streamHtmlArtifactTask(
  task: Task,
  meta: { title: string; filename: string; todoId?: string },
  signal: AbortSignal | undefined,
): AsyncGenerator<Record<string, unknown>> {
  const base = {
    title: meta.title,
    filename: meta.filename,
    kind: "html" as const,
    task_id: task.id,
    todo_id: meta.todoId,
  };
  yield { ok: true, status: task.status, ...base };
  let terminal: Task;
  try {
    terminal = await waitForTaskTerminal(task.id, signal);
  } catch (error) {
    if (error instanceof TaskWaitTimeoutError) {
      yield {
        ok: false,
        status: "failed",
        error: `生成超时：超过 ${Math.round(MAX_TASK_WAIT_MS / 60_000)} 分钟未完成，已取消任务。`,
        ...base,
      };
      return;
    }
    throw error;
  }
  if (terminal.status === "completed") {
    const { documentId, totalChars, blocksFailed } = taskResultFields(terminal.result);
    yield {
      ok: true,
      status: "completed",
      document_id: documentId,
      total_chars: totalChars,
      blocks_failed: blocksFailed,
      ...base,
    };
    return;
  }
  yield {
    ok: false,
    status: terminal.status,
    error: terminal.error ?? (terminal.status === "cancelled" ? "已取消" : "生成失败"),
    ...base,
  };
}

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

export function createArtifactTools(textProvider: ChatProvider) {
  return {
    write_file: tool({
      description:
        "Generate and persist a new Markdown or HTML file from a compact brief. HTML runs as a durable task (planning, bounded concurrent block generation, compilation) and this call blocks until it finishes, streaming live progress into an artifact card and returning the persisted document_id. Do not call write_file/edit_file again for the same artifact while it is running. Markdown is generated inline. All HTML charts render via ECharts (CDN, injected automatically by the compiler); never name Chart.js or any other charting library in the brief.",
      inputSchema: z.object({
        title: z.string().min(1).max(120).describe("Human-readable artifact title."),
        filename: z.string().min(1).max(160).describe("Filename including .html or .md extension."),
        kind: z.enum(["html", "markdown"]).describe("Output file format."),
        mode: z
          .enum(["document", "presentation", "dashboard"])
          .default("document")
          .describe("Content intent only. It affects outlining and default page count, never theme, color scheme, or layout."),
        brief: z
          .string()
          .min(1)
          .max(20_000)
          .describe(
            "Content and visual requirements. Preserve explicit user design requests. Describe chart type/data only — never name a charting library; all charts render via ECharts.",
          ),
        page_count: z.number().int().min(1).max(100).optional().describe("Requested number of generated blocks or pages."),
        todo_id: z
          .string()
          .max(64)
          .optional()
          .describe(
            "Optional id of the todo item this file fulfills. Set it when executing a plan/todo list so the UI flips that todo to done the moment this task finishes; omit for ad-hoc calls.",
          ),
      }),
      contextSchema: artifactToolContextSchema,
      execute: (input, options) => writeFileTool(input, options, textProvider),
    }),
    edit_file: tool({
      description:
        "Edit an existing generated file from a change brief. HTML block content, CSS, theme, layout, and charts may all be revised. HTML edits run as a durable task and this call blocks until it finishes, streaming live progress and returning the updated document_id. Do not dispatch another edit for the same artifact while one is running. All HTML charts render via ECharts (CDN, injected automatically by the compiler); never name Chart.js or any other charting library in the brief.",
      inputSchema: z.object({
        document_id: z.string().min(1).max(32),
        title: z.string().min(1).max(120).optional(),
        filename: z.string().min(1).max(160).optional(),
        brief: z
          .string()
          .min(1)
          .max(12_000)
          .describe("Describe chart type/data only — never name a charting library; all charts render via ECharts."),
        block_ids: z.array(z.string().regex(/^page-[1-9]\d*$/)).max(100).optional(),
        todo_id: z
          .string()
          .max(64)
          .optional()
          .describe(
            "Optional id of the todo item this edit fulfills. Set it when executing a plan/todo list so the UI flips that todo to done the moment this task finishes; omit for ad-hoc calls.",
          ),
      }),
      contextSchema: artifactToolContextSchema,
      execute: (input, options) => editFileTool(input, options, textProvider),
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

export async function* writeFileTool(
  input: {
    title: string;
    filename: string;
    kind: "html" | "markdown";
    mode: "document" | "presentation" | "dashboard";
    brief: string;
    page_count?: number;
    todo_id?: string;
  },
  { context, toolCallId, abortSignal }: { context: ArtifactToolContext; toolCallId: string; abortSignal?: AbortSignal },
  textProvider: ChatProvider,
): AsyncGenerator<Record<string, unknown>> {
  const filename = safeFilename(input.filename);
  const todoId = input.todo_id;
  try {
    if (input.kind === "markdown") {
      const tools = buildArtifactTextModel(textProvider);
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
      if (!validation.ok) {
        yield { ok: false, error: validation.error, todo_id: todoId };
        return;
      }
      const document = await createArtifact({
        userId: context.userId,
        conversationId: context.conversationId,
        title: input.title,
        filename,
        content,
        mimeType: "text/markdown",
        idempotencyKey: toolCallId,
      });
      yield { ok: true, status: "persisted", document_id: document.id, title: document.title, filename: document.filename, kind: "markdown", total_chars: content.length, todo_id: todoId };
      return;
    }

    const task = await startTaskResilient(
      {
        type: "html-artifact",
        ownerRef: toolCallId,
        payload: {
          userId: context.userId,
          conversationId: context.conversationId,
          providerId: textProvider.id,
          title: input.title,
          filename,
          mode: input.mode,
          brief: input.brief,
          pageCount: input.page_count,
          idempotencyKey: toolCallId,
        },
      },
      abortSignal,
    );
    yield* streamHtmlArtifactTask(task, { title: input.title, filename, todoId }, abortSignal);
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    console.error("[chat-agent] write_file failed", { toolCallId, error });
    yield { ok: false, error: String(error).slice(0, 500), todo_id: todoId };
  }
}

export async function* editFileTool(
  input: { document_id: string; title?: string; filename?: string; brief: string; block_ids?: string[]; todo_id?: string },
  { context, toolCallId, abortSignal }: { context: ArtifactToolContext; toolCallId: string; abortSignal?: AbortSignal },
  textProvider: ChatProvider,
): AsyncGenerator<Record<string, unknown>> {
  const todoId = input.todo_id;
  try {
    const current = await getDocument(context.userId, input.document_id);
    if (current.kind !== "artifact") {
      yield { ok: false, error: `file ${input.document_id} is not editable`, todo_id: todoId };
      return;
    }
    const isHtml = current.mime_type === "text/html" || current.filename.toLowerCase().endsWith(".html");
    if (!isHtml) {
      const tools = buildArtifactTextModel(textProvider);
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
      yield { ok: true, status: "persisted", document_id: document.id, title: document.title, filename: document.filename, kind: "markdown", total_chars: content.length, todo_id: todoId };
      return;
    }

    const filename = input.filename ? safeFilename(input.filename) : current.filename;
    const title = input.title ?? current.title;
    const task = await startTaskResilient(
      {
        type: "html-artifact",
        ownerRef: toolCallId,
        payload: {
          userId: context.userId,
          conversationId: context.conversationId,
          providerId: textProvider.id,
          title,
          filename,
          mode: "document",
          brief: input.brief,
          documentId: current.id,
          blockIds: input.block_ids,
          idempotencyKey: toolCallId,
        },
      },
      abortSignal,
    );
    yield* streamHtmlArtifactTask(task, { title, filename, todoId }, abortSignal);
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    console.error("[chat-agent] edit_file failed", { toolCallId, documentId: input.document_id, error });
    yield { ok: false, error: String(error).slice(0, 500), todo_id: todoId };
  }
}
