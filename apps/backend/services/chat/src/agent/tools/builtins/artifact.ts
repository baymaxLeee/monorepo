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
import { startTask, getTask, cancelTask, type Task } from "../../../clients/executor.js";
import { NotFoundError } from "../../../lib/errors.js";
import { TransportError } from "@backend/transport-ts";
import { artifactToolContextSchema, type ArtifactToolContext } from "../context.js";
import { streamText } from "ai";

// How often the tool re-reads the durable task snapshot while foreground-
// blocking on a background HTML generation. The user-visible per-block progress
// still streams live over the task's own resumable stream (ArtifactTaskCard);
// this poll is only the authoritative control-flow signal that decides when the
// tool call returns, so a coarse interval is fine.
const TASK_POLL_MS = 1_500;

// A durable executor task survives brief executor unavailability (Nitro dev HMR
// rebuild, a redeploy, a transient 5xx/network blip), so the blocking waiter
// must ride those out and keep polling — the task is still running. Give up only
// after this many *consecutive* poll failures (~30s of continuous
// unavailability), which means executor is genuinely down, not just reloading.
const MAX_CONSECUTIVE_POLL_FAILURES = 20;

// Hard ceiling on how long the tool blocks waiting for a background artifact
// task. Sized for the largest expected workload — a ~100-page HTML deck, and
// later ~30s video generation — with generous headroom. A task still running
// past this is treated as stuck: the waiter cancels it and fails the tool call
// rather than blocking the turn (and the user) indefinitely.
const MAX_TASK_WAIT_MS = 30 * 60_000;

// Distinguishes "waited too long" from an abort or a fatal poll error so the
// tool can surface a clear, user-facing timeout message instead of a generic
// failure.
class TaskWaitTimeoutError extends Error {
  constructor(taskId: string) {
    super(
      `artifact task ${taskId} did not finish within ${Math.round(MAX_TASK_WAIT_MS / 60_000)} minutes`,
    );
    this.name = "TaskWaitTimeoutError";
  }
}

// A missing task (404) is fatal — the row is genuinely gone. Anything else from
// a poll (5xx from Nitro's dev proxy mid-reload, a timeout, a network error) is
// transient: the task keeps running server-side, so retry rather than fail the
// whole turn on a blip.
function isTransientPollError(error: unknown): boolean {
  if (error instanceof NotFoundError) return false;
  if (error instanceof TransportError) return error.status >= 500 || error.status === 429;
  return true;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

// Foreground-block on a dispatched executor task until it reaches a terminal
// state, returning the authoritative durable snapshot. On abort (user Stop) it
// cancels the task and throws AbortError so the run is recorded as cancelled.
// Transient poll failures are tolerated (see isTransientPollError) so a dev
// rebuild or redeploy mid-generation does not fail an otherwise-healthy task.
async function waitForTaskTerminal(taskId: string, signal?: AbortSignal): Promise<Task> {
  const deadline = Date.now() + MAX_TASK_WAIT_MS;
  let consecutiveFailures = 0;
  while (true) {
    if (signal?.aborted) {
      await cancelTask(taskId).catch(() => undefined);
      throw new DOMException("aborted", "AbortError");
    }
    if (Date.now() >= deadline) {
      await cancelTask(taskId).catch(() => undefined);
      throw new TaskWaitTimeoutError(taskId);
    }
    try {
      const task = await getTask(taskId);
      consecutiveFailures = 0;
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
        return task;
      }
    } catch (error) {
      if (!isTransientPollError(error)) throw error;
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) throw error;
      console.warn("[chat-agent] task poll transient failure, retrying", {
        taskId,
        consecutiveFailures,
        error: String(error).slice(0, 200),
      });
    }
    await abortableSleep(TASK_POLL_MS, signal);
  }
}

// Dispatch is idempotent on executor (owner_service+owner_ref == toolCallId),
// so retrying a transiently-failed start just returns the same task — safe to
// ride out a dev rebuild / redeploy blip here too, with a shorter cap since a
// task that never starts should surface quickly.
async function startTaskResilient(
  input: Parameters<typeof startTask>[0],
  signal?: AbortSignal,
): Promise<Task> {
  let attempts = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    try {
      return await startTask(input);
    } catch (error) {
      attempts += 1;
      if (!isTransientPollError(error) || attempts >= 5) throw error;
      console.warn("[chat-agent] task dispatch transient failure, retrying", {
        ownerRef: input.ownerRef,
        attempts,
        error: String(error).slice(0, 200),
      });
      await abortableSleep(TASK_POLL_MS, signal);
    }
  }
}

function taskResultFields(result: unknown): { documentId?: string; totalChars?: number; blocksFailed?: number } {
  if (!result || typeof result !== "object") return {};
  const r = result as Record<string, unknown>;
  return {
    documentId: typeof r.documentId === "string" ? r.documentId : undefined,
    totalChars: typeof r.totalChars === "number" ? r.totalChars : undefined,
    blocksFailed: typeof r.blocksFailed === "number" ? r.blocksFailed : undefined,
  };
}

// The HTML artifact tool blocks this turn until the executor task finishes, but
// it is an async generator so the model still surfaces live progress: the first
// yield exposes task_id (ArtifactTaskCard mounts and subscribes to the task's
// progress stream), and the final yield carries the persisted document_id. AI
// SDK emits every yield as a preliminary tool output and only persists the last
// one, so intermediate progress never pollutes the model's context.
async function* streamHtmlArtifactTask(
  task: Task,
  meta: { title: string; filename: string },
  signal: AbortSignal | undefined,
): AsyncGenerator<Record<string, unknown>> {
  const base = { title: meta.title, filename: meta.filename, kind: "html" as const, task_id: task.id };
  yield { ok: true, status: task.status, ...base };
  let terminal: Task;
  try {
    terminal = await waitForTaskTerminal(task.id, signal);
  } catch (error) {
    // A timeout is a normal terminal outcome for the card (task already
    // cancelled); anything else (abort, fatal poll error) propagates so the run
    // is recorded correctly.
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

export function createArtifactTools() {
  return {
    write_file: tool({
      description:
        "Generate and persist a new Markdown or HTML file from a compact brief. HTML runs as a durable task (planning, bounded concurrent block generation, compilation) and this call blocks until it finishes, streaming live progress into an artifact card and returning the persisted document_id. Do not call write_file/edit_file again for the same artifact while it is running. Markdown is generated inline.",
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
        "Edit an existing generated file from a change brief. HTML block content, CSS, theme, layout, and charts may all be revised. HTML edits run as a durable task and this call blocks until it finishes, streaming live progress and returning the updated document_id. Do not dispatch another edit for the same artifact while one is running.",
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

export async function* writeFileTool(
  input: {
    title: string;
    filename: string;
    kind: "html" | "markdown";
    mode: "document" | "presentation" | "dashboard";
    brief: string;
    page_count?: number;
  },
  { context, toolCallId, abortSignal }: { context: ArtifactToolContext; toolCallId: string; abortSignal?: AbortSignal },
): AsyncGenerator<Record<string, unknown>> {
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
      if (!validation.ok) {
        yield { ok: false, error: validation.error };
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
      yield { ok: true, status: "persisted", document_id: document.id, title: document.title, filename: document.filename, kind: "markdown", total_chars: content.length };
      return;
    }

    // HTML: dispatch a durable executor task and foreground-block on it. The
    // first yield exposes task_id so ArtifactTaskCard mounts and streams live
    // per-block progress; the final yield carries the persisted document_id.
    // Blocking here is deliberate — the model must not race ahead and issue a
    // second edit for an artifact that is still being written (ADR-0015).
    const task = await startTaskResilient(
      {
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
      },
      abortSignal,
    );
    yield* streamHtmlArtifactTask(task, { title: input.title, filename }, abortSignal);
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    console.error("[chat-agent] write_file failed", { toolCallId, error });
    yield { ok: false, error: String(error).slice(0, 500) };
  }
}

export async function* editFileTool(
  input: { document_id: string; title?: string; filename?: string; brief: string; block_ids?: string[] },
  { context, toolCallId, abortSignal }: { context: ArtifactToolContext; toolCallId: string; abortSignal?: AbortSignal },
): AsyncGenerator<Record<string, unknown>> {
  try {
    const current = await getDocument(context.userId, input.document_id);
    if (current.kind !== "artifact") {
      yield { ok: false, error: `file ${input.document_id} is not editable` };
      return;
    }
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
      yield { ok: true, status: "persisted", document_id: document.id, title: document.title, filename: document.filename, kind: "markdown", total_chars: content.length };
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
          providerId: context.providerId,
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
    yield* streamHtmlArtifactTask(task, { title, filename }, abortSignal);
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    console.error("[chat-agent] edit_file failed", { toolCallId, documentId: input.document_id, error });
    yield { ok: false, error: String(error).slice(0, 500) };
  }
}
