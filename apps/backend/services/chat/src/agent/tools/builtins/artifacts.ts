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
import {
  getDocument,
  getDocumentSource,
  getLatestArtifactWorkspace,
  createArtifact,
  updateArtifact,
} from "../../../clients/knowledge.js";
import { type Task } from "../../../clients/executor.js";
import type { ChatProvider } from "@backend/transport-ts/provider-model";
import { artifactToolContextSchema, type ArtifactToolContext } from "../context.js";
import {
  MAX_TASK_WAIT_MS,
  startTaskResilient,
  TaskWaitTimeoutError,
  waitForTaskTerminal,
} from "../../tasks/executor-task.js";
import { streamText } from "ai";
import { defineAgentTool } from "../manifest.js";

const artifactPersistedOutputSchema = z.object({
  ok: z.literal(true),
  status: z.literal("persisted"),
  document_id: z.string(),
  title: z.string(),
  filename: z.string(),
  kind: z.literal("markdown"),
  total_chars: z.number(),
});

const artifactTaskOutputSchema = z.object({
  ok: z.literal(true),
  status: z.string(),
  title: z.string(),
  filename: z.string(),
  kind: z.literal("html"),
  task_id: z.string(),
  document_id: z.string().optional(),
  total_chars: z.number().optional(),
  blocks_failed: z.number().optional(),
});

const artifactBlockedOutputSchema = z.object({
  ok: z.literal(false),
  status: z.literal("blocked"),
  code: z.enum(["ARTIFACT_NOT_EDITABLE", "FILE_NOT_ATTACHED", "NOT_HTML"]),
  error: z.string(),
});

const artifactToolOutputSchema = z.union([
  artifactPersistedOutputSchema,
  artifactTaskOutputSchema,
  artifactBlockedOutputSchema,
]);

const htmlValidateOutputSchema = z.union([
  z.object({
    ok: z.boolean(),
    status: z.literal("completed"),
    file_id: z.string(),
    structural_errors: z.array(z.string()),
    broken_internal_links: z.array(z.string()),
    pages: z.number(),
    charts: z.number(),
    invalid_charts: z.number(),
    internal_links: z.number(),
    failed_blocks: z.array(z.object({ id: z.string(), reason: z.string() })),
    total_chars: z.number(),
  }),
  artifactBlockedOutputSchema,
]);

const listArtifactBlocksOutputSchema = z.union([
  z.object({
    ok: z.literal(true),
    status: z.literal("completed"),
    document_id: z.string(),
    mode: z.string(),
    blocks: z.array(
      z.object({
        id: z.string(),
        position: z.number(),
        type: z.string(),
        title: z.string(),
        brief: z.string(),
        char_count: z.number(),
      }),
    ),
  }),
  artifactBlockedOutputSchema,
]);

function parseStoredArtifactBlock(content: string): { title?: string; html?: string; error?: string } {
  try {
    const parsed = JSON.parse(content) as { title?: unknown; html?: unknown; error?: unknown };
    return {
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      html: typeof parsed.html === "string" ? parsed.html : undefined,
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    };
  } catch {
    return {};
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

async function* streamHtmlArtifactTask(
  task: Task,
  meta: { title: string; filename: string },
  signal: AbortSignal | undefined,
): AsyncGenerator<z.infer<typeof artifactToolOutputSchema>> {
  const base = {
    title: meta.title,
    filename: meta.filename,
    kind: "html" as const,
    task_id: task.id,
  };
  yield { ok: true, status: task.status, ...base };
  let terminal: Task;
  try {
    terminal = await waitForTaskTerminal(task.id, signal);
  } catch (error) {
    if (error instanceof TaskWaitTimeoutError) {
      throw new Error(`生成超时：超过 ${Math.round(MAX_TASK_WAIT_MS / 60_000)} 分钟未完成，已取消任务。`);
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
  throw new Error(terminal.error ?? (terminal.status === "cancelled" ? "已取消" : "生成失败"));
}

async function validateHtml(
  input: { file_id: string },
  { context }: { context: ArtifactToolContext },
): Promise<z.infer<typeof htmlValidateOutputSchema>> {
  const document = await getDocument(context.userId, input.file_id);
  if (document.conversation_id !== context.conversationId) {
    return {
      ok: false,
      status: "blocked",
      code: "FILE_NOT_ATTACHED",
      error: `file ${input.file_id} is not attached to this conversation`,
    };
  }
  const source = await getDocumentSource(context.userId, input.file_id);
  if (source.mimeType !== "text/html") {
    return { ok: false, status: "blocked", code: "NOT_HTML", error: "html_validate only supports HTML files" };
  }
  const html = new TextDecoder().decode(source.bytes);
  const validation = validateArtifactHtml(html);
  return {
    ok: validation.ok,
    status: "completed",
    file_id: input.file_id,
    structural_errors: validation.structural_errors,
    ...inspectArtifactHtml(html),
  };
}

async function listArtifactBlocks(
  input: { document_id: string },
  { context }: { context: ArtifactToolContext },
): Promise<z.infer<typeof listArtifactBlocksOutputSchema>> {
  const document = await getDocument(context.userId, input.document_id);
  if (document.conversation_id !== context.conversationId) {
    return {
      ok: false,
      status: "blocked",
      code: "FILE_NOT_ATTACHED",
      error: `file ${input.document_id} is not attached to this conversation`,
    };
  }
  if (document.kind !== "artifact") {
    return { ok: false, status: "blocked", code: "ARTIFACT_NOT_EDITABLE", error: `file ${input.document_id} is not editable` };
  }
  const isHtml = document.mime_type === "text/html" || document.filename.toLowerCase().endsWith(".html");
  if (!isHtml) {
    return { ok: false, status: "blocked", code: "NOT_HTML", error: "list_artifact_blocks only supports HTML artifacts" };
  }
  const workspace = await getLatestArtifactWorkspace(context.userId, input.document_id);
  const manifest = (workspace?.manifest ?? {}) as Record<string, unknown>;
  const manifestBlocks = Array.isArray(manifest.blocks) ? (manifest.blocks as Array<Record<string, unknown>>) : [];
  const metaById = new Map(
    manifestBlocks.filter((block) => typeof block?.id === "string").map((block) => [block.id as string, block]),
  );
  const mode = typeof manifest.mode === "string" ? manifest.mode : "document";
  const blocks = (workspace?.blocks ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((stored) => {
      const parsed = parseStoredArtifactBlock(stored.content);
      const meta = metaById.get(stored.id);
      const title = (typeof meta?.title === "string" && meta.title) || parsed.title || stored.id;
      const brief = typeof meta?.brief === "string" ? meta.brief : "";
      const type = (typeof meta?.type === "string" && meta.type) || stored.type;
      const charCount = parsed.html ? parsed.html.length : parsed.error ? 0 : stored.content.length;
      return { id: stored.id, position: stored.position, type, title, brief, char_count: charCount };
    });
  return { ok: true, status: "completed", document_id: input.document_id, mode, blocks };
}

export function createArtifactToolManifests(textProvider: ChatProvider) {
  return [
    defineAgentTool(
      "write_file",
      tool({
      description:
        "Generate and persist a new Markdown or HTML artifact from a content and visual brief.",
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
      }),
      outputSchema: artifactToolOutputSchema,
      contextSchema: artifactToolContextSchema,
      execute: (input, options) => writeFileTool(input, options, textProvider),
      }),
      {
        capability: "artifacts",
        effect: "add",
        trust: "closed",
        execution: "durable",
        modes: ["normal"],
        uiKind: "artifact",
      },
      {
        summary: "Generate and persist a Markdown or HTML artifact.",
        constraints: ["HTML charts use the platform-provided ECharts runtime."],
        parallelizable: true,
      },
    ),
    defineAgentTool(
      "edit_file",
      tool({
      description:
        "Revise an existing generated Markdown or HTML artifact from a change brief.",
      inputSchema: z.object({
        document_id: z.string().min(1).max(32),
        title: z.string().min(1).max(120).optional(),
        filename: z.string().min(1).max(160).optional(),
        brief: z
          .string()
          .min(1)
          .max(12_000)
          .describe(
            "Overall change description. With no block_ids/changes it rewrites every block; otherwise it is the fallback brief for targeted blocks. Describe chart type/data only — never name a charting library; all charts render via ECharts.",
          ),
        block_ids: z
          .array(z.string().regex(/^page-[1-9]\d*$/))
          .max(100)
          .optional()
          .describe("Blocks to revise with `brief`; all other blocks are reused unchanged. Get ids from list_artifact_blocks."),
        changes: z
          .array(
            z.object({
              block_id: z.string().regex(/^page-[1-9]\d*$/),
              brief: z.string().min(1).max(8_000),
            }),
          )
          .max(100)
          .optional()
          .describe("Per-block change briefs for precise edits; each targets one block by id. Untargeted blocks are reused unchanged."),
      }),
      outputSchema: artifactToolOutputSchema,
      contextSchema: artifactToolContextSchema,
      execute: (input, options) => editFileTool(input, options, textProvider),
      }),
      {
        capability: "artifacts",
        effect: "update",
        trust: "closed",
        execution: "durable",
        modes: ["normal"],
        uiKind: "artifact",
      },
      {
        summary: "Revise an existing Markdown or HTML artifact.",
        constraints: ["Edits to the same artifact must be serialized."],
        parallelizable: true,
      },
    ),
    defineAgentTool(
      "html_validate",
      tool({
      description: "Validate a stored HTML artifact and report structure, links, charts, layout blocks, and failures.",
      inputSchema: z.object({
        file_id: z.string().min(1).max(32),
      }),
      outputSchema: htmlValidateOutputSchema,
      contextSchema: artifactToolContextSchema,
      execute: validateHtml,
      }),
      {
        capability: "artifacts",
        effect: "read",
        trust: "private-untrusted",
        execution: "inline",
        modes: ["normal"],
      },
      { summary: "Validate and inspect a persisted HTML artifact." },
    ),
    defineAgentTool(
      "list_artifact_blocks",
      tool({
        description:
          "List the addressable blocks (id, order, type, title, brief, size) of a stored HTML artifact. Call this before edit_file so block_ids/changes target exact blocks instead of guessing.",
        inputSchema: z.object({
          document_id: z.string().min(1).max(32),
        }),
        outputSchema: listArtifactBlocksOutputSchema,
        contextSchema: artifactToolContextSchema,
        execute: listArtifactBlocks,
      }),
      {
        capability: "artifacts",
        effect: "read",
        trust: "private-untrusted",
        execution: "inline",
        modes: ["normal"],
      },
      { summary: "List addressable blocks of a persisted HTML artifact." },
    ),
  ];
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
  textProvider: ChatProvider,
): AsyncGenerator<z.infer<typeof artifactToolOutputSchema>> {
  const filename = safeFilename(input.filename);
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
        throw new Error(validation.error);
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
    yield* streamHtmlArtifactTask(task, { title: input.title, filename }, abortSignal);
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    console.error("[chat-agent] write_file failed", { toolCallId, error });
    throw error;
  }
}

export async function* editFileTool(
  input: {
    document_id: string;
    title?: string;
    filename?: string;
    brief: string;
    block_ids?: string[];
    changes?: Array<{ block_id: string; brief: string }>;
  },
  { context, toolCallId, abortSignal }: { context: ArtifactToolContext; toolCallId: string; abortSignal?: AbortSignal },
  textProvider: ChatProvider,
): AsyncGenerator<z.infer<typeof artifactToolOutputSchema>> {
  try {
    const current = await getDocument(context.userId, input.document_id);
    if (current.kind !== "artifact") {
      yield {
        ok: false,
        status: "blocked",
        code: "ARTIFACT_NOT_EDITABLE",
        error: `file ${input.document_id} is not editable`,
      };
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
      yield { ok: true, status: "persisted", document_id: document.id, title: document.title, filename: document.filename, kind: "markdown", total_chars: content.length };
      return;
    }

    const filename = input.filename ? safeFilename(input.filename) : current.filename;
    const title = input.title ?? current.title;
    const changes = input.changes ?? [];
    const blockBriefs: Record<string, string> = {};
    for (const change of changes) blockBriefs[change.block_id] = change.brief;
    const targetedIds = Array.from(new Set([...(input.block_ids ?? []), ...changes.map((c) => c.block_id)]));
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
          blockIds: targetedIds.length ? targetedIds : undefined,
          blockBriefs: Object.keys(blockBriefs).length ? blockBriefs : undefined,
          idempotencyKey: toolCallId,
        },
      },
      abortSignal,
    );
    yield* streamHtmlArtifactTask(task, { title, filename }, abortSignal);
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    console.error("[chat-agent] edit_file failed", { toolCallId, documentId: input.document_id, error });
    throw error;
  }
}
