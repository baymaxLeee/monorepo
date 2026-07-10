import { getWorkflowMetadata } from "workflow";
import { z } from "zod";

import { getSettings } from "../src/config.js";

import {
  isTaskCancelled,
  recordArtifactGeneration,
  reportTaskProgress,
} from "../src/tasks/notify.js";
import {
  cancelArtifactGeneration,
  failArtifactGeneration,
  listArtifactBlocks,
  publishArtifactRevision,
  reserveArtifactGeneration,
  saveArtifactBlock,
  saveArtifactPlan,
  getLatestArtifactWorkspace,
} from "../src/clients/knowledge.js";
import { compileArtifactHtml, validateArtifactHtml } from "../src/artifacts/compiler.js";
import {
  buildArtifactTextModel,
  generateBlock,
  isRetryableProviderError,
  planArtifact,
  type ArtifactBlock,
  type ArtifactMode,
  type ArtifactTheme,
} from "../src/artifacts/generator.js";
import { observeTaskCancellation } from "../src/tasks/cancellation.js";

export const htmlArtifactInputSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  conversationId: z.string().optional(),
  providerId: z.string().min(1),
  title: z.string().min(1).max(120),
  filename: z.string().min(1).max(160),
  mode: z.enum(["document", "presentation", "dashboard"]).default("document"),
  brief: z.string().min(1).max(20_000),
  pageCount: z.number().int().min(1).max(100).optional(),
  documentId: z.string().max(32).optional(),
  blockIds: z.array(z.string()).max(100).optional(),
  blockBriefs: z.record(z.string(), z.string().min(1).max(8_000)).optional(),
  idempotencyKey: z.string().min(1).max(120).optional(),
});
export type HtmlArtifactInput = z.infer<typeof htmlArtifactInputSchema>;

type BlockAction = "generate" | "reuse" | "revise";
type BlockStrategy = { id: string; action: BlockAction; sourceId?: string; changeBrief?: string };

type ArtifactPlan = {
  mode: ArtifactMode;
  theme: ArtifactTheme;
  blocks: ArtifactBlock[];
  blockStrategies?: BlockStrategy[];
  sourceHtmlById?: Record<string, string>;
};

function parseStoredBlockHtml(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { html?: unknown };
    return typeof parsed.html === "string" ? parsed.html : null;
  } catch {
    return null;
  }
}

async function planStep(input: HtmlArtifactInput): Promise<ArtifactPlan> {
  "use step";
  const tools = await buildArtifactTextModel(input.providerId, input.orgId);
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  const signal = AbortSignal.any([
    cancellation.signal,
    AbortSignal.timeout(5 * 60_000),
  ]);

  try {
    if (!input.documentId) {
      const outline = await planArtifact({
        title: input.title,
        mode: input.mode,
        brief: input.brief,
        pageCount: input.pageCount,
        model: tools.model,
        abortSignal: signal,
      });
      return { mode: input.mode, theme: outline.theme, blocks: outline.blocks };
    }

    const workspace = await getLatestArtifactWorkspace(input.userId, input.documentId);
    const manifest = workspace.manifest as Record<string, unknown>;
    const manifestBlocks = Array.isArray(manifest.blocks) ? (manifest.blocks as ArtifactBlock[]) : [];
    const metaById = new Map(manifestBlocks.map((block) => [block.id, block]));
    const sourceHtmlById: Record<string, string> = {};
    const existing = workspace.blocks
      .map((stored) => {
        const html = parseStoredBlockHtml(stored.content);
        if (html == null) return null;
        sourceHtmlById[stored.id] = html;
        const meta = metaById.get(stored.id);
        return { id: stored.id, type: meta?.type ?? stored.type, title: meta?.title ?? stored.id, brief: meta?.brief ?? "" };
      })
      .filter((block): block is ArtifactBlock => block != null);

    const briefById = input.blockBriefs ?? {};
    const targeted = input.blockIds?.length
      ? new Set(input.blockIds)
      : Object.keys(briefById).length
        ? new Set(Object.keys(briefById))
        : null;
    const blocks = existing;
    const blockStrategies: BlockStrategy[] = existing.map((block) => ({
      id: block.id,
      action: targeted && !targeted.has(block.id) ? "reuse" : "revise",
      sourceId: block.id,
      changeBrief: briefById[block.id],
    }));
    const themeParsed = manifest.theme as ArtifactTheme | undefined;
    const theme: ArtifactTheme = themeParsed?.visualDirection
      ? themeParsed
      : { visualDirection: "Keep the existing document's established visual direction.", accent: "#2563eb" };
    const mode = manifest.mode === "presentation" || manifest.mode === "dashboard" ? manifest.mode : "document";
    return { mode, theme, blocks, blockStrategies, sourceHtmlById };
  } finally {
    cancellation.dispose();
  }
}

async function reserveStep(input: HtmlArtifactInput, plan: ArtifactPlan, idempotencyKey: string) {
  "use step";
  const generation = await reserveArtifactGeneration({
    userId: input.userId,
    orgId: input.orgId,
    conversationId: input.conversationId,
    documentId: input.documentId,
    title: input.title,
    filename: input.filename,
    mode: plan.mode,
    brief: input.brief,
    idempotencyKey,
  });
  await saveArtifactPlan({
    userId: input.userId,
    generationId: generation.id,
    manifest: { schemaVersion: 2, mode: plan.mode, theme: plan.theme, blocks: plan.blocks },
    blocks: plan.blocks.map((block) => ({ id: block.id, type: block.type })),
  });
  const { workflowRunId } = getWorkflowMetadata();
  await recordArtifactGeneration(workflowRunId, generation.id);
  if (await isTaskCancelled(workflowRunId)) {
    await cancelArtifactGeneration({ userId: input.userId, generationId: generation.id });
    throw new DOMException("task cancelled", "AbortError");
  }
  return generation.id;
}

async function generateBlockStep(input: {
  orgId: string;
  userId: string;
  providerId: string;
  generationId: string;
  block: ArtifactBlock;
  mode: ArtifactMode;
  theme: ArtifactTheme;
  outline: ArtifactBlock[];
  artifactBrief: string;
  strategy?: BlockStrategy;
  sourceHtml?: string;
}): Promise<{ id: string; ok: boolean }> {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  try {
    const action = input.strategy?.action ?? "generate";

    if (action === "reuse") {
      if (!input.sourceHtml) throw new Error(`reuse block ${input.block.id} has no source html`);
      await saveArtifactBlock({
        userId: input.userId,
        generationId: input.generationId,
        blockId: input.block.id,
        content: JSON.stringify({ title: input.block.title, html: input.sourceHtml }),
        failed: false,
      });
      return { id: input.block.id, ok: true };
    }

    const tools = await buildArtifactTextModel(input.providerId, input.orgId);
    const abortSignal = AbortSignal.any([
      cancellation.signal,
      AbortSignal.timeout(5 * 60_000),
    ]);

    if (action === "revise") {
      // EDIT is strict: a failed revise must throw so the whole generation fails and the
      // previously published snapshot stays intact. Silently keeping the old block would
      // report success for an edit that never happened.
      const html = await generateBlock({
        block: input.block,
        mode: input.mode,
        theme: input.theme,
        outline: input.outline,
        artifactBrief: input.artifactBrief,
        tools,
        abortSignal,
        currentHtml: input.sourceHtml,
        changeBrief: input.strategy?.changeBrief ?? input.artifactBrief,
      });
      if (cancellation.signal.aborted || (await isTaskCancelled(workflowRunId))) {
        throw new DOMException("task cancelled", "AbortError");
      }
      await saveArtifactBlock({
        userId: input.userId,
        generationId: input.generationId,
        blockId: input.block.id,
        content: JSON.stringify({ title: input.block.title, html }),
        failed: false,
      });
      return { id: input.block.id, ok: true };
    }

    // CREATE degrades a single failed block to an error section so the rest still ship.
    let payload: string;
    let failed = false;
    try {
      const html = await generateBlock({
        block: input.block,
        mode: input.mode,
        theme: input.theme,
        outline: input.outline,
        artifactBrief: input.artifactBrief,
        tools,
        abortSignal,
      });
      payload = JSON.stringify({ title: input.block.title, html });
    } catch (error) {
      if (cancellation.signal.aborted) throw error;
      // Transient provider failures (429 / 5xx / network) must reach the WDK
      // step retry instead of being frozen into an error section — otherwise
      // raising concurrency just turns rate limits into permanent broken blocks.
      if (isRetryableProviderError(error)) throw error;
      console.error("[executor] block failed, degrading to error section", { blockId: input.block.id, error });
      payload = JSON.stringify({ title: input.block.title, error: String(error).slice(0, 500) });
      failed = true;
    }
    if (cancellation.signal.aborted || (await isTaskCancelled(workflowRunId))) {
      throw new DOMException("task cancelled", "AbortError");
    }
    await saveArtifactBlock({
      userId: input.userId,
      generationId: input.generationId,
      blockId: input.block.id,
      content: payload,
      failed,
    });
    return { id: input.block.id, ok: !failed };
  } finally {
    cancellation.dispose();
  }
}

type CompileArtifactInput = {
  userId: string;
  generationId: string;
  title: string;
  mode: ArtifactMode;
  theme: ArtifactTheme;
  blocks: ArtifactBlock[];
};

async function compileArtifact(input: CompileArtifactInput) {
  const stored = await listArtifactBlocks(input.userId, input.generationId);
  const compiled = compileArtifactHtml({
    title: input.title,
    mode: input.mode,
    theme: input.theme,
    parts: input.blocks,
    stored,
  });
  if (compiled.partsOk === 0) {
    throw new Error(`artifact generation produced no usable blocks (${compiled.partsFailed} failed)`);
  }
  return compiled;
}

async function validateArtifactStep(input: CompileArtifactInput) {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  if (await isTaskCancelled(workflowRunId)) {
    throw new DOMException("task cancelled", "AbortError");
  }
  const compiled = await compileArtifact(input);
  const validation = validateArtifactHtml(compiled.html);
  if (!validation.ok) {
    throw new Error(
      `compiled artifact failed validation: ${[...validation.structuralErrors, ...validation.brokenInternalLinks].join("; ")}`,
    );
  }
  return {
    totalChars: compiled.html.length,
    blocksOk: compiled.partsOk,
    blocksFailed: compiled.partsFailed,
    validation,
  };
}

async function publishArtifactStep(input: CompileArtifactInput & { orgId: string }) {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  if (await isTaskCancelled(workflowRunId)) {
    throw new DOMException("task cancelled", "AbortError");
  }
  const compiled = await compileArtifact(input);
  const published = await publishArtifactRevision({
    userId: input.userId,
    orgId: input.orgId,
    generationId: input.generationId,
    compiledHtml: compiled.html,
  });
  return {
    documentId: published.document_id,
  };
}

async function reportProgressStep(done: number, total: number): Promise<void> {
  "use step";
  try {
    const { workflowRunId } = getWorkflowMetadata();
    await reportTaskProgress(workflowRunId, { done, total });
  } catch (error) {
    console.error("[executor] progress report failed (non-fatal)", { done, total, error });
  }
}

async function failStep(input: { userId: string; generationId: string; error: string }) {
  "use step";
  await failArtifactGeneration({
    userId: input.userId,
    generationId: input.generationId,
    error: input.error.slice(0, 4000),
  }).catch(() => undefined);
}

async function getHtmlBlockConcurrencyStep(): Promise<number> {
  "use step";
  return getSettings().htmlBlockConcurrency;
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

export async function htmlArtifactWorkflow(input: HtmlArtifactInput) {
  "use workflow";
  const blockConcurrency = await getHtmlBlockConcurrencyStep();
  const plan = await planStep(input);
  const generationId = await reserveStep(
    input,
    plan,
    input.idempotencyKey ?? `wf-${input.title}-${input.filename}`,
  );

  try {
    const strategiesById = new Map((plan.blockStrategies ?? []).map((s) => [s.id, s]));
    const total = plan.blocks.length;
    // Progress is best-effort UX, but each report is a durable step competing for
    // the same worker pool as block generation. Cap it to ~20 reports regardless
    // of block count so raising concurrency doesn't flood the queue with progress
    // jobs; the terminal block always reports.
    const progressEvery = Math.max(1, Math.ceil(total / 20));
    let done = 0;
    await reportProgressStep(done, total);
    await mapConcurrent(plan.blocks, blockConcurrency, async (block) => {
      const result = await generateBlockStep({
        orgId: input.orgId,
        userId: input.userId,
        providerId: input.providerId,
        generationId,
        block,
        mode: plan.mode,
        theme: plan.theme,
        outline: plan.blocks,
        artifactBrief: input.brief,
        strategy: strategiesById.get(block.id),
        sourceHtml: plan.sourceHtmlById?.[block.id],
      });
      done += 1;
      if (done === total || done % progressEvery === 0) {
        await reportProgressStep(done, total);
      }
      return result;
    });

    const validation = await validateArtifactStep({
      userId: input.userId,
      generationId,
      title: input.title,
      mode: plan.mode,
      theme: plan.theme,
      blocks: plan.blocks,
    });
    const published = await publishArtifactStep({
      userId: input.userId,
      orgId: input.orgId,
      generationId,
      title: input.title,
      mode: plan.mode,
      theme: plan.theme,
      blocks: plan.blocks,
    });

    return {
      ok: true as const,
      documentId: published.documentId,
      title: input.title,
      filename: input.filename,
      totalChars: validation.totalChars,
      blocksTotal: plan.blocks.length,
      blocksDone: validation.blocksOk,
      blocksFailed: validation.blocksFailed,
      validation: validation.validation,
    };
  } catch (error) {
    await failStep({ userId: input.userId, generationId, error: String(error) });
    throw error;
  }
}
