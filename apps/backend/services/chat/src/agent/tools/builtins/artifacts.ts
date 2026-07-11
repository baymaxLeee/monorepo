import { tool } from "ai";
import { z } from "zod";

import { buildArtifactTextModel, collectText, combinedSignal } from "../../artifacts/generator.js";
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
  getLatestArtifactWorkspace,
  createArtifact,
  updateArtifact,
} from "../../../clients/knowledge.js";
import { type Task, validateHtml as validateHtmlWithExecutor } from "../../../clients/executor.js";
import { logger } from "../../../lib/logger.js";
import type { ChatProvider } from "@backend/transport-ts/provider-model";
import { artifactToolContextSchema, type ArtifactToolContext } from "../context.js";
import {
  MAX_TASK_WAIT_MS,
  pollTaskSnapshots,
  startTaskResilient,
  TaskWaitTimeoutError,
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

const htmlValidationFindingSchema = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  category: z.enum([
    "structure",
    "security",
    "template",
    "responsive",
    "accessibility",
    "navigation",
    "chart",
    "content",
    "coherence",
    "visual",
  ]),
  message: z.string(),
  suggestion: z.string(),
  source: z.enum(["static", "model"]),
  actionable: z.boolean(),
  block_id: z.string().optional(),
  selector: z.string().optional(),
  evidence: z.object({ kind: z.enum(["html", "css"]), excerpt: z.string() }).optional(),
});

const htmlValidationReportSchema = z.object({
  schema_version: z.literal(1),
  template_version: z.number().int().positive(),
  ok: z.boolean(),
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  summary: z.object({ errors: z.number().int().nonnegative(), warnings: z.number().int().nonnegative(), infos: z.number().int().nonnegative() }),
  findings: z.array(htmlValidationFindingSchema),
  metrics: z.object({
    blocks: z.number().int().nonnegative(),
    charts: z.number().int().nonnegative(),
    internal_links: z.number().int().nonnegative(),
    total_chars: z.number().int().nonnegative(),
  }),
});

const artifactTaskOutputSchema = z.object({
  ok: z.literal(true),
  status: z.string(),
  title: z.string(),
  filename: z.string(),
  kind: z.literal("html"),
  task_id: z.string(),
  blocks_done: z.number().optional(),
  blocks_total: z.number().optional(),
  document_id: z.string().optional(),
  total_chars: z.number().optional(),
  blocks_failed: z.number().optional(),
  reused_block_ids: z.array(z.string()).optional(),
  revised_block_ids: z.array(z.string()).optional(),
  regenerated_block_ids: z.array(z.string()).optional(),
  generated_block_ids: z.array(z.string()).optional(),
});

const artifactBlockedOutputSchema = z.object({
  ok: z.literal(false),
  status: z.literal("blocked"),
  code: z.enum([
    "ARTIFACT_NOT_EDITABLE",
    "FILE_NOT_ATTACHED",
    "NOT_HTML",
  ]),
  error: z.string(),
});

// Executor-reported terminal failure/cancellation is a structured tool output
// (not a thrown error) so the artifact card renders its failed/cancelled state
// off the tool part (ADR-0035). Poll errors/timeout/abort still throw.
const artifactTaskFailedOutputSchema = z.object({
  ok: z.literal(false),
  status: z.enum(["failed", "cancelled"]),
  kind: z.literal("html"),
  task_id: z.string(),
  title: z.string(),
  filename: z.string(),
  error: z.string().optional(),
});

const artifactToolOutputSchema = z.union([
  artifactPersistedOutputSchema,
  artifactTaskOutputSchema,
  artifactTaskFailedOutputSchema,
  artifactBlockedOutputSchema,
]);

const htmlValidateOutputSchema = z.union([
  htmlValidationReportSchema.extend({
    status: z.literal("completed"),
    file_id: z.string(),
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
        status: z.enum(["ok", "failed"]),
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

function taskResultFields(result: unknown): {
  documentId?: string;
  totalChars?: number;
  blocksFailed?: number;
  reusedBlockIds?: string[];
  revisedBlockIds?: string[];
  regeneratedBlockIds?: string[];
  generatedBlockIds?: string[];
} {
  if (!result || typeof result !== "object") return {};
  const r = result as Record<string, unknown>;
  const stringArray = (value: unknown) =>
    Array.isArray(value) && value.every((item) => typeof item === "string")
      ? (value as string[])
      : undefined;
  return {
    documentId: typeof r.documentId === "string" ? r.documentId : undefined,
    totalChars: typeof r.totalChars === "number" ? r.totalChars : undefined,
    blocksFailed: typeof r.blocksFailed === "number" ? r.blocksFailed : undefined,
    reusedBlockIds: stringArray(r.reusedBlockIds),
    revisedBlockIds: stringArray(r.revisedBlockIds),
    regeneratedBlockIds: stringArray(r.regeneratedBlockIds),
    generatedBlockIds: stringArray(r.generatedBlockIds),
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
  let terminal: Task | null = null;
  try {
    for await (const snapshot of pollTaskSnapshots(task.id, task.ownerRef, signal)) {
      if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled") {
        terminal = snapshot;
        break;
      }
      yield {
        ok: true,
        status: "running",
        blocks_done: snapshot.progress?.done,
        blocks_total: snapshot.progress?.total,
        ...base,
      };
    }
  } catch (error) {
    if (error instanceof TaskWaitTimeoutError) {
      throw new Error(`生成超时：超过 ${Math.round(MAX_TASK_WAIT_MS / 60_000)} 分钟未完成，已取消任务。`);
    }
    throw error;
  }
  if (terminal?.status === "completed") {
    const {
      documentId,
      totalChars,
      blocksFailed,
      reusedBlockIds,
      revisedBlockIds,
      regeneratedBlockIds,
      generatedBlockIds,
    } = taskResultFields(terminal.result);
    yield {
      ok: true,
      status: "completed",
      document_id: documentId,
      total_chars: totalChars,
      blocks_failed: blocksFailed,
      reused_block_ids: reusedBlockIds,
      revised_block_ids: revisedBlockIds,
      regenerated_block_ids: regeneratedBlockIds,
      generated_block_ids: generatedBlockIds,
      ...base,
    };
    return;
  }
  if (terminal?.status === "failed" || terminal?.status === "cancelled") {
    yield {
      ok: false,
      status: terminal.status,
      error: terminal.error ?? (terminal.status === "cancelled" ? "已取消" : "生成失败"),
      ...base,
    };
    return;
  }
  throw new Error("生成失败");
}

async function validateHtml(
  input: { file_id: string },
  { context, abortSignal }: { context: ArtifactToolContext; abortSignal?: AbortSignal },
  textProvider: ChatProvider,
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
  if (document.mime_type !== "text/html") {
    return { ok: false, status: "blocked", code: "NOT_HTML", error: "html_validate only supports HTML files" };
  }
  if (document.kind !== "artifact") {
    return {
      ok: false,
      status: "blocked",
      code: "ARTIFACT_NOT_EDITABLE",
      error: `file ${input.file_id} is not a generated artifact`,
    };
  }
  const liveReport = await validateHtmlWithExecutor({
    userId: context.userId,
    orgId: context.orgId,
    providerId: textProvider.id,
    documentId: input.file_id,
    signal: abortSignal,
  });
  const parsed = htmlValidationReportSchema.parse(liveReport);
  if (document.object_sha256 && parsed.content_sha256 !== document.object_sha256) {
    throw new Error("html_validate result does not match the current artifact revision");
  }
  return {
    ...parsed,
    status: "completed",
    file_id: input.file_id,
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
      const status = parsed.error && !parsed.html ? ("failed" as const) : ("ok" as const);
      return { id: stored.id, position: stored.position, type, title, brief, char_count: charCount, status };
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
      description:
        "Run the canonical validator against the current stored HTML and return stable error/warning codes, block and selector locations, responsive/template/accessibility findings, evidence, and repair suggestions. The runtime quality gate uses actionable findings to list blocks, repair affected blocks, and revalidate before completion.",
      inputSchema: z.object({
        file_id: z.string().min(1).max(32),
      }),
      outputSchema: htmlValidateOutputSchema,
      contextSchema: artifactToolContextSchema,
      execute: (input, options) => validateHtml(input, options, textProvider),
      }),
      {
        capability: "artifacts",
        effect: "read",
        trust: "private-untrusted",
        execution: "inline",
        modes: ["normal"],
        visibility: "internal",
      },
      { summary: "Validate the current HTML and return actionable findings for the edit-and-revalidate loop." },
    ),
    defineAgentTool(
      "list_artifact_blocks",
      tool({
        description:
          "List the addressable blocks (id, order, status, type, title, brief, size) of a stored HTML artifact. Call this before edit_file so block_ids/changes target exact blocks instead of guessing.",
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
        visibility: "internal",
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
        orgId: context.orgId,
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
          orgId: context.orgId,
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
    logger.error({ toolCallId, err: error }, "write_file failed");
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
          orgId: context.orgId,
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
          expectedObjectSha256: current.object_sha256 ?? undefined,
          idempotencyKey: toolCallId,
        },
      },
      abortSignal,
    );
    yield* streamHtmlArtifactTask(task, { title, filename }, abortSignal);
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    logger.error({ toolCallId, documentId: input.document_id, err: error }, "edit_file failed");
    throw error;
  }
}
