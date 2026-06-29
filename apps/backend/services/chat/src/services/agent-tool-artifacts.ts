import { streamText } from "ai";
import { z } from "zod";

import { getProvider } from "../clients/admin.js";
import {
  createArtifact,
  getDocument,
  getLatestArtifactWorkspace,
  listArtifactBlocks,
  publishArtifactRevision,
  reserveArtifactGeneration,
  saveArtifactBlock,
  saveArtifactPlan,
  updateArtifact,
  type StoredArtifactBlock,
} from "../clients/knowledge.js";
import {
  artifactRevisionPrompt,
  artifactSystemPrompt,
  normalizeArtifactContent,
  safeFilename,
  validateArtifactContent,
} from "./agent-artifacts.js";
import {
  ARTIFACT_GENERATION_CONCURRENCY,
  ARTIFACT_GENERATION_TIMEOUT,
  ARTIFACT_MODEL_OUTPUT_TOKENS,
} from "./agent-config.js";
import { createProviderModel } from "./agent-provider.js";
import type { ToolContext } from "./agent-types.js";
import { compileArtifactHtml, sanitizeArtifactPart } from "./artifact-compiler.js";

type ArtifactMode = "document" | "presentation" | "dashboard";
type ArtifactTheme = { preset: string; accent: string };
type ArtifactBlock = { id: string; type: string; title: string; brief: string };

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

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await worker(values[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return results;
}

async function planArtifact(input: {
  title: string;
  mode: ArtifactMode;
  brief: string;
  pageCount?: number;
}): Promise<{ theme: ArtifactTheme; blocks: ArtifactBlock[] }> {
  const deterministic = (count: number) => ({
    theme: {
      preset: input.mode === "presentation" ? "classroom" : "editorial",
      accent: input.brief.match(/#[0-9a-f]{6}/i)?.[0] ?? "#2563eb",
    },
    blocks: Array.from({ length: count }, (_, index) => ({
      id: `page-${index + 1}`,
      type: input.mode === "presentation" ? "slide" : "section",
      title: `${input.title} · ${index + 1}/${count}`,
      brief: `Generate only ordered page/block ${index + 1} of ${count}. Derive its distinct content from the overall artifact brief and avoid repeating other pages.`,
    })),
  });
  const requested = Number(input.brief.match(/(?:^|\D)(\d{1,3})\s*(?:页|pages?)/i)?.[1]);
  const count = input.pageCount ?? (Number.isInteger(requested) && requested >= 1 && requested <= 100
    ? requested
    : input.mode === "presentation" ? 10 : input.mode === "dashboard" ? 4 : 8);
  return deterministic(count);
}

function blockInstructions(input: {
  mode: ArtifactMode;
  theme: ArtifactTheme;
  outline: ArtifactBlock[];
}): string {
  return [
    "Generate one semantic HTML body fragment for a larger compiled artifact.",
    "Return only the fragment: no markdown fence, doctype, html, head, body, style, or script tags.",
    "Never emit inline JavaScript or event-handler attributes.",
    "Internal navigation must use fragment links such as href=\"#chapter-id\"; the compiler gives every block that id.",
    "Charts must be one empty div with data-chart-option containing escaped strict JSON. Never emit canvas or ECharts JavaScript.",
    "Use accessible headings, tables, alt text, and restrained inline styles. The compiler owns page sizing and global CSS.",
    `Mode: ${input.mode}. Theme preset: ${input.theme.preset}. Accent: ${input.theme.accent}.`,
    `Whole outline: ${input.outline.map((block) => `${block.id}:${block.title}`).join(" | ")}`,
  ].join("\n");
}

async function generateBlock(input: {
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
      maxOutputTokens: ARTIFACT_MODEL_OUTPUT_TOKENS,
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
  context: ToolContext;
  toolCallId: string;
  documentId?: string;
  title: string;
  filename: string;
  mode: ArtifactMode;
  brief: string;
  theme: ArtifactTheme;
  blocks: ArtifactBlock[];
  blockContent: (block: ArtifactBlock, index: number) => Promise<string>;
}) {
  const generation = await reserveArtifactGeneration({
    userId: input.context.userId,
    conversationId: input.context.conversationId,
    documentId: input.documentId,
    title: input.title,
    filename: input.filename,
    mode: input.mode,
    brief: input.brief,
    idempotencyKey: input.toolCallId,
  });
  await saveArtifactPlan({
    userId: input.context.userId,
    generationId: generation.id,
    manifest: {
      schemaVersion: 2,
      mode: input.mode,
      theme: input.theme,
      blocks: input.blocks,
    },
    blocks: input.blocks.map((block) => ({ id: block.id, type: block.type, brief: block.brief })),
  });
  await mapConcurrent(input.blocks, ARTIFACT_GENERATION_CONCURRENCY, async (block, index) => {
    const html = await input.blockContent(block, index);
    await saveArtifactBlock({
      userId: input.context.userId,
      generationId: generation.id,
      blockId: block.id,
      content: JSON.stringify({ title: block.title, html }),
    });
    return html.length;
  });
  const stored = await listArtifactBlocks(input.context.userId, generation.id);
  if (stored.length !== input.blocks.length) {
    throw new Error(`artifact incomplete: expected ${input.blocks.length} blocks, found ${stored.length}`);
  }
  const compiled = compileArtifactHtml({
    title: input.title,
    mode: input.mode,
    theme: input.theme,
    parts: input.blocks,
    stored,
  });
  if (compiled.partsFailed > 0) {
    throw new Error(`artifact compile rejected ${compiled.partsFailed} blocks`);
  }
  const published = await publishArtifactRevision({
    userId: input.context.userId,
    generationId: generation.id,
    compiledHtml: compiled.html,
  });
  return {
    ok: true,
    status: "persisted",
    document_id: published.document_id,
    revision_id: published.revision_id,
    title: published.title,
    filename: published.filename,
    kind: "html" as const,
    total_chars: published.total_chars,
    blocks_total: input.blocks.length,
    blocks_done: input.blocks.length,
  };
}

export async function writeFileTool(
  input: {
    title: string;
    filename: string;
    kind: "html" | "markdown";
    mode: ArtifactMode;
    brief: string;
    page_count?: number;
  },
  { context, toolCallId, abortSignal }: { context: ToolContext; toolCallId: string; abortSignal?: AbortSignal },
) {
  const filename = safeFilename(input.filename);
  const signal = combinedSignal(abortSignal);
  try {
    const tools = await buildArtifactTextModel(context.userId, context.providerId);
    if (input.kind === "markdown") {
      const result = streamText({
        model: tools.model,
        maxOutputTokens: ARTIFACT_MODEL_OUTPUT_TOKENS,
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
      blockContent: (block) => generateBlock({ block, mode: input.mode, theme: outline.theme, outline: outline.blocks, artifactBrief: input.brief, tools, abortSignal: signal }),
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
  { context, toolCallId, abortSignal }: { context: ToolContext; toolCallId: string; abortSignal?: AbortSignal },
) {
  const signal = combinedSignal(abortSignal);
  try {
    const current = await getDocument(context.userId, input.document_id);
    if (current.kind !== "artifact") return { ok: false, error: `file ${input.document_id} is not editable` };
    const isHtml = current.mime_type === "text/html" || current.filename.toLowerCase().endsWith(".html");
    const tools = await buildArtifactTextModel(context.userId, context.providerId);
    if (!isHtml) {
      const result = streamText({
        model: tools.model,
        maxOutputTokens: ARTIFACT_MODEL_OUTPUT_TOKENS,
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
    const actions = new Map(edit.blocks.map((block) => [block.id, block]));
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
      blockContent: async (block) => {
        const action = actions.get(block.id)!;
        const source = action.sourceId ? byId.get(action.sourceId) : undefined;
        if (action.action === "reuse") {
          if (!source) throw new Error(`reuse block ${block.id} has no valid sourceId`);
          return source.html;
        }
        return generateBlock({
          block,
          mode,
          theme: edit.theme,
          outline: blocks,
          artifactBrief: input.brief,
          tools,
          abortSignal: signal,
          currentHtml: action.action === "revise" ? source?.html : undefined,
          changeBrief: input.brief,
        });
      },
    });
  } catch (error) {
    if (abortSignal?.aborted) throw error;
    console.error("[chat-agent] edit_file failed", { toolCallId, documentId: input.document_id, error });
    return { ok: false, error: String(error).slice(0, 500) };
  }
}
