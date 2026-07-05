import { getWorkflowMetadata } from "workflow";
import { z } from "zod";

import {
  isTaskCancelled,
  recordExternalTask,
  reportTaskProgress,
} from "../src/tasks/notify.js";
import { getProvider } from "../src/clients/admin.js";
import { createMediaDocument } from "../src/clients/knowledge.js";
import {
  ArkRequestError,
  createArkVideoTask,
  deleteArkVideoTask,
  getArkVideoTask,
  type ArkVideoSnapshot,
} from "../src/clients/ark.js";
import { buildVideoTextModel, planScript, SCRIPT_TIMEOUT_MS, type Script } from "../src/video/script.js";
import {
  STORYBOARD_TIMEOUT_MS,
  buildSegmentContent,
  generateCharacterSheet,
  planSegments,
  type CharacterRef,
  type Segment,
} from "../src/video/storyboard.js";
import {
  DEFAULT_TARGET_DURATION_S,
  MAX_MAIN_CHARACTERS,
  MAX_TARGET_DURATION_S,
  MIN_TARGET_DURATION_S,
  deriveSegmentCount,
  deriveSegmentSeed,
  randomBaseSeed,
} from "../src/video/limits.js";
import { assembleClips } from "../src/video/assembler.js";
import { observeTaskCancellation } from "../src/tasks/cancellation.js";

export const videoGenerationInputSchema = z.object({
  userId: z.string().min(1),
  conversationId: z.string().optional(),
  providerId: z.string().min(1),
  textProviderId: z.string().min(1),
  imageProviderId: z.string().optional(),
  prompt: z.string().min(1).max(4000),
  targetDurationSec: z.number().int().min(MIN_TARGET_DURATION_S).max(MAX_TARGET_DURATION_S).optional(),
  continuity: z.enum(["cut", "chain"]).optional(),
  title: z.string().min(1).max(120),
  filename: z.string().min(1).max(160),
  idempotencyKey: z.string().min(1).max(120).optional(),
});
export type VideoGenerationInput = z.infer<typeof videoGenerationInputSchema>;

const POLL_INTERVAL_MS = 5_000;
const PER_SEGMENT_MAX_WAIT_MS = 12 * 60_000;
const POLL_REQUEST_TIMEOUT_MS = 30_000;
const CREATE_REQUEST_TIMEOUT_MS = 60_000;
const ANCHOR_PER_IMAGE_TIMEOUT_MS = 2 * 60_000;
const ASSEMBLE_TIMEOUT_MS = 10 * 60_000;

const SEGMENT_CONCURRENCY = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SegmentMode = "reference" | "first-frame" | "text";
type SegmentResult = {
  order: number;
  ok: boolean;
  videoUrl?: string;
  lastFrameUrl?: string;
  error?: string;
};

async function planStep(input: VideoGenerationInput): Promise<{
  script: Script;
  segments: Segment[];
  characterRefs: CharacterRef[];
  baseSeed: number;
}> {
  "use step";
  const targetDurationSec = input.targetDurationSec ?? DEFAULT_TARGET_DURATION_S;
  const count = deriveSegmentCount(targetDurationSec);
  const { model } = await buildVideoTextModel(input.textProviderId);
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);

  try {
    const script = await planScript({
      prompt: input.prompt,
      targetDurationSec,
      count,
      model,
      abortSignal: AbortSignal.any([
        cancellation.signal,
        AbortSignal.timeout(SCRIPT_TIMEOUT_MS),
      ]),
    });

    const segments = await planSegments({
      script,
      targetDurationSec,
      model,
      abortSignal: AbortSignal.any([
        cancellation.signal,
        AbortSignal.timeout(STORYBOARD_TIMEOUT_MS),
      ]),
    });

    let characterRefs: CharacterRef[] = [];
    if (input.imageProviderId && !cancellation.signal.aborted) {
      try {
        characterRefs = await generateCharacterSheet({
          imageProviderId: input.imageProviderId,
          characters: script.characters.slice(0, MAX_MAIN_CHARACTERS),
          perImageTimeoutMs: ANCHOR_PER_IMAGE_TIMEOUT_MS,
          abortSignal: cancellation.signal,
        });
      } catch (error) {
        if (cancellation.signal.aborted) throw error;
        console.warn("[executor] character sheet failed, degrading to text-only segments", {
          error: String(error).slice(0, 200),
        });
      }
    }
    if (cancellation.signal.aborted) throw cancellation.signal.reason;
    return { script, segments, characterRefs, baseSeed: randomBaseSeed() };
  } finally {
    cancellation.dispose();
  }
}

async function createSegmentStep(input: {
  providerId: string;
  segment: Segment;
  script: Script;
  characterRefs: CharacterRef[];
  mode: SegmentMode;
  firstFrameUrl?: string;
  seed: number;
  returnLastFrame: boolean;
}): Promise<{ taskId?: string; error?: string }> {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  try {
    const provider = await getProvider(input.providerId);
    const { prompt, images } = buildSegmentContent(input.segment, input.script, {
      characterRefs: input.characterRefs,
      mode: input.mode,
      firstFrameUrl: input.firstFrameUrl,
    });
    const taskId = await createArkVideoTask({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      prompt,
      images,
      seconds: input.segment.seconds,
      seed: input.seed,
      returnLastFrame: input.returnLastFrame,
      extraBody: provider.extraBody,
      signal: AbortSignal.any([
        cancellation.signal,
        AbortSignal.timeout(CREATE_REQUEST_TIMEOUT_MS),
      ]),
    });
    await recordExternalTask(workflowRunId, taskId);
    if (await isTaskCancelled(workflowRunId)) {
      await deleteArkVideoTask({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        taskId,
        signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS),
      }).catch((error) =>
        console.error("[executor] failed to cancel newly created Ark video task", {
          taskId,
          error,
        }),
      );
      return { error: "cancelled" };
    }
    return { taskId };
  } catch (error) {
    if (error instanceof ArkRequestError && !error.retryable) {
      console.error("[executor] segment create rejected (non-retryable), degrading", {
        status: error.status,
        error: error.message.slice(0, 300),
      });
      return { error: error.message.slice(0, 500) };
    }
    console.warn("[executor] segment create transient failure, will retry", {
      error: String(error).slice(0, 300),
    });
    throw error;
  } finally {
    cancellation.dispose();
  }
}

async function waitSegmentStep(input: {
  providerId: string;
  taskId: string;
}): Promise<ArkVideoSnapshot> {
  "use step";
  const provider = await getProvider(input.providerId);
  const { workflowRunId } = getWorkflowMetadata();
  const deadline = Date.now() + PER_SEGMENT_MAX_WAIT_MS;
  while (true) {
    if (await isTaskCancelled(workflowRunId)) {
      await deleteArkVideoTask({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        taskId: input.taskId,
        signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS),
      }).catch((error) =>
        console.error("[executor] failed to cancel active Ark video task", {
          taskId: input.taskId,
          error,
        }),
      );
      return { status: "cancelled" };
    }
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
      console.warn("[executor] segment poll transient error", { error: String(error).slice(0, 200) });
    }
    if (Date.now() >= deadline) return { status: "failed", error: "segment generation timed out" };
    await sleep(POLL_INTERVAL_MS);
  }
}

async function assembleStep(input: {
  userId: string;
  conversationId?: string;
  title: string;
  filename: string;
  idempotencyKey?: string;
  urls: string[];
}): Promise<{ documentId: string; sizeBytes: number }> {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  let bytes: Uint8Array;
  try {
    bytes = await assembleClips({
      urls: input.urls,
      signal: AbortSignal.any([
        cancellation.signal,
        AbortSignal.timeout(ASSEMBLE_TIMEOUT_MS),
      ]),
    });
  } finally {
    cancellation.dispose();
  }
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
  const { script, segments, characterRefs, baseSeed } = await planStep(input);
  const total = segments.length;
  const hasRefs = characterRefs.length > 0;
  const continuity = input.continuity ?? "cut";
  let done = 0;
  await reportProgressStep(done, total);

  let results: SegmentResult[];

  if (continuity === "chain") {
    results = [];
    let prevLastFrame: string | undefined;
    for (const segment of segments) {
      const isLast = segment.order === total - 1;
      const mode: SegmentMode = prevLastFrame ? "first-frame" : hasRefs ? "reference" : "text";
      const created = await createSegmentStep({
        providerId: input.providerId,
        segment,
        script,
        characterRefs,
        mode,
        firstFrameUrl: prevLastFrame,
        seed: deriveSegmentSeed(baseSeed, segment.order),
        returnLastFrame: !isLast,
      });
      let result: SegmentResult;
      if (!created.taskId) {
        result = { order: segment.order, ok: false, error: created.error };
      } else {
        const snapshot = await waitSegmentStep({
          providerId: input.providerId,
          taskId: created.taskId,
        });
        const ok = snapshot.status === "succeeded" && Boolean(snapshot.videoUrl);
        result = {
          order: segment.order,
          ok,
          videoUrl: snapshot.videoUrl,
          lastFrameUrl: snapshot.lastFrameUrl,
          error: snapshot.error,
        };
        prevLastFrame = ok ? snapshot.lastFrameUrl : undefined;
      }
      done += 1;
      await reportProgressStep(done, total);
      results.push(result);
    }
  } else {
    const mode: SegmentMode = hasRefs ? "reference" : "text";
    results = await mapConcurrent(segments, SEGMENT_CONCURRENCY, async (segment: Segment) => {
      const created = await createSegmentStep({
        providerId: input.providerId,
        segment,
        script,
        characterRefs,
        mode,
        seed: deriveSegmentSeed(baseSeed, segment.order),
        returnLastFrame: false,
      });
      let result: SegmentResult;
      if (!created.taskId) {
        result = { order: segment.order, ok: false, error: created.error };
      } else {
        const snapshot = await waitSegmentStep({
          providerId: input.providerId,
          taskId: created.taskId,
        });
        const ok = snapshot.status === "succeeded" && Boolean(snapshot.videoUrl);
        result = { order: segment.order, ok, videoUrl: snapshot.videoUrl, error: snapshot.error };
      }
      done += 1;
      await reportProgressStep(done, total);
      return result;
    });
  }

  const urls = results
    .filter((r) => r.ok && r.videoUrl)
    .sort((a, b) => a.order - b.order)
    .map((r) => r.videoUrl as string);
  const segmentsFailed = total - urls.length;
  const hookOk = results.some((r) => r.order === 0 && r.ok);
  const minRequired = Math.max(2, Math.ceil(total * 0.6));
  if (urls.length === 0) {
    throw new Error(`video generation produced no usable segments (${segmentsFailed} failed)`);
  }
  if (!hookOk || urls.length < minRequired) {
    throw new Error(
      `video generation degraded below the quality bar: ${urls.length}/${total} segments ok` +
        `${hookOk ? "" : " (hook segment failed)"} — need ≥${minRequired} including the hook`,
    );
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
    segmentsTotal: total,
    segmentsDone: urls.length,
    segmentsFailed,
  };
}
