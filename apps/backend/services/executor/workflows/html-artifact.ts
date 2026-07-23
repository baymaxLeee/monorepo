import { getWorkflowMetadata } from "workflow";
import { z } from "zod";

import { getSettings } from "../src/bootstrap/config.js";

import {
  isTaskCancelled,
  recordArtifactGeneration,
  reportTaskProgress,
} from "../src/application/tasks/notify.js";
import {
  cancelArtifactGeneration,
  failArtifactGeneration,
  listArtifactBlocks,
  publishArtifactRevision,
  reserveArtifactGeneration,
  saveArtifactBlock,
  saveArtifactPlan,
  getLatestArtifactWorkspace,
} from "../src/infrastructure/clients/knowledge.js";
import { compileArtifactHtml } from "../src/application/artifacts/compiler.js";
import {
  buildArtifactTextModel,
  generateBlock,
  isRetryableProviderError,
  type ArtifactBlock,
  type ArtifactMode,
  type ArtifactTheme,
} from "../src/application/artifacts/generator.js";
import { observeTaskCancellation } from "../src/application/tasks/cancellation.js";
import { rethrowTerminalArtifactError } from "../src/application/tasks/errors.js";

export const htmlArtifactPlanSchema = z.object({
  mode: z.enum(["document", "presentation", "dashboard"]),
  sourceBrief: z.string().min(1).max(20_000),
  theme: z.object({
    visualDirection: z.string().min(1).max(1_200),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
    appearance: z.enum(["light", "dark"]),
  }),
  narrative: z.string().min(1).max(1_500),
  blocks: z.array(z.object({
    title: z.string().min(1).max(160),
    brief: z.string().min(1).max(4_000),
    layout: z.string().min(1).max(400),
    contentScope: z.array(z.string().min(1).max(240)).min(1),
    acceptanceCriteria: z.array(z.string().min(1).max(320)).min(1),
  })).min(1).max(100),
});
export type HtmlArtifactPlanInput = z.infer<typeof htmlArtifactPlanSchema>;

export const htmlArtifactInputSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  conversationId: z.string().optional(),
  providerId: z.string().min(1),
  title: z.string().min(1).max(120),
  filename: z.string().min(1).max(160),
  plan: htmlArtifactPlanSchema.optional(),
  brief: z.string().min(1).max(12_000).optional(),
  documentId: z.string().max(32).optional(),
  blockIds: z.array(z.string()).max(100).optional(),
  blockBriefs: z.record(z.string(), z.string().min(1).max(8_000)).optional(),
  expectedObjectSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  idempotencyKey: z.string().min(1).max(120).optional(),
}).superRefine((input, ctx) => {
  if (input.documentId) {
    if (!input.brief) ctx.addIssue({ code: "custom", path: ["brief"], message: "brief is required for revisions" });
    if (input.plan) ctx.addIssue({ code: "custom", path: ["plan"], message: "plan is only valid for new artifacts" });
    return;
  }
  if (!input.plan) ctx.addIssue({ code: "custom", path: ["plan"], message: "plan is required for new HTML artifacts" });
  if (input.brief) ctx.addIssue({ code: "custom", path: ["brief"], message: "brief is represented by plan.sourceBrief for new artifacts" });
});
export type HtmlArtifactInput = z.infer<typeof htmlArtifactInputSchema>;

type BlockAction = "generate" | "reuse" | "revise" | "regenerate";
type BlockStrategy = { id: string; action: BlockAction; sourceId?: string; changeBrief?: string };

type ArtifactPlan = {
  mode: ArtifactMode;
  theme: ArtifactTheme;
  narrative: string;
  blocks: ArtifactBlock[];
  reviewBrief: string;
  blockStrategies?: BlockStrategy[];
  baseRevisionId?: string;
  sourceVersionById?: Record<string, string>;
  sourceHtmlById?: Record<string, string>;
  sourceFailedById?: Record<string, boolean>;
};

const LEGACY_ARTIFACT_NARRATIVE =
  "Maintain a coherent progression through the existing document while preserving each block's established intent.";
const LEGACY_BLOCK_LAYOUT = "Preserve the current block composition unless the current change request requires another layout.";

function materializeChatPlan(plan: HtmlArtifactPlanInput): ArtifactPlan {
  return {
    mode: plan.mode,
    theme: plan.theme,
    narrative: plan.narrative,
    reviewBrief: plan.sourceBrief,
    blocks: plan.blocks.map((block, index) => ({
      id: `page-${index + 1}`,
      type: plan.mode === "presentation" ? "slide" : "section",
      ...block,
    })),
  };
}

function parseStoredBlock(content: string): { html: string | null; error?: string; failed: boolean } {
  try {
    const parsed = JSON.parse(content) as { html?: unknown; error?: unknown };
    const html = typeof parsed.html === "string" ? parsed.html : null;
    const error = typeof parsed.error === "string" ? parsed.error : undefined;
    return { html, error, failed: html == null && Boolean(error) };
  } catch {
    return { html: null, failed: true };
  }
}

async function planStep(input: HtmlArtifactInput): Promise<ArtifactPlan> {
  "use step";
  if (!input.documentId) return materializeChatPlan(input.plan!);
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);

  try {
    const workspace = await getLatestArtifactWorkspace(input.userId, input.documentId);
    const manifest = workspace.manifest as Record<string, unknown>;
    const manifestBlocks = Array.isArray(manifest.blocks) ? (manifest.blocks as ArtifactBlock[]) : [];
    const metaById = new Map(manifestBlocks.map((block) => [block.id, block]));
    const sourceHtmlById: Record<string, string> = {};
    const sourceVersionById: Record<string, string> = {};
    const sourceFailedById: Record<string, boolean> = {};

    for (const stored of workspace.blocks) {
      sourceVersionById[stored.id] = stored.version_id;
      const parsed = parseStoredBlock(stored.content);
      sourceFailedById[stored.id] = parsed.failed;
      if (parsed.html != null) sourceHtmlById[stored.id] = parsed.html;
    }

    const briefById = input.blockBriefs ?? {};
    const targeted = input.blockIds?.length
      ? new Set(input.blockIds)
      : Object.keys(briefById).length
        ? new Set(Object.keys(briefById))
        : null;

    const blocks: ArtifactBlock[] = manifestBlocks.length
      ? manifestBlocks.map((block) => ({
          id: block.id,
          type: block.type,
          title: block.title,
          brief: block.brief ?? "",
          layout: block.layout?.trim() || LEGACY_BLOCK_LAYOUT,
          contentScope: block.contentScope ?? [block.title],
          acceptanceCriteria: block.acceptanceCriteria ?? ["Preserve the block's facts and intent."],
        }))
      : workspace.blocks.map((stored) => {
          const meta = metaById.get(stored.id);
          return {
            id: stored.id,
            type: meta?.type ?? stored.type,
            title: meta?.title ?? stored.id,
            brief: meta?.brief ?? "",
            layout: meta?.layout?.trim() || LEGACY_BLOCK_LAYOUT,
            contentScope: meta?.contentScope ?? [meta?.title ?? stored.id],
            acceptanceCriteria: meta?.acceptanceCriteria ?? ["Preserve the block's facts and intent."],
          };
        });

    const blockStrategies: BlockStrategy[] = blocks.map((block) => {
      const isTargeted = targeted ? targeted.has(block.id) : true;
      if (!isTargeted) {
        return { id: block.id, action: "reuse" };
      }
      if (sourceFailedById[block.id]) {
        return {
          id: block.id,
          action: "regenerate",
          changeBrief: briefById[block.id] ?? input.brief!,
        };
      }
      if (sourceHtmlById[block.id]) {
        return {
          id: block.id,
          action: "revise",
          sourceId: block.id,
          changeBrief: briefById[block.id] ?? input.brief!,
        };
      }
      return { id: block.id, action: "generate", changeBrief: briefById[block.id] };
    });

    const themeParsed = manifest.theme as Partial<ArtifactTheme> | undefined;
    const theme: ArtifactTheme = themeParsed?.visualDirection
      ? {
          visualDirection: themeParsed.visualDirection,
          accent: themeParsed.accent ?? "#2563eb",
          appearance: themeParsed.appearance === "dark" ? "dark" : "light",
        }
      : {
          visualDirection: "Keep the existing document's established visual direction.",
          accent: "#2563eb",
          appearance: "light",
        };
    const mode = manifest.mode === "presentation" || manifest.mode === "dashboard" ? manifest.mode : "document";
    const narrative =
      typeof manifest.narrative === "string" && manifest.narrative.trim()
        ? manifest.narrative.trim()
        : LEGACY_ARTIFACT_NARRATIVE;
    return {
      mode,
      theme,
      narrative,
      blocks,
      reviewBrief: [
        typeof manifest.artifactBrief === "string" ? manifest.artifactBrief : "",
        `Current revision request: ${input.brief!}`,
      ].filter(Boolean).join("\n"),
      blockStrategies,
      baseRevisionId: workspace.revision_id,
      sourceVersionById,
      sourceHtmlById,
      sourceFailedById,
    };
  } finally {
    cancellation.dispose();
  }
}

async function reserveStep(input: HtmlArtifactInput, plan: ArtifactPlan, idempotencyKey: string) {
  "use step";
  try {
    const generation = await reserveArtifactGeneration({
      userId: input.userId,
      orgId: input.orgId,
      conversationId: input.conversationId,
      documentId: input.documentId,
      title: input.title,
      filename: input.filename,
      mode: plan.mode,
      brief: input.plan?.sourceBrief ?? input.brief!,
      idempotencyKey,
      baseRevisionId: plan.baseRevisionId,
    });
    await saveArtifactPlan({
      userId: input.userId,
      generationId: generation.id,
      manifest: {
        artifactBrief: plan.reviewBrief,
        mode: plan.mode,
        theme: plan.theme,
        narrative: plan.narrative,
        blocks: plan.blocks,
      },
      blocks: plan.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        sourceVersionId:
          plan.blockStrategies?.find((strategy) => strategy.id === block.id)?.action === "reuse"
            ? plan.sourceVersionById?.[block.id]
            : undefined,
      })),
    });
    const { workflowRunId } = getWorkflowMetadata();
    await recordArtifactGeneration(workflowRunId, generation.id);
    if (await isTaskCancelled(workflowRunId)) {
      await cancelArtifactGeneration({ userId: input.userId, generationId: generation.id });
      throw new DOMException("task cancelled", "AbortError");
    }
    return generation.id;
  } catch (error) {
    rethrowTerminalArtifactError(error);
  }
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
  narrative: string;
  artifactBrief: string;
  strategy?: BlockStrategy;
  sourceVersionId?: string;
  sourceHtml?: string;
  sourceFailed?: boolean;
}): Promise<{ id: string; ok: boolean }> {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  try {
    const action = input.strategy?.action ?? "generate";

    if (action === "reuse") {
      if (!input.sourceVersionId) {
        throw new Error(`reuse block ${input.block.id} has no source version`);
      }
      return { id: input.block.id, ok: !(input.sourceFailed ?? false) };
    }

    const tools = await buildArtifactTextModel(input.providerId, input.orgId);
    const abortSignal = AbortSignal.any([
      cancellation.signal,
      AbortSignal.timeout(5 * 60_000),
    ]);

    if (action === "revise") {
      const html = await generateBlock({
        block: input.block,
        mode: input.mode,
        theme: input.theme,
        outline: input.outline,
        narrative: input.narrative,
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

    let payload: string;
    let failed = false;
    try {
      const html = await generateBlock({
        block: input.block,
        mode: input.mode,
        theme: input.theme,
        outline: input.outline,
        narrative: input.narrative,
        artifactBrief: input.artifactBrief,
        tools,
        abortSignal,
        changeBrief: input.strategy?.changeBrief,
      });
      payload = JSON.stringify({ title: input.block.title, html });
    } catch (error) {
      if (cancellation.signal.aborted) throw error;
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
  } catch (error) {
    rethrowTerminalArtifactError(error);
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

async function compilePublishStep(
  input: CompileArtifactInput & {
    orgId: string;
    expectedObjectSha256?: string;
  },
) {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  if (await isTaskCancelled(workflowRunId)) {
    throw new DOMException("task cancelled", "AbortError");
  }
  try {
    const compiled = await compileArtifact(input);
    const published = await publishArtifactRevision({
      userId: input.userId,
      orgId: input.orgId,
      generationId: input.generationId,
      compiledHtml: compiled.html,
      expectedObjectSha256: input.expectedObjectSha256,
    });
    return {
      documentId: published.document_id,
      totalChars: compiled.html.length,
      blocksOk: compiled.partsOk,
      blocksFailed: compiled.partsFailed,
    };
  } catch (error) {
    rethrowTerminalArtifactError(error);
  }
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

function blockActionBuckets(
  strategies: BlockStrategy[] | undefined,
): {
  reused: string[];
  revised: string[];
  regenerated: string[];
  generated: string[];
} {
  const reused: string[] = [];
  const revised: string[] = [];
  const regenerated: string[] = [];
  const generated: string[] = [];
  for (const strategy of strategies ?? []) {
    if (strategy.action === "reuse") reused.push(strategy.id);
    else if (strategy.action === "revise") revised.push(strategy.id);
    else if (strategy.action === "regenerate") regenerated.push(strategy.id);
    else generated.push(strategy.id);
  }
  return { reused, revised, regenerated, generated };
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
    const progressEvery = Math.max(1, Math.ceil(total / 20));
    let done = 0;
    await reportProgressStep(done, total);
    await mapConcurrent(plan.blocks, blockConcurrency, async (block) => {
      const strategy = strategiesById.get(block.id);
      const result = await generateBlockStep({
        orgId: input.orgId,
        userId: input.userId,
        providerId: input.providerId,
        generationId,
        block,
        mode: plan.mode,
        theme: plan.theme,
        outline: plan.blocks,
        narrative: plan.narrative,
        artifactBrief: plan.reviewBrief,
        strategy,
        sourceVersionId: plan.sourceVersionById?.[block.id],
        sourceHtml: plan.sourceHtmlById?.[block.id],
        sourceFailed: plan.sourceFailedById?.[block.id],
      });
      done += 1;
      if (done === total || done % progressEvery === 0) {
        await reportProgressStep(done, total);
      }
      return result;
    });

    const published = await compilePublishStep({
      userId: input.userId,
      orgId: input.orgId,
      generationId,
      title: input.title,
      mode: plan.mode,
      theme: plan.theme,
      blocks: plan.blocks,
      expectedObjectSha256: input.expectedObjectSha256,
    });
    const buckets = blockActionBuckets(plan.blockStrategies);

    return {
      ok: true as const,
      documentId: published.documentId,
      title: input.title,
      filename: input.filename,
      totalChars: published.totalChars,
      blocksTotal: plan.blocks.length,
      blocksDone: published.blocksOk,
      blocksFailed: published.blocksFailed,
      reusedBlockIds: buckets.reused,
      revisedBlockIds: buckets.revised,
      regeneratedBlockIds: buckets.regenerated,
      generatedBlockIds: buckets.generated,
    };
  } catch (error) {
    await failStep({ userId: input.userId, generationId, error: String(error) });
    throw error;
  }
}
