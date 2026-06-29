import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import {
  cancelArtifactGeneration,
  claimArtifactGeneration,
  failArtifactGeneration,
  getArtifactGeneration,
  getLatestArtifactWorkspace,
  listArtifactBlocks,
  publishArtifactRevision,
  renewArtifactGeneration,
  reserveArtifactGeneration,
  saveArtifactBlock,
  saveArtifactPlan,
  updateArtifactGenerationPhase,
  type ArtifactGenerationDetail,
} from "../../../clients/knowledge.js";
import {
  ARTIFACT_GENERATION_CONCURRENCY,
  ARTIFACT_GENERATION_POLL_MS,
  ARTIFACT_GENERATION_TIMEOUT,
} from "./config.js";
import { compileArtifactHtml } from "./compiler.js";
import { buildArtifactTextModel, generateBlock } from "./generator.js";
import type { ArtifactBlock, ArtifactMode, ArtifactTheme } from "./types.js";

export type BlockStrategy = {
  id: string;
  action: "generate" | "reuse" | "revise";
  sourceId?: string;
};

export type GenerationManifest = {
  schemaVersion: 2;
  mode: ArtifactMode;
  theme: ArtifactTheme;
  blocks: ArtifactBlock[];
  providerId: string;
  artifactBrief: string;
  blockStrategies?: BlockStrategy[];
  sourceDocumentId?: string;
};

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const WORKER_INSTANCE_ID = `${hostname()}:${process.pid}:${randomUUID()}`;
const CANCELLATION_POLL_MS = 1_000;

export function workerOwner(): string {
  return `worker:${WORKER_INSTANCE_ID}`;
}

function parseManifest(raw: Record<string, unknown> | null | undefined): GenerationManifest | null {
  if (!raw || raw.schemaVersion !== 2) return null;
  const mode = raw.mode;
  const theme = raw.theme;
  const blocks = raw.blocks;
  const providerId = raw.providerId;
  const artifactBrief = raw.artifactBrief;
  if (
    (mode !== "document" && mode !== "presentation" && mode !== "dashboard") ||
    !theme || typeof theme !== "object" ||
    !Array.isArray(blocks) || typeof providerId !== "string" ||
    typeof artifactBrief !== "string"
  ) {
    return null;
  }
  return {
    schemaVersion: 2,
    mode,
    theme: theme as ArtifactTheme,
    blocks: blocks as ArtifactBlock[],
    providerId,
    artifactBrief,
    blockStrategies: Array.isArray(raw.blockStrategies) ? raw.blockStrategies as BlockStrategy[] : undefined,
    sourceDocumentId: typeof raw.sourceDocumentId === "string" ? raw.sourceDocumentId : undefined,
  };
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

function combinedSignal(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const timeout = AbortSignal.timeout(ARTIFACT_GENERATION_TIMEOUT.totalMs);
  return AbortSignal.any([
    timeout,
    ...signals.filter((signal): signal is AbortSignal => signal != null),
  ]);
}

export async function enqueueHtmlArtifactGeneration(input: {
  userId: string;
  conversationId: string;
  runId: string;
  toolCallId: string;
  providerId: string;
  title: string;
  filename: string;
  mode: ArtifactMode;
  brief: string;
  theme: ArtifactTheme;
  blocks: ArtifactBlock[];
  documentId?: string;
  resumeJobId?: string;
  blockStrategies?: BlockStrategy[];
  sourceDocumentId?: string;
}) {
  const generation = await reserveArtifactGeneration({
    userId: input.userId,
    conversationId: input.conversationId,
    documentId: input.documentId,
    title: input.title,
    filename: input.filename,
    mode: input.mode,
    brief: input.brief,
    idempotencyKey: input.toolCallId,
    runId: input.runId,
    toolCallId: input.toolCallId,
    resumeGenerationId: input.resumeJobId,
  });
  await saveArtifactPlan({
    userId: input.userId,
    generationId: generation.id,
    manifest: {
      schemaVersion: 2,
      mode: input.mode,
      theme: input.theme,
      blocks: input.blocks,
      providerId: input.providerId,
      artifactBrief: input.brief,
      blockStrategies: input.blockStrategies,
      sourceDocumentId: input.sourceDocumentId,
    },
    blocks: input.blocks.map((block) => ({ id: block.id, type: block.type, brief: block.brief })),
  });
  return generation;
}

export async function waitForArtifactGeneration(input: {
  userId: string;
  generationId: string;
  abortSignal?: AbortSignal;
}): Promise<ArtifactGenerationDetail> {
  const signal = input.abortSignal;
  while (true) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
    const generation = await getArtifactGeneration(input.userId, input.generationId);
    if (TERMINAL_STATUSES.has(generation.status)) return generation;
    await new Promise((resolve) => setTimeout(resolve, ARTIFACT_GENERATION_POLL_MS));
  }
}

function generationResult(generation: ArtifactGenerationDetail, published: {
  document_id: string;
  revision_id: string;
  title: string;
  filename: string;
  total_chars: number;
}, compiled: { partsOk: number; partsFailed: number }, blockCount: number) {
  return {
    ok: true as const,
    status: "persisted" as const,
    document_id: published.document_id,
    revision_id: published.revision_id,
    title: published.title,
    filename: published.filename,
    kind: "html" as const,
    total_chars: published.total_chars,
    blocks_total: blockCount,
    blocks_done: compiled.partsOk,
    blocks_failed: compiled.partsFailed,
    generation_id: generation.id,
    attempt: generation.attempt,
  };
}

export async function runArtifactGeneration(input: {
  userId: string;
  generationId: string;
  owner: string;
  title: string;
  filename: string;
  manifest: GenerationManifest;
  abortSignal?: AbortSignal;
  sourceHtmlById?: Map<string, string>;
}) {
  const cancellationController = new AbortController();
  const signal = combinedSignal(input.abortSignal, cancellationController.signal);
  let checkingCancellation = false;
  const cancellationPoll = setInterval(() => {
    if (checkingCancellation || signal.aborted) return;
    checkingCancellation = true;
    void getArtifactGeneration(input.userId, input.generationId)
      .then((generation) => {
        if (["cancel_requested", "cancelled"].includes(generation.status)) {
          cancellationController.abort(
            new DOMException("artifact generation cancelled", "AbortError"),
          );
        }
      })
      .catch((error) => {
        console.error("[artifact-worker] cancellation poll failed", error);
      })
      .finally(() => {
        checkingCancellation = false;
      });
  }, CANCELLATION_POLL_MS);
  const heartbeat = setInterval(() => {
    void renewArtifactGeneration({
      userId: input.userId,
      generationId: input.generationId,
      owner: input.owner,
    }).catch((error) => console.error("[artifact-worker] lease renewal failed", error));
  }, 30_000);
  try {
    const tools = await buildArtifactTextModel(input.userId, input.manifest.providerId);
    const strategies = new Map((input.manifest.blockStrategies ?? []).map((row) => [row.id, row]));
    const readyBeforeRun = await listArtifactBlocks(input.userId, input.generationId);
    const readyIds = new Set(readyBeforeRun.map((block) => block.id));
    await mapConcurrent(input.manifest.blocks, ARTIFACT_GENERATION_CONCURRENCY, async (block, index) => {
      if (readyIds.has(block.id)) return;
      const strategy = strategies.get(block.id);
      let payload: string;
      let failed = false;
      try {
        let html: string;
        if (strategy?.action === "reuse") {
          const sourceId = strategy.sourceId ?? block.id;
          const reused = input.sourceHtmlById?.get(sourceId);
          if (!reused) throw new Error(`reuse block ${block.id} has no source html`);
          html = reused;
        } else {
          try {
            html = await generateBlock({
              block,
              mode: input.manifest.mode,
              theme: input.manifest.theme,
              outline: input.manifest.blocks,
              artifactBrief: input.manifest.artifactBrief,
              tools,
              abortSignal: signal,
              currentHtml: strategy?.action === "revise"
                ? input.sourceHtmlById?.get(strategy.sourceId ?? block.id)
                : undefined,
              changeBrief: input.manifest.artifactBrief,
            });
          } catch (error) {
            if (signal.aborted) throw error;
            const fallback = strategy?.action === "revise"
              ? input.sourceHtmlById?.get(strategy.sourceId ?? block.id)
              : undefined;
            if (fallback) {
              console.error("[artifact-worker] revise failed, keeping original block", { blockId: block.id, error });
              html = fallback;
            } else {
              throw error;
            }
          }
        }
        payload = JSON.stringify({ title: block.title, html });
      } catch (error) {
        if (signal.aborted) throw error;
        console.error("[artifact-worker] block failed, degrading to error section", {
          blockId: block.id,
          error,
        });
        payload = JSON.stringify({ title: block.title, error: String(error).slice(0, 500) });
        failed = true;
      }
      await saveArtifactBlock({
        userId: input.userId,
        generationId: input.generationId,
        blockId: block.id,
        content: payload,
        failed,
      });
    });
    const stored = await listArtifactBlocks(input.userId, input.generationId);
    if (stored.length !== input.manifest.blocks.length) {
      throw new Error(`artifact incomplete: expected ${input.manifest.blocks.length} blocks, found ${stored.length}`);
    }
    await updateArtifactGenerationPhase({
      userId: input.userId,
      generationId: input.generationId,
      owner: input.owner,
      phase: "compiling",
    });
    const compiled = compileArtifactHtml({
      title: input.title,
      mode: input.manifest.mode,
      theme: input.manifest.theme,
      parts: input.manifest.blocks,
      stored,
    });
    if (compiled.partsOk === 0) {
      throw new Error(`artifact generation produced no usable blocks (${compiled.partsFailed} failed)`);
    }
    await updateArtifactGenerationPhase({
      userId: input.userId,
      generationId: input.generationId,
      owner: input.owner,
      phase: "publishing",
    });
    const published = await publishArtifactRevision({
      userId: input.userId,
      generationId: input.generationId,
      compiledHtml: compiled.html,
    });
    const generation = await getArtifactGeneration(input.userId, input.generationId);
    return generationResult(generation, published, compiled, input.manifest.blocks.length);
  } catch (error) {
    if (signal.aborted) {
      await cancelArtifactGeneration({
        userId: input.userId,
        generationId: input.generationId,
        owner: input.owner,
      }).catch(() => undefined);
    } else {
      await failArtifactGeneration({
        userId: input.userId,
        generationId: input.generationId,
        owner: input.owner,
        error: String(error).slice(0, 4000),
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    clearInterval(cancellationPoll);
    clearInterval(heartbeat);
  }
}

export async function processClaimableArtifactJob(job: {
  id: string;
  user_id: string;
  title: string;
  filename: string;
  brief: string;
}) {
  const owner = workerOwner();
  try {
    await claimArtifactGeneration({ userId: job.user_id, generationId: job.id, owner });
  } catch {
    return;
  }
  const detail = await getArtifactGeneration(job.user_id, job.id);
  const manifest = parseManifest(detail.manifest);
  if (!manifest) {
    await failArtifactGeneration({
      userId: job.user_id,
      generationId: job.id,
      owner,
      error: "artifact manifest is missing or invalid",
    }).catch(() => undefined);
    return;
  }
  let sourceHtmlById: Map<string, string> | undefined;
  if (manifest.sourceDocumentId && manifest.blockStrategies?.some((row) => row.action !== "generate")) {
    try {
      const workspace = await getLatestArtifactWorkspace(job.user_id, manifest.sourceDocumentId);
      sourceHtmlById = new Map(workspace.blocks.map((block) => {
        const parsed = JSON.parse(block.content) as { html?: unknown };
        return [block.id, typeof parsed.html === "string" ? parsed.html : ""] as const;
      }));
    } catch (error) {
      console.error("[artifact-worker] failed to load source workspace", error);
    }
  }
  await runArtifactGeneration({
    userId: job.user_id,
    generationId: job.id,
    owner,
    title: job.title,
    filename: job.filename,
    manifest,
    sourceHtmlById,
  }).catch((error) => {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.error("[artifact-worker] job failed", { generationId: job.id, error });
    }
  });
}

export async function runArtifactGenerationInline(input: {
  userId: string;
  conversationId: string;
  runId: string;
  toolCallId: string;
  providerId: string;
  title: string;
  filename: string;
  mode: ArtifactMode;
  brief: string;
  theme: ArtifactTheme;
  blocks: ArtifactBlock[];
  documentId?: string;
  resumeJobId?: string;
  blockStrategies?: BlockStrategy[];
  sourceHtmlById?: Map<string, string>;
  sourceDocumentId?: string;
  abortSignal?: AbortSignal;
}) {
  const generation = await enqueueHtmlArtifactGeneration(input);
  const owner = `${process.pid}:${input.runId}`;
  await claimArtifactGeneration({ userId: input.userId, generationId: generation.id, owner });
  const manifest = parseManifest({
    schemaVersion: 2,
    mode: input.mode,
    theme: input.theme,
    blocks: input.blocks,
    providerId: input.providerId,
    artifactBrief: input.brief,
    blockStrategies: input.blockStrategies,
    sourceDocumentId: input.sourceDocumentId,
  })!;
  return runArtifactGeneration({
    userId: input.userId,
    generationId: generation.id,
    owner,
    title: input.title,
    filename: input.filename,
    manifest,
    abortSignal: input.abortSignal,
    sourceHtmlById: input.sourceHtmlById,
  });
}

export async function runArtifactGenerationDetached(input: {
  userId: string;
  conversationId: string;
  runId: string;
  toolCallId: string;
  providerId: string;
  title: string;
  filename: string;
  mode: ArtifactMode;
  brief: string;
  theme: ArtifactTheme;
  blocks: ArtifactBlock[];
  documentId?: string;
  resumeJobId?: string;
  blockStrategies?: BlockStrategy[];
  sourceHtmlById?: Map<string, string>;
  sourceDocumentId?: string;
  abortSignal?: AbortSignal;
}) {
  const generation = await enqueueHtmlArtifactGeneration(input);
  const terminal = await waitForArtifactGeneration({
    userId: input.userId,
    generationId: generation.id,
    abortSignal: input.abortSignal,
  });
  if (terminal.status === "cancelled") {
    throw new DOMException("artifact generation cancelled", "AbortError");
  }
  if (terminal.status === "failed") {
    throw new Error(terminal.error ?? "artifact generation failed");
  }
  const workspace = await getLatestArtifactWorkspace(input.userId, terminal.document_id);
  return {
    ok: true as const,
    status: "persisted" as const,
    document_id: terminal.document_id,
    revision_id: workspace.revision_id,
    title: terminal.title ?? input.title,
    filename: terminal.filename ?? input.filename,
    kind: "html" as const,
    total_chars: workspace.blocks.reduce((sum, block) => sum + block.content.length, 0),
    blocks_total: terminal.total_blocks,
    blocks_done: terminal.completed_blocks,
    blocks_failed: terminal.failed_blocks,
    generation_id: terminal.id,
    attempt: terminal.attempt,
  };
}
