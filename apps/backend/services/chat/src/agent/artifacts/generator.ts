import { Output, extractJsonMiddleware, generateText, streamText, wrapLanguageModel } from "ai";
import { z } from "zod";

import { getProvider } from "../../clients/admin.js";
import {
  createArtifact,
  getDocument,
  getLatestArtifactWorkspace,
  updateArtifact,
  type StoredArtifactBlock,
} from "../../clients/knowledge.js";
import {
  artifactRevisionPrompt,
  artifactSystemPrompt,
  normalizeArtifactContent,
  safeFilename,
  validateArtifactContent,
} from "./template.js";
import {
  ARTIFACT_GENERATION_TIMEOUT,
} from "./config.js";
import { createProviderModel } from "../providers/model.js";
import type { ArtifactToolContext } from "../tools/context.js";
import { sanitizeArtifactPart, ARTIFACT_DESIGN_VOCABULARY, ARTIFACT_CHART_SPEC } from "./compiler.js";

import type { ArtifactMode, ArtifactTheme, ArtifactBlock } from "./types.js";
export type { ArtifactMode, ArtifactTheme, ArtifactBlock } from "./types.js";

import {
  runArtifactGenerationDetached,
  runArtifactGenerationInline,
  type BlockStrategy,
} from "./generation-runner.js";
import { useArtifactSyncGeneration } from "./config.js";

const themeSchema = z.object({
  preset: z.string().min(1).max(40),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
});

const blockSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/).max(80),
  type: z.string().min(1).max(40),
  title: z.string().min(1).max(160),
  brief: z.string().min(1).max(4000),
});

export async function buildArtifactTextModel(userId: string, providerId: string) {
  const provider = await getProvider(userId, providerId);
  const model = createProviderModel(provider, { disableReasoning: true });
  return {
    model,
    maxOutputTokens: provider.maxOutputTokens,
  };
}

async function collectText(result: { textStream: AsyncIterable<string> }): Promise<string> {
  let raw = "";
  for await (const delta of result.textStream) raw += delta;
  return raw;
}

function combinedSignal(abortSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ARTIFACT_GENERATION_TIMEOUT.totalMs);
  return abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;
}

const MAX_BLOCK_BRIEF = 4000;

const outlineSchema = z.object({
  accent: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  pages: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        brief: z.string().min(1).max(MAX_BLOCK_BRIEF),
      }),
    )
    .min(1)
    .max(100),
});

function resolvePageCount(input: { mode: ArtifactMode; brief: string; pageCount?: number }): number {
  const requested = Number(input.brief.match(/(?:^|\D)(\d{1,3})\s*(?:页|pages?)/i)?.[1]);
  return (
    input.pageCount ??
    (Number.isInteger(requested) && requested >= 1 && requested <= 100
      ? requested
      : input.mode === "presentation"
        ? 10
        : input.mode === "dashboard"
          ? 4
          : 8)
  );
}

function deterministicOutline(input: {
  title: string;
  mode: ArtifactMode;
  brief: string;
  count: number;
}): { theme: ArtifactTheme; blocks: ArtifactBlock[] } {
  return {
    theme: {
      preset: input.mode === "presentation" ? "classroom" : "editorial",
      accent: input.brief.match(/#[0-9a-f]{6}/i)?.[0] ?? "#2563eb",
    },
    blocks: Array.from({ length: input.count }, (_, index) => ({
      id: `page-${index + 1}`,
      type: input.mode === "presentation" ? "slide" : "section",
      title: `${input.title} · ${index + 1}/${input.count}`,
      brief: `Generate only ordered page/block ${index + 1} of ${input.count}. Derive its distinct content from the overall artifact brief and avoid repeating other pages.`,
    })),
  };
}

function outlineInstructions(input: { mode: ArtifactMode; count: number }): string {
  return [
    `Plan the outline for a ${input.count}-page ${input.mode} artifact.`,
    "Return exactly one entry per page in reading order.",
    "Each page needs a distinct, specific title and a brief that states what THIS page must cover so independently generated pages never overlap or leave gaps.",
    "The brief is an instruction to a writer, not prose: name the concrete sections, data points, or visuals that belong on this page and nothing that belongs on another page.",
    "Optionally pick one accent hex color that fits the topic.",
    "Do not write any HTML; describe content only.",
  ].join("\n");
}

// Outline-first: a single planning call assigns each page distinct content so
// the parallel block generators receive isolated instructions instead of all
// guessing from the same global brief (the cause of duplicated/missing pages).
// Any failure degrades to the deterministic outline so generation still runs.
async function planArtifact(input: {
  title: string;
  mode: ArtifactMode;
  brief: string;
  pageCount?: number;
  model: Awaited<ReturnType<typeof buildArtifactTextModel>>["model"];
  abortSignal: AbortSignal;
}): Promise<{ theme: ArtifactTheme; blocks: ArtifactBlock[] }> {
  const count = resolvePageCount(input);
  const fallback = deterministicOutline({ title: input.title, mode: input.mode, brief: input.brief, count });
  try {
    const structuredModel = wrapLanguageModel({ model: input.model, middleware: extractJsonMiddleware() });
    const result = await generateText({
      model: structuredModel,
      output: Output.object({ schema: outlineSchema }),
      instructions: outlineInstructions({ mode: input.mode, count }),
      prompt: [
        `<title>${input.title}</title>`,
        `<page_count>${count}</page_count>`,
        `<artifact_brief>${input.brief}</artifact_brief>`,
      ].join("\n"),
      maxOutputTokens: 4_000,
      abortSignal: input.abortSignal,
    });
    const pages = result.output?.pages ?? [];
    if (!pages.length) return fallback;
    const accent = result.output?.accent?.match(/^#[0-9a-f]{6}$/i)?.[0] ?? fallback.theme.accent;
    return {
      theme: { preset: fallback.theme.preset, accent },
      blocks: pages.map((page, index) => ({
        id: `page-${index + 1}`,
        type: input.mode === "presentation" ? "slide" : "section",
        title: page.title.slice(0, 160),
        brief: page.brief.slice(0, MAX_BLOCK_BRIEF),
      })),
    };
  } catch (error) {
    if (input.abortSignal.aborted) throw error;
    console.error("[chat-agent] artifact outline planning failed, using deterministic outline", error);
    return fallback;
  }
}

function blockInstructions(input: {
  mode: ArtifactMode;
  theme: ArtifactTheme;
  outline: ArtifactBlock[];
}): string {
  const layoutHint =
    input.mode === "presentation"
      ? "This is one slide: one clear focal point, large headline, few words, generous whitespace. Prefer grid-2/grid-3 of cards or kpi over dense paragraphs."
      : input.mode === "dashboard"
        ? "This is one dashboard panel: lead with kpi metrics and a chart; keep supporting text terse."
        : "This is one document section: a clear heading, a short lead, then structured body content.";
  return [
    "Generate one semantic HTML body fragment for a larger compiled artifact.",
    "Return only the fragment: no markdown fence, doctype, html, head, body, style, or script tags.",
    "Never emit inline JavaScript or event-handler attributes.",
    "The compiler ships a complete design system (tokens, typography, components). Compose layout ONLY from the class vocabulary below.",
    "Do NOT write inline style attributes for layout, color, spacing, font, or borders — use the classes. Do NOT define your own CSS or hex colors; use the accent via the provided classes.",
    "<design_system>",
    ARTIFACT_DESIGN_VOCABULARY,
    "</design_system>",
    "Wrap the fragment's direct children in a `stack` or `stack-lg` container so spacing stays consistent. Reuse the same components other blocks use for the same kind of content so the whole document looks uniform.",
    "Internal navigation must use fragment links such as href=\"#chapter-id\"; the compiler gives every block that id.",
    "<chart_spec>",
    ARTIFACT_CHART_SPEC,
    "</chart_spec>",
    "Use accessible headings, table headers, and image alt text.",
    layoutHint,
    `Mode: ${input.mode}. Theme preset: ${input.theme.preset}. Accent color is applied automatically via the design system.`,
    `Whole outline: ${input.outline.map((block) => `${block.id}:${block.title}`).join(" | ")}`,
  ].join("\n");
}

export async function generateBlock(input: {
  block: ArtifactBlock;
  mode: ArtifactMode;
  theme: ArtifactTheme;
  outline: ArtifactBlock[];
  artifactBrief: string;
  tools: Awaited<ReturnType<typeof buildArtifactTextModel>>;
  abortSignal: AbortSignal;
  currentHtml?: string;
  changeBrief?: string;
}): Promise<string> {
  let lastError = "empty output";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt = input.currentHtml
      ? [
          `<artifact_brief>${input.artifactBrief}</artifact_brief>`,
          `<block id="${input.block.id}" title="${input.block.title}">${input.currentHtml}</block>`,
          `<change_request>${input.changeBrief ?? input.block.brief}</change_request>`,
          "Return the complete revised fragment for this block.",
        ].join("\n")
      : [
          `<artifact_brief>${input.artifactBrief}</artifact_brief>`,
          `<block id="${input.block.id}" title="${input.block.title}">${input.block.brief}</block>`,
        ].join("\n");
    const result = streamText({
      model: input.tools.model,
      maxOutputTokens: input.tools.maxOutputTokens,
      instructions: blockInstructions(input),
      prompt,
      timeout: ARTIFACT_GENERATION_TIMEOUT,
      abortSignal: input.abortSignal,
    });
    const html = sanitizeArtifactPart(await collectText(result));
    if (html) return html;
    lastError = `block ${input.block.id} produced empty or unsafe HTML on attempt ${attempt}`;
  }
  throw new Error(lastError);
}

async function persistAndPublishHtml(input: {
  context: ArtifactToolContext;
  toolCallId: string;
  documentId?: string;
  resumeJobId?: string;
  title: string;
  filename: string;
  mode: ArtifactMode;
  brief: string;
  theme: ArtifactTheme;
  blocks: ArtifactBlock[];
  abortSignal: AbortSignal;
  blockStrategies?: BlockStrategy[];
  sourceHtmlById?: Map<string, string>;
  sourceDocumentId?: string;
}) {
  const runner = useArtifactSyncGeneration() ? runArtifactGenerationInline : runArtifactGenerationDetached;
  return runner({
    userId: input.context.userId,
    conversationId: input.context.conversationId,
    runId: input.context.runId,
    toolCallId: input.toolCallId,
    providerId: input.context.providerId,
    title: input.title,
    filename: input.filename,
    mode: input.mode,
    brief: input.brief,
    theme: input.theme,
    blocks: input.blocks,
    documentId: input.documentId,
    resumeJobId: input.resumeJobId,
    blockStrategies: input.blockStrategies,
    sourceHtmlById: input.sourceHtmlById,
    sourceDocumentId: input.sourceDocumentId,
    abortSignal: input.abortSignal,
  });
}

export async function writeFileTool(
  input: {
    title: string;
    filename: string;
    kind: "html" | "markdown";
    mode: ArtifactMode;
    brief: string;
    page_count?: number;
    resume_job_id?: string;
  },
  { context, toolCallId, abortSignal }: { context: ArtifactToolContext; toolCallId: string; abortSignal?: AbortSignal },
) {
  const filename = safeFilename(input.filename);
  const signal = combinedSignal(abortSignal);
  try {
    const tools = await buildArtifactTextModel(context.userId, context.providerId);
    if (input.kind === "markdown") {
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

    const outline = await planArtifact({
      title: input.title,
      mode: input.mode,
      brief: input.brief,
      pageCount: input.page_count,
      model: tools.model,
      abortSignal: signal,
    });
    return await persistAndPublishHtml({
      context,
      toolCallId,
      title: input.title,
      filename,
      mode: input.mode,
      brief: input.brief,
      theme: outline.theme,
      blocks: outline.blocks,
      abortSignal: signal,
      resumeJobId: input.resume_job_id,
    });
  } catch (error) {
    if (abortSignal?.aborted) throw error;
    console.error("[chat-agent] write_file failed", { toolCallId, error });
    return { ok: false, error: String(error).slice(0, 500) };
  }
}

function parseStoredBlock(block: StoredArtifactBlock): { title: string; html: string } {
  const parsed = JSON.parse(block.content) as { title?: unknown; html?: unknown };
  if (typeof parsed.html !== "string") throw new Error(`artifact block ${block.id} is invalid`);
  return {
    title: typeof parsed.title === "string" ? parsed.title : block.id,
    html: parsed.html,
  };
}

function previousTheme(manifest: Record<string, unknown>): ArtifactTheme {
  const parsed = themeSchema.safeParse(manifest.theme);
  return parsed.success ? parsed.data : { preset: "editorial", accent: "#2563eb" };
}

function planArtifactEdit(input: {
  existing: Array<ArtifactBlock & { html: string }>;
  theme: ArtifactTheme;
  blockIds?: string[];
}) {
  const selected = input.blockIds?.length ? new Set(input.blockIds) : null;
  return {
    theme: input.theme,
    blocks: input.existing.map(({ html: _html, ...block }) => ({
      ...block,
      action: selected && !selected.has(block.id) ? "reuse" as const : "revise" as const,
      sourceId: block.id,
    })),
  };
}

export async function editFileTool(
  input: { document_id: string; title?: string; filename?: string; brief: string; block_ids?: string[] },
  { context, toolCallId, abortSignal }: { context: ArtifactToolContext; toolCallId: string; abortSignal?: AbortSignal },
) {
  const signal = combinedSignal(abortSignal);
  try {
    const current = await getDocument(context.userId, input.document_id);
    if (current.kind !== "artifact") return { ok: false, error: `file ${input.document_id} is not editable` };
    const isHtml = current.mime_type === "text/html" || current.filename.toLowerCase().endsWith(".html");
    if (!isHtml) {
      const tools = await buildArtifactTextModel(context.userId, context.providerId);
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

    const workspace = await getLatestArtifactWorkspace(context.userId, current.id);
    const manifest = workspace.manifest as Record<string, unknown>;
    const manifestBlocks = Array.isArray(manifest.blocks) ? manifest.blocks : [];
    const metadata = new Map(
      manifestBlocks.flatMap((value) => {
        const parsed = blockSchema.safeParse(value);
        return parsed.success ? [[parsed.data.id, parsed.data] as const] : [];
      }),
    );
    const existing = workspace.blocks.map((stored) => {
      const content = parseStoredBlock(stored);
      const meta = metadata.get(stored.id);
      return {
        id: stored.id,
        type: meta?.type ?? stored.type,
        title: meta?.title ?? content.title,
        brief: meta?.brief ?? content.title,
        html: content.html,
      };
    });
    const mode = manifest.mode === "presentation" || manifest.mode === "dashboard" ? manifest.mode : "document";
    const oldTheme = previousTheme(manifest);
    const knownIds = new Set(existing.map((block) => block.id));
    const unknownIds = (input.block_ids ?? []).filter((id) => !knownIds.has(id));
    if (unknownIds.length) return { ok: false, error: `unknown block ids: ${unknownIds.join(", ")}` };
    const edit = planArtifactEdit({ existing, theme: oldTheme, blockIds: input.block_ids });
    const editIds = new Set(edit.blocks.map((block) => block.id));
    if (editIds.size !== edit.blocks.length) throw new Error("artifact edit plan contains duplicate block ids");
    const byId = new Map(existing.map((block) => [block.id, block]));
    for (const block of edit.blocks) {
      if ((block.action === "reuse" || block.action === "revise") && (!block.sourceId || !byId.has(block.sourceId))) {
        throw new Error(`${block.action} block ${block.id} has no valid sourceId`);
      }
    }
    const blocks = edit.blocks.map(({ action: _action, sourceId: _sourceId, ...block }) => block);
    const sourceHtmlById = new Map(existing.map((block) => [block.id, block.html]));
    const blockStrategies: BlockStrategy[] = edit.blocks.map((block) => ({
      id: block.id,
      action: block.action,
      sourceId: block.sourceId,
    }));
    return await persistAndPublishHtml({
      context,
      toolCallId,
      documentId: current.id,
      title: input.title ?? current.title,
      filename: input.filename ? safeFilename(input.filename) : current.filename,
      mode,
      brief: input.brief,
      theme: edit.theme,
      blocks,
      abortSignal: signal,
      blockStrategies,
      sourceHtmlById,
      sourceDocumentId: current.id,
    });
  } catch (error) {
    if (abortSignal?.aborted) throw error;
    console.error("[chat-agent] edit_file failed", { toolCallId, documentId: input.document_id, error });
    return { ok: false, error: String(error).slice(0, 500) };
  }
}
