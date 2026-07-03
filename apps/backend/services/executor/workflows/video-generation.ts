import { getWorkflowMetadata } from "workflow";
import { z } from "zod";

import { reportTaskProgress } from "../src/tasks/notify.js";
import { getProvider } from "../src/clients/admin.js";
import { createMediaDocument } from "../src/clients/knowledge.js";
import {
  createArkVideoTask,
  getArkVideoTask,
  type ArkVideoSnapshot,
} from "../src/clients/ark.js";
import {
  buildScenePrompt,
  buildVideoTextModel,
  generateCharacterAnchor,
  planStoryboard,
  type Scene,
  type Storyboard,
} from "../src/video/storyboard.js";
import { assembleClips } from "../src/video/assembler.js";

export const videoGenerationInputSchema = z.object({
  userId: z.string().min(1),
  conversationId: z.string().optional(),
  // The video model (Volcengine Ark Seedance) that renders each scene clip.
  providerId: z.string().min(1),
  // The text model that writes the short-drama storyboard. Required: Seedance is
  // video-only and cannot plan the shot list.
  textProviderId: z.string().min(1),
  // Optional image model (Seedream) for a best-effort single subject-anchor
  // image; when absent, scenes fall back to text-only generation.
  imageProviderId: z.string().optional(),
  prompt: z.string().min(1).max(4000),
  // Target total length in whole seconds. Vertical short-drama 投流 is short and
  // cheap by design, so this is capped at 120s (not a long-form cinema tool).
  targetDurationSec: z.number().int().min(4).max(120).optional(),
  // Per-scene clip length; clamped to the stable 4–8s window in the planner
  // (not the model's full 4–15s) to avoid temporal-decay repetition.
  clipSeconds: z.number().int().optional(),
  title: z.string().min(1).max(120),
  filename: z.string().min(1).max(160),
  idempotencyKey: z.string().min(1).max(120).optional(),
});
export type VideoGenerationInput = z.infer<typeof videoGenerationInputSchema>;

const DEFAULT_TARGET_DURATION_S = 50;
// Per-scene clip length. Kept in the stable window (<= 8s in storyboard.ts) to
// avoid the temporal-decay "镜头重复" failure — cut density comes from more
// hard-cut scenes, not longer single clips. See ADR-0018.
const DEFAULT_CLIP_SECONDS = 6;

// Per-scene Ark polling. Each scene is minutes-scale; a single clip that never
// finishes fails only that scene (degraded, skipped at assembly), not the run.
const POLL_INTERVAL_MS = 5_000;
const PER_CLIP_MAX_WAIT_MS = 10 * 60_000;
const POLL_REQUEST_TIMEOUT_MS = 30_000;
const PLAN_TIMEOUT_MS = 3 * 60_000;
const ANCHOR_TIMEOUT_MS = 3 * 60_000;
const ASSEMBLE_TIMEOUT_MS = 10 * 60_000;

// Concurrent Ark scene generations in flight. Ark enforces its own per-account
// concurrency; keep this modest so a whole reel does not trip provider limits.
const SCENE_CONCURRENCY = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SceneResult = { order: number; ok: boolean; videoUrl?: string; error?: string };

// Plan the storyboard with the text model, then generate a best-effort single
// subject-anchor image (data-URI) when an image provider is configured. Anchor
// failure is non-fatal: the run degrades to text-only scene consistency.
async function planStep(input: VideoGenerationInput): Promise<{ board: Storyboard; anchor?: string }> {
  "use step";
  const { model } = await buildVideoTextModel(input.userId, input.textProviderId);
  const board = await planStoryboard({
    prompt: input.prompt,
    targetDurationSec: input.targetDurationSec ?? DEFAULT_TARGET_DURATION_S,
    clipSeconds: input.clipSeconds ?? DEFAULT_CLIP_SECONDS,
    model,
    abortSignal: AbortSignal.timeout(PLAN_TIMEOUT_MS),
  });

  let anchor: string | undefined;
  if (input.imageProviderId) {
    try {
      anchor = await generateCharacterAnchor({
        userId: input.userId,
        imageProviderId: input.imageProviderId,
        characterDNA: board.characterDNA,
        abortSignal: AbortSignal.timeout(ANCHOR_TIMEOUT_MS),
      });
    } catch (error) {
      console.warn("[executor] character anchor failed, degrading to text-only scenes", {
        error: String(error).slice(0, 200),
      });
    }
  }
  return { board, anchor };
}

// Create one Ark scene task. Separate durable step from the poll so a mid-poll
// process loss re-polls the same task id instead of billing a new generation.
// Fetches the provider inside the step to keep the api key out of durable state.
// The scene prompt is composed here (not in the "use workflow" orchestrator) so
// storyboard.ts's Node-dependent `ai` import stays isolated in this step chunk.
async function createSceneStep(input: {
  userId: string;
  providerId: string;
  scene: Scene;
  board: Storyboard;
  referenceImage?: string;
}): Promise<{ taskId?: string; error?: string }> {
  "use step";
  try {
    const provider = await getProvider(input.userId, input.providerId);
    const taskId = await createArkVideoTask({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      prompt: buildScenePrompt(input.scene, input.board),
      seconds: input.scene.seconds,
      seed: input.board.seed,
      referenceImage: input.referenceImage,
      extraBody: provider.extraBody,
      signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS),
    });
    return { taskId };
  } catch (error) {
    console.error("[executor] scene create failed", { error: String(error).slice(0, 300) });
    return { error: String(error).slice(0, 500) };
  }
}

// Poll one Ark scene task to a terminal state.
async function waitSceneStep(input: {
  userId: string;
  providerId: string;
  taskId: string;
}): Promise<ArkVideoSnapshot> {
  "use step";
  const provider = await getProvider(input.userId, input.providerId);
  const deadline = Date.now() + PER_CLIP_MAX_WAIT_MS;
  while (true) {
    try {
      const snapshot = await getArkVideoTask({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        taskId: input.taskId,
        signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS),
      });
      if (snapshot.status === "succeeded") return snapshot;
      if (snapshot.status === "failed" || snapshot.status === "cancelled") return snapshot;
    } catch (error) {
      console.warn("[executor] scene poll transient error", { error: String(error).slice(0, 200) });
    }
    if (Date.now() >= deadline) return { status: "failed", error: "scene generation timed out" };
    await sleep(POLL_INTERVAL_MS);
  }
}

// Download every successful clip, concatenate to one vertical mp4, and persist
// it to Knowledge. Bytes never cross a workflow-step boundary — download,
// ffmpeg, and upload all happen inside this single step.
async function assembleStep(input: {
  userId: string;
  conversationId?: string;
  title: string;
  filename: string;
  idempotencyKey?: string;
  urls: string[];
}): Promise<{ documentId: string; sizeBytes: number }> {
  "use step";
  const bytes = await assembleClips({ urls: input.urls, signal: AbortSignal.timeout(ASSEMBLE_TIMEOUT_MS) });
  const document = await createMediaDocument({
    userId: input.userId,
    conversationId: input.conversationId,
    title: input.title,
    filename: input.filename,
    mimeType: "video/mp4",
    bytes,
    idempotencyKey: input.idempotencyKey,
  });
  return { documentId: document.id, sizeBytes: bytes.length };
}

// Best-effort progress ping (see html-artifact.ts for the rationale): its own
// durable step, never throws, keyed to this run via getWorkflowMetadata.
async function reportProgressStep(done: number, total: number): Promise<void> {
  "use step";
  try {
    const { workflowRunId } = getWorkflowMetadata();
    await reportTaskProgress(workflowRunId, { done, total });
  } catch (error) {
    console.error("[executor] progress report failed (non-fatal)", { done, total, error });
  }
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

export async function videoGenerationWorkflow(input: VideoGenerationInput) {
  "use workflow";
  const { board, anchor } = await planStep(input);
  const total = board.scenes.length;
  let done = 0;
  await reportProgressStep(done, total);

  const results = await mapConcurrent(board.scenes, SCENE_CONCURRENCY, async (scene: Scene) => {
    let result: SceneResult;
    const created = await createSceneStep({
      userId: input.userId,
      providerId: input.providerId,
      scene,
      board,
      referenceImage: anchor,
    });
    if (!created.taskId) {
      result = { order: scene.order, ok: false, error: created.error };
    } else {
      const snapshot = await waitSceneStep({
        userId: input.userId,
        providerId: input.providerId,
        taskId: created.taskId,
      });
      const ok = snapshot.status === "succeeded" && Boolean(snapshot.videoUrl);
      result = { order: scene.order, ok, videoUrl: snapshot.videoUrl, error: snapshot.error };
    }
    done += 1;
    await reportProgressStep(done, total);
    return result;
  });

  const urls = results
    .filter((r) => r.ok && r.videoUrl)
    .sort((a, b) => a.order - b.order)
    .map((r) => r.videoUrl as string);
  const scenesFailed = total - urls.length;
  if (urls.length === 0) {
    throw new Error(`video generation produced no usable scenes (${scenesFailed} failed)`);
  }

  const assembled = await assembleStep({
    userId: input.userId,
    conversationId: input.conversationId,
    title: input.title,
    filename: input.filename,
    idempotencyKey: input.idempotencyKey,
    urls,
  });

  return {
    ok: true as const,
    documentId: assembled.documentId,
    title: input.title,
    filename: input.filename,
    mediaType: "video/mp4",
    sizeBytes: assembled.sizeBytes,
    scenesTotal: total,
    scenesDone: urls.length,
    scenesFailed,
  };
}
