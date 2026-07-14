import { getWorkflowMetadata } from "workflow";
import { z } from "zod";

import {
  isTaskCancelled,
  recordExternalTask,
  reportTaskProgress,
} from "../src/tasks/notify.js";
import { getSettings } from "../src/config.js";
import { getProvider } from "../src/clients/admin.js";
import { createMediaDocument } from "../src/clients/knowledge.js";
import {
  ArkRequestError,
  createArkVideoTask,
  deleteArkVideoTask,
  getArkVideoTask,
  type ArkVideoSnapshot,
} from "../src/clients/ark.js";
import { buildVideoTextModel, planScript, buildScriptFromSegments, SCRIPT_TIMEOUT_MS, type Character, type Script, type UserVideoSegment } from "../src/video/script.js";
import {
  STORYBOARD_TIMEOUT_MS,
  buildSegmentContent,
  generateCharacterSheet,
  planSegments,
  type CharacterRef,
  type Segment,
} from "../src/video/storyboard.js";
import { describeCharacterAppearances, type UserCharacterRef } from "../src/video/characters.js";
import {
  DEFAULT_TARGET_DURATION_S,
  MAX_MAIN_CHARACTERS,
  MAX_SEGMENTS,
  MAX_TARGET_DURATION_S,
  MIN_TARGET_DURATION_S,
  deriveSegmentCount,
  deriveSegmentSeed,
  randomBaseSeed,
  scriptedSegmentSeconds,
} from "../src/video/limits.js";
import { assembleClips } from "../src/video/assembler.js";
import { observeTaskCancellation } from "../src/tasks/cancellation.js";

export const videoSegmentInputSchema = z.object({
  content: z.string().min(1).max(1_000),
  narration: z.string().max(300).optional(),
  dialogue: z.string().max(300).optional(),
  seconds: z.number().int().min(4).max(15).optional(),
});

export const videoCharacterRefInputSchema = z.object({
  name: z.string().min(1).max(40),
  documentId: z.string().max(32).optional(),
  appearance: z.string().max(400).optional(),
});

export const videoGenerationInputSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  conversationId: z.string().optional(),
  providerId: z.string().min(1),
  textProviderId: z.string().min(1),
  imageProviderId: z.string().optional(),
  prompt: z.string().min(1).max(4000),
  targetDurationSec: z.number().int().min(MIN_TARGET_DURATION_S).max(MAX_TARGET_DURATION_S).optional(),
  title: z.string().min(1).max(120),
  filename: z.string().min(1).max(160),
  idempotencyKey: z.string().min(1).max(120).optional(),
  segments: z.array(videoSegmentInputSchema).min(1).max(MAX_SEGMENTS).optional(),
  characterRefs: z.array(videoCharacterRefInputSchema).max(MAX_MAIN_CHARACTERS).optional(),
});
export type VideoGenerationInput = z.infer<typeof videoGenerationInputSchema>;

const POLL_INTERVAL_MS = 5_000;
const PER_SEGMENT_MAX_WAIT_MS = 12 * 60_000;
const POLL_REQUEST_TIMEOUT_MS = 30_000;
const CREATE_REQUEST_TIMEOUT_MS = 60_000;
const ANCHOR_PER_IMAGE_TIMEOUT_MS = 2 * 60_000;
const ASSEMBLE_TIMEOUT_MS = 10 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SegmentMode = "reference" | "text";
type SegmentResult = {
  order: number;
  ok: boolean;
  videoUrl?: string;
  error?: string;
};

async function scriptedScriptStep(input: VideoGenerationInput): Promise<Script> {
  "use step";
  const segments = input.segments!;
  const { model } = await buildVideoTextModel(input.textProviderId, input.orgId);
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  try {
    const script = await buildScriptFromSegments({
      prompt: input.prompt,
      segments: segments.map((segment) => ({
        content: segment.content,
        ...(segment.narration ? { narration: segment.narration } : {}),
        ...(segment.dialogue ? { dialogue: segment.dialogue } : {}),
      })),
      characters: input.characterRefs?.map((character) => ({
        name: character.name,
        ...(character.appearance ? { appearance: character.appearance } : {}),
      })),
      model,
      abortSignal: AbortSignal.any([
        cancellation.signal,
        AbortSignal.timeout(SCRIPT_TIMEOUT_MS),
      ]),
    });
    if (cancellation.signal.aborted) throw cancellation.signal.reason;
    return script;
  } finally {
    cancellation.dispose();
  }
}

async function describeCharactersStep(input: {
  orgId: string;
  userId: string;
  textProviderId: string;
  existingCharacters: Character[];
  characterRefs?: UserCharacterRef[];
}): Promise<Character[] | null> {
  "use step";
  if (!input.characterRefs?.length) return null;
  if (!input.characterRefs.some((character) => character.documentId)) return null;
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  try {
    const characters = await describeCharacterAppearances({
      orgId: input.orgId,
      userId: input.userId,
      textProviderId: input.textProviderId,
      existingCharacters: input.existingCharacters,
      characters: input.characterRefs,
      abortSignal: AbortSignal.any([
        cancellation.signal,
        AbortSignal.timeout(SCRIPT_TIMEOUT_MS),
      ]),
    });
    if (cancellation.signal.aborted) throw cancellation.signal.reason;
    return characters;
  } catch (error) {
    if (cancellation.signal.aborted) throw error;
    console.warn("[executor] character describe step failed, keeping script characters", {
      error: String(error).slice(0, 200),
    });
    return null;
  } finally {
    cancellation.dispose();
  }
}

async function scriptStep(input: VideoGenerationInput): Promise<Script> {
  "use step";
  const targetDurationSec = input.targetDurationSec ?? DEFAULT_TARGET_DURATION_S;
  const count = deriveSegmentCount(targetDurationSec);
  const { model } = await buildVideoTextModel(input.textProviderId, input.orgId);
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
    if (cancellation.signal.aborted) throw cancellation.signal.reason;
    return script;
  } finally {
    cancellation.dispose();
  }
}

async function storyboardStep(input: {
  script: Script;
  targetDurationSec: number;
  textProviderId: string;
  orgId: string;
  faithful?: boolean;
  userSegments?: UserVideoSegment[];
  segmentSeconds?: number[];
}): Promise<Segment[]> {
  "use step";
  const { model } = await buildVideoTextModel(input.textProviderId, input.orgId);
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  try {
    const segments = await planSegments({
      script: input.script,
      targetDurationSec: input.targetDurationSec,
      model,
      abortSignal: AbortSignal.any([
        cancellation.signal,
        AbortSignal.timeout(STORYBOARD_TIMEOUT_MS),
      ]),
      faithful: input.faithful,
      userSegments: input.userSegments,
      segmentSeconds: input.segmentSeconds,
    });
    if (cancellation.signal.aborted) throw cancellation.signal.reason;
    return segments;
  } finally {
    cancellation.dispose();
  }
}

async function characterSheetStep(input: {
  script: Script;
  orgId: string;
  imageProviderId?: string;
}): Promise<CharacterRef[]> {
  "use step";
  if (!input.imageProviderId) return [];
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  try {
    const characterRefs = await generateCharacterSheet({
      orgId: input.orgId,
      imageProviderId: input.imageProviderId,
      characters: input.script.characters.slice(0, MAX_MAIN_CHARACTERS),
      perImageTimeoutMs: ANCHOR_PER_IMAGE_TIMEOUT_MS,
      abortSignal: cancellation.signal,
    });
    if (cancellation.signal.aborted) throw cancellation.signal.reason;
    return characterRefs;
  } catch (error) {
    if (cancellation.signal.aborted) throw error;
    console.warn("[executor] character sheet failed, degrading to text-only segments", {
      error: String(error).slice(0, 200),
    });
    return [];
  } finally {
    cancellation.dispose();
  }
}

async function planStep(input: VideoGenerationInput): Promise<{
  script: Script;
  segments: Segment[];
  characterRefs: CharacterRef[];
  baseSeed: number;
}> {
  const scripted = Boolean(input.segments?.length);
  const segmentSeconds = scripted && input.segments
    ? scriptedSegmentSeconds(input.targetDurationSec, input.segments)
    : undefined;
  const targetDurationSec = input.targetDurationSec
    ?? segmentSeconds?.reduce((total, seconds) => total + seconds, 0)
    ?? DEFAULT_TARGET_DURATION_S;
  let script = scripted
    ? await scriptedScriptStep(input)
    : await scriptStep(input);

  const describedCharacters = await describeCharactersStep({
    orgId: input.orgId,
    userId: input.userId,
    textProviderId: input.textProviderId,
    existingCharacters: script.characters,
    characterRefs: input.characterRefs,
  });
  if (describedCharacters?.length) {
    script = { ...script, characters: describedCharacters };
  }

  const userSegments = input.segments?.map((segment) => ({
    content: segment.content,
    ...(segment.narration ? { narration: segment.narration } : {}),
    ...(segment.dialogue ? { dialogue: segment.dialogue } : {}),
  }));
  const segments = await storyboardStep({
    script,
    targetDurationSec,
    textProviderId: input.textProviderId,
    orgId: input.orgId,
    faithful: scripted,
    userSegments,
    segmentSeconds,
  });
  const characterRefs = await characterSheetStep({
    script,
    orgId: input.orgId,
    imageProviderId: input.imageProviderId,
  });
  return { script, segments, characterRefs, baseSeed: randomBaseSeed() };
}

async function createSegmentStep(input: {
  orgId: string;
  providerId: string;
  segment: Segment;
  script: Script;
  characterRefs: CharacterRef[];
  mode: SegmentMode;
  seed: number;
}): Promise<{ taskId?: string; error?: string }> {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  try {
    const provider = await getProvider(input.providerId, input.orgId);
    const { prompt, images } = buildSegmentContent(input.segment, input.script, {
      characterRefs: input.characterRefs,
      mode: input.mode,
    });
    const taskId = await createArkVideoTask({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      prompt,
      images,
      seconds: input.segment.seconds,
      seed: input.seed,
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
  orgId: string;
  providerId: string;
  taskId: string;
}): Promise<ArkVideoSnapshot> {
  "use step";
  const provider = await getProvider(input.providerId, input.orgId);
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
  orgId: string;
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
    orgId: input.orgId,
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

async function getVideoSegmentConcurrencyStep(): Promise<number> {
  "use step";
  return Math.min(getSettings().videoSegmentConcurrency, MAX_SEGMENTS);
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
  const segmentConcurrency = await getVideoSegmentConcurrencyStep();
  const { script, segments, characterRefs, baseSeed } = await planStep(input);
  const total = segments.length;
  const hasRefs = characterRefs.length > 0;
  let done = 0;
  await reportProgressStep(done, total);

  const mode: SegmentMode = hasRefs ? "reference" : "text";
  const results = await mapConcurrent(segments, segmentConcurrency, async (segment: Segment) => {
    const created = await createSegmentStep({
      orgId: input.orgId,
      providerId: input.providerId,
      segment,
      script,
      characterRefs,
      mode,
      seed: deriveSegmentSeed(baseSeed, segment.order),
    });
    let result: SegmentResult;
    if (!created.taskId) {
      result = { order: segment.order, ok: false, error: created.error };
    } else {
      const snapshot = await waitSegmentStep({
        orgId: input.orgId,
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
    orgId: input.orgId,
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
