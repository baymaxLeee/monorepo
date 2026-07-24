import { tool } from "ai";
import { z } from "zod";

import { validateStoredArtifact } from "../../artifacts/html-validation.js";
import {
  getDocument,
  getLatestArtifactWorkspace,
  createArtifact,
  updateArtifact,
} from "../../../../infrastructure/clients/knowledge.js";
import { type Task } from "../../../../infrastructure/clients/executor.js";
import { logger } from "../../../../infrastructure/observability/logger.js";
import type { ChatProvider } from "@backend/transport-ts/provider-model";
import { setActivePlanDocument } from "../../../conversations.js";
import type { AgentMode } from "../../agents/types.js";
import { artifactToolContextSchema, type ArtifactToolContext } from "../context.js";
import {
  MAX_TASK_WAIT_MS,
  pollTaskSnapshots,
  startExecutorTask,
  TaskWaitTimeoutError,
} from "../../tasks/executor-task.js";
import { defineAgentTool } from "../manifest.js";
import {
  toolBlocked,
  toolCompleted,
  toolFailed,
  toolRunning,
  ToolBlockedError,
  type ToolEmission,
} from "../outcome.js";

const artifactPersistedOutputSchema = z.object({
  document_id: z.string(),
  title: z.string(),
  filename: z.string(),
  kind: z.enum(["markdown", "plan"]),
  total_chars: z.number(),
});

const artifactTaskOutputSchema = z.object({
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

const artifactToolOutputSchema = z.union([
  artifactPersistedOutputSchema,
  artifactTaskOutputSchema,
]);

const htmlArtifactSectionInputSchema = z.object({
  title: z.string().min(1).max(160),
  brief: z.string().min(1).max(8_000),
  layout: z.string().min(1).max(400).optional(),
});

const writeMarkdownInputSchema = z.object({
  file_id: z.string().min(1).max(32).optional().describe("Existing Markdown file to overwrite. Omit to create a new file."),
  title: z.string().min(1).max(120).describe("Human-readable artifact title."),
  filename: z.string().min(1).max(160).regex(/\.md$/i).describe("Filename including the .md extension."),
  content: z.string().min(1).max(40_000).describe("Complete Markdown file content. This replaces the whole file; never pass a brief, diff, or patch."),
});

const writeHtmlInputSchema = z.object({
  title: z.string().min(1).max(120).describe("Human-readable artifact title."),
  brief: z.string().min(1).max(20_000).describe("Complete authoritative content and visual requirements for the HTML artifact. Preserve every user fact, constraint, prohibition, and acceptance condition here."),
  filename: z.string().min(1).max(160).regex(/\.html$/i).optional().describe("Optional filename including .html. Omit to derive it from title."),
  mode: z.enum(["document", "presentation", "dashboard"]).optional().describe("Optional content intent; defaults to document."),
  visual_direction: z.string().min(1).max(1_200).optional().describe("Optional overall visual direction. Omit when the brief already makes it clear."),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i).optional().describe("Optional six-digit hex accent color."),
  appearance: z.enum(["light", "dark"]).optional().describe("Optional canvas appearance; defaults to light."),
  sections: z.array(htmlArtifactSectionInputSchema).min(1).max(100).optional().describe("Optional independently generated sections in display order. Omit for one single-page block; each section needs only a title and complete brief."),
});

function safeFilename(filename: string): string {
  return filename
    .replace(/[\\/:"*?<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "file.md";
}

function htmlFilename(filename: string | undefined, title: string): string {
  const base = safeFilename(filename ?? title)
    .replace(/\.html$/i, "")
    .trim()
    .slice(0, 155) || "artifact";
  return `${base}.html`;
}

function planFilename(value: string): string {
  const base = safeFilename(value)
    .replace(/\.md$/i, "")
    .replace(/-plan$/i, "")
    .trim()
    .slice(0, 150) || "task";
  return `${base}-plan.md`;
}

function assertPlanContent(content: string): void {
  const headings = ["# 目标", "## 背景与约束", "## 实施方案", "## 任务", "## 验收标准"];
  let cursor = -1;
  for (const heading of headings) {
    const index = content.indexOf(heading, cursor + 1);
    if (index < 0) {
      throw new ToolBlockedError({
        code: "INVALID_PLAN_DOCUMENT",
        message: `plan Markdown is missing the required heading: ${heading}`,
        retryable: true,
        source: "chat",
      });
    }
    cursor = index;
  }
  if (!/- \[ \] .+/.test(content)) {
    throw new ToolBlockedError({
      code: "INVALID_PLAN_DOCUMENT",
      message: "plan Markdown must contain at least one unchecked task under ## 任务",
      retryable: true,
      source: "chat",
    });
  }
}

async function overwriteMarkdownFile(
  fileId: string,
  title: string,
  filename: string,
  content: string,
  context: ArtifactToolContext,
) {
  const current = await getDocument(context.userId, fileId);
  const isMarkdown = current.mime_type === "text/markdown" || current.filename.toLowerCase().endsWith(".md");
  if (current.conversation_id !== context.conversationId || current.kind !== "artifact" || !isMarkdown) {
    throw new ToolBlockedError({
      code: "MARKDOWN_FILE_NOT_WRITABLE",
      message: `file ${fileId} is not a writable Markdown file in this conversation`,
      retryable: false,
      source: "chat",
      details: { file_id: fileId },
    });
  }
  return updateArtifact({
    userId: context.userId,
    documentId: current.id,
    title,
    filename,
    content,
    mimeType: "text/markdown",
  });
}

const compactValidationFindingSchema = z.object({
  code: z.string(),
  block_id: z.string().optional(),
  reason: z.string(),
  evidence: z.string().optional(),
  suggestion: z.string(),
});

const htmlValidateOutputSchema = z
  .object({
    valid: z.boolean(),
    file_id: z.string(),
    errors: z.array(compactValidationFindingSchema),
    advisories: z.array(compactValidationFindingSchema),
  })
  .refine((output) => output.valid === (output.errors.length === 0), {
    message: "valid must be true exactly when no actionable errors remain",
  });

const listArtifactBlocksOutputSchema = z.object({
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
});

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
): AsyncGenerator<z.infer<typeof artifactToolOutputSchema> | ToolEmission> {
  const base = {
    title: meta.title,
    filename: meta.filename,
    kind: "html" as const,
    task_id: task.id,
  };
  yield toolRunning(base);
  let terminal: Task | null = null;
  try {
    for await (const snapshot of pollTaskSnapshots(task.id, task.ownerRef, signal)) {
      if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled") {
        terminal = snapshot;
        break;
      }
      yield toolRunning({
        blocks_done: snapshot.progress?.done,
        blocks_total: snapshot.progress?.total,
        ...base,
      });
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
    yield toolCompleted({
      document_id: documentId,
      total_chars: totalChars,
      blocks_failed: blocksFailed,
      reused_block_ids: reusedBlockIds,
      revised_block_ids: revisedBlockIds,
      regenerated_block_ids: regeneratedBlockIds,
      generated_block_ids: generatedBlockIds,
      ...base,
    });
    return;
  }
  if (terminal?.status === "failed" || terminal?.status === "cancelled") {
    yield toolFailed({
      code: terminal.status === "cancelled" ? "ARTIFACT_TASK_CANCELLED" : "ARTIFACT_TASK_FAILED",
      message: terminal.error ?? (terminal.status === "cancelled" ? "已取消" : "生成失败"),
      retryable: false,
      source: "executor",
      details: { ...base, terminal_status: terminal.status },
    });
    return;
  }
  throw new Error("生成失败");
}

async function* validateHtml(
  input: { file_id: string },
  { context, abortSignal }: { context: ArtifactToolContext; abortSignal?: AbortSignal },
  textProvider: ChatProvider,
): AsyncGenerator<z.infer<typeof htmlValidateOutputSchema> | ToolEmission> {
  const document = await getDocument(context.userId, input.file_id);
  if (document.conversation_id !== context.conversationId) {
    yield toolBlocked({
      code: "FILE_NOT_ATTACHED",
      message: `file ${input.file_id} is not attached to this conversation`,
      retryable: false,
      source: "knowledge",
      details: { file_id: input.file_id },
    });
    return;
  }
  if (document.mime_type !== "text/html") {
    yield toolBlocked({
      code: "NOT_HTML",
      message: "validate_html only supports HTML files",
      retryable: false,
      source: "chat",
      details: { file_id: input.file_id, mime_type: document.mime_type },
    });
    return;
  }
  if (document.kind !== "artifact") {
    yield toolBlocked({
      code: "ARTIFACT_NOT_EDITABLE",
      message: `file ${input.file_id} is not a generated artifact`,
      retryable: false,
      source: "chat",
      details: { file_id: input.file_id },
    });
    return;
  }
  for await (const stage of validateStoredArtifact({
    userId: context.userId,
    documentId: input.file_id,
    provider: textProvider,
    abortSignal,
  })) {
    if (stage.phase === "deterministic_validation") {
      yield toolRunning({ phase: stage.phase, file_id: input.file_id });
      continue;
    }
    if (stage.phase === "content_review") {
      yield toolRunning({ phase: stage.phase, file_id: input.file_id });
      continue;
    }
    const { decision } = stage;
    if (document.object_sha256 && decision.content_sha256 !== document.object_sha256) {
      throw new Error("validate_html result does not match the current artifact revision");
    }
    yield toolCompleted({
      valid: decision.ok,
      file_id: input.file_id,
      errors: decision.errors,
      advisories: decision.advisories,
    });
  }
}

async function listArtifactBlocks(
  input: { document_id: string },
  { context }: { context: ArtifactToolContext },
): Promise<z.infer<typeof listArtifactBlocksOutputSchema> | ToolEmission> {
  const document = await getDocument(context.userId, input.document_id);
  if (document.conversation_id !== context.conversationId) {
    return toolBlocked({
      code: "FILE_NOT_ATTACHED",
      message: `file ${input.document_id} is not attached to this conversation`,
      retryable: false,
      source: "knowledge",
      details: { document_id: input.document_id },
    });
  }
  if (document.kind !== "artifact") {
    return toolBlocked({
      code: "ARTIFACT_NOT_EDITABLE",
      message: `file ${input.document_id} is not editable`,
      retryable: false,
      source: "chat",
      details: { document_id: input.document_id },
    });
  }
  const isHtml = document.mime_type === "text/html" || document.filename.toLowerCase().endsWith(".html");
  if (!isHtml) {
    return toolBlocked({
      code: "NOT_HTML",
      message: "list_artifact_blocks only supports HTML artifacts",
      retryable: false,
      source: "chat",
      details: { document_id: input.document_id, mime_type: document.mime_type },
    });
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
  return toolCompleted({ document_id: input.document_id, mode, blocks });
}

export function createFileWriteToolManifests(mode: AgentMode, textProvider: ChatProvider) {
  return [
    defineAgentTool(
      "write_markdown",
      tool({
        description: mode === "plan"
          ? "Write the complete active execution plan as Markdown. Provide file_id to overwrite an existing plan; omit it to create one. The filename is normalized to *-plan.md."
          : "Write a complete Markdown file. Provide file_id to overwrite an existing Markdown file; omit it to create one. Every call persists the complete file content.",
        inputSchema: writeMarkdownInputSchema,
        outputSchema: artifactToolOutputSchema,
        contextSchema: artifactToolContextSchema,
        execute: (input, options) => writeMarkdownTool(input, options, mode),
      }),
      {
        capability: "files",
        effect: "write",
        trust: "closed",
        execution: "inline",
        modes: ["normal", "plan"],
        uiKind: "artifact",
      },
      {
        summary: "Write or fully overwrite a Markdown file.",
        parallelizable: true,
      },
    ),
    defineAgentTool(
      "write_html",
      tool({
        description:
          "Generate and persist a new HTML artifact from one complete authoritative brief. Omit sections for a single-page artifact; provide simple ordered sections only when separate generation blocks are genuinely needed. Executor validates the same flat payload and deterministically materializes its frozen internal plan without another model call.",
        inputSchema: writeHtmlInputSchema,
        outputSchema: artifactToolOutputSchema,
        contextSchema: artifactToolContextSchema,
        execute: (input, options) => writeHtmlTool(input, options, textProvider),
      }),
      {
        capability: "files",
        effect: "add",
        trust: "closed",
        execution: "durable",
        modes: ["normal"],
        uiKind: "artifact",
      },
      {
        summary: "Generate and persist an HTML artifact from a complete brief, with optional simple sections.",
        constraints: ["Omit sections for a single-page artifact.", "HTML data charts use the platform-provided ECharts runtime; diagrams choose HTML/CSS, SVG, Canvas, or ECharts from their information structure."],
        parallelizable: true,
      },
    ),
    defineAgentTool(
      "edit_file",
      tool({
      description:
        "Revise selected blocks of an existing generated HTML file from a change brief. Markdown uses write_markdown for complete-file overwrite.",
      inputSchema: z.object({
        document_id: z.string().min(1).max(32),
        title: z.string().min(1).max(120).optional(),
        filename: z.string().min(1).max(160).optional(),
        brief: z
          .string()
          .min(1)
          .max(12_000)
          .describe(
            "Overall change description. With no block_ids/changes it rewrites every block; otherwise it is the fallback brief for targeted blocks. Preserve the artifact's light appearance unless the user explicitly requests dark mode. For data charts, describe chart type/data only and never name a charting library; the platform renders them with ECharts. Diagrams may use HTML/CSS, inline SVG, or Canvas when appropriate.",
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
        capability: "files",
        effect: "update",
        trust: "closed",
        execution: "durable",
        modes: ["normal"],
        uiKind: "artifact",
      },
      {
        summary: "Revise an existing HTML file block-by-block.",
        constraints: ["Edits to the same artifact must be serialized."],
        parallelizable: true,
      },
    ),
    defineAgentTool(
      "validate_html",
      tool({
        description:
          "Validate the current stored HTML. Returns deterministic errors and high-signal content-review advisories so the primary ToolLoopAgent can decide whether to edit and revalidate.",
        inputSchema: z.object({
          file_id: z.string().min(1).max(32),
        }),
        outputSchema: htmlValidateOutputSchema,
        contextSchema: artifactToolContextSchema,
        execute: (input, options) => validateHtml(input, options, textProvider),
      }),
      {
        capability: "files",
        effect: "read",
        trust: "private-untrusted",
        execution: "inline",
        modes: ["normal"],
        uiKind: "validation",
        visibility: "visible",
      },
      { summary: "Validate HTML with deterministic hard errors and non-blocking review advisories." },
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
        capability: "files",
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

export async function* writeMarkdownTool(
  input: z.infer<typeof writeMarkdownInputSchema>,
  { context, toolCallId, abortSignal }: { context: ArtifactToolContext; toolCallId: string; abortSignal?: AbortSignal },
  mode: AgentMode,
): AsyncGenerator<z.infer<typeof artifactToolOutputSchema> | ToolEmission> {
  const filename = mode === "plan" ? planFilename(input.filename) : safeFilename(input.filename);
  try {
    if (mode === "plan") assertPlanContent(input.content);
    const document = input.file_id
      ? await overwriteMarkdownFile(input.file_id, input.title, filename, input.content, context)
      : await createArtifact({
          userId: context.userId,
          orgId: context.orgId,
          conversationId: context.conversationId,
          title: input.title,
          filename,
          content: input.content,
          mimeType: "text/markdown",
          idempotencyKey: toolCallId,
        });
    if (mode === "plan") await setActivePlanDocument(context.conversationId, document.id);
    yield toolCompleted({
      document_id: document.id,
      title: document.title,
      filename: document.filename,
      kind: mode === "plan" ? ("plan" as const) : ("markdown" as const),
      total_chars: input.content.length,
    });
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    logger.error({ toolCallId, err: error }, "write_markdown failed");
    throw error;
  }
}

export async function* writeHtmlTool(
  input: z.infer<typeof writeHtmlInputSchema>,
  { context, toolCallId, abortSignal }: { context: ArtifactToolContext; toolCallId: string; abortSignal?: AbortSignal },
  textProvider: ChatProvider,
): AsyncGenerator<z.infer<typeof artifactToolOutputSchema> | ToolEmission> {
  const filename = htmlFilename(input.filename, input.title);
  try {
    const task = await startExecutorTask(
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
          mode: input.mode ?? "document",
          brief: input.brief,
          visualDirection: input.visual_direction ?? "Use a polished responsive composition appropriate to the source brief.",
          accent: input.accent ?? "#6366f1",
          appearance: input.appearance ?? "light",
          sections: input.sections,
          idempotencyKey: toolCallId,
        },
      },
      abortSignal,
    );
    yield* streamHtmlArtifactTask(task, { title: input.title, filename }, abortSignal);
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    logger.error({ toolCallId, err: error }, "write_html failed");
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
): AsyncGenerator<z.infer<typeof artifactToolOutputSchema> | ToolEmission> {
  try {
    const current = await getDocument(context.userId, input.document_id);
    if (current.kind !== "artifact") {
      yield toolBlocked({
        code: "ARTIFACT_NOT_EDITABLE",
        message: `file ${input.document_id} is not editable`,
        retryable: false,
        source: "chat",
        details: { document_id: input.document_id },
      });
      return;
    }
    const isHtml = current.mime_type === "text/html" || current.filename.toLowerCase().endsWith(".html");
    if (!isHtml) {
      yield toolBlocked({
        code: "HTML_EDIT_REQUIRED",
        message: "edit_file only supports HTML; overwrite Markdown with write_markdown and the complete content",
        retryable: false,
        source: "chat",
        details: { document_id: current.id },
      });
      return;
    }

    const filename = input.filename ? safeFilename(input.filename) : current.filename;
    const title = input.title ?? current.title;
    const changes = input.changes ?? [];
    const blockBriefs: Record<string, string> = {};
    for (const change of changes) blockBriefs[change.block_id] = change.brief;
    const targetedIds = Array.from(new Set([...(input.block_ids ?? []), ...changes.map((c) => c.block_id)]));
    const task = await startExecutorTask(
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
