import { getWorkflowMetadata } from "workflow";
import { z } from "zod";

import {
  isTaskCancelled,
  recordExternalTask,
  reportTaskProgress,
} from "../src/application/tasks/notify.js";
import { getSettings } from "../src/bootstrap/config.js";
import { getProvider } from "../src/infrastructure/clients/admin.js";
import {
  createStagedMedia,
  discardStagedMedia,
  publishStagedMedia,
} from "../src/infrastructure/clients/knowledge.js";
import {
  ArkRequestError,
  createArkVideoTask,
  deleteArkVideoTask,
  getArkVideoTask,
  type ArkVideoSnapshot,
} from "../src/infrastructure/clients/ark.js";
import {
  buildVideoTextModel,
  planScript,
  buildScriptFromSegments,
  SCRIPT_TIMEOUT_MS,
  type Character,
  type Script,
  type UserVideoSegment,
} from "../src/application/video/script.js";
import {
  STORYBOARD_TIMEOUT_MS,
  generateCharacterSheet,
  planSegments,
  type CharacterRef,
  type Segment,
} from "../src/application/video/storyboard.js";
import {
  describeCharacterAppearances,
  type UserCharacterRef,
} from "../src/application/video/characters.js";
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
} from "../src/application/video/limits.js";
import {
  assembleClips,
  downloadVideoBytes,
  inspectVideoBytes,
} from "../src/application/video/assembler.js";
import {
  parseVideoOutputConfig,
  type VideoOutputConfig,
} from "../src/application/video/output-config.js";
import { observeTaskCancellation } from "../src/application/tasks/cancellation.js";
import {
  publishApprovalHook,
  publishHookToken,
  shotReviewHook,
  shotReviewHookToken,
  storyboardApprovalHook,
  storyboardHookToken,
} from "../src/application/video-production/hooks.js";
import {
  completeVideoProduction,
  failVideoProduction,
  initializeVideoProduction,
  markAwaitingStoryboardApproval,
  markAwaitingPublishApproval,
  configureVideoProductionCost,
  markVideoProductionGenerating,
  markVideoProductionPublishing,
  recordVideoRenderReport,
  markVideoProductionFinalQa,
  markAwaitingShotReview,
  markVideoTakesSelected,
  recordVideoTake,
  reviseStoryboard,
} from "../src/application/video-production/service.js";
import {
  reconcileVideoCost,
  releaseVideoCost,
  reserveVideoCost,
} from "../src/application/video-production/cost.js";
import { compileSeedancePrompt } from "../src/application/video-production/compiler.js";
import type {
  ShotSpec,
  ShotTakeReview,
  VideoTake,
} from "../src/domain/video-production/contracts.js";

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
  targetDurationSec: z
    .number()
    .int()
    .min(MIN_TARGET_DURATION_S)
    .max(MAX_TARGET_DURATION_S)
    .optional(),
  title: z.string().min(1).max(120),
  filename: z.string().min(1).max(160),
  idempotencyKey: z.string().min(1).max(120).optional(),
  segments: z
    .array(videoSegmentInputSchema)
    .min(1)
    .max(MAX_SEGMENTS)
    .optional(),
  characterRefs: z
    .array(videoCharacterRefInputSchema)
    .max(MAX_MAIN_CHARACTERS)
    .optional(),
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

type SegmentResult = {
  shotId: string;
  takeNumber: number;
  order: number;
  ok: boolean;
  videoUrl?: string;
  error?: string;
  taskId?: string;
  seed?: number;
  stagedMediaId?: string;
};

async function loadVideoOutputConfigStep(input: {
  orgId: string;
  providerId: string;
}): Promise<VideoOutputConfig> {
  "use step";
  const provider = await getProvider(input.providerId, input.orgId);
  return parseVideoOutputConfig(provider.extraBody);
}

async function scriptedScriptStep(
  input: VideoGenerationInput,
  aspectLabel: string,
): Promise<Script> {
  "use step";
  const segments = input.segments!;
  const { model } = await buildVideoTextModel(
    input.textProviderId,
    input.orgId,
  );
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
      aspectLabel,
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
  if (!input.characterRefs.some((character) => character.documentId))
    return null;
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
    console.warn(
      "[executor] character describe step failed, keeping script characters",
      {
        error: String(error).slice(0, 200),
      },
    );
    return null;
  } finally {
    cancellation.dispose();
  }
}

async function scriptStep(
  input: VideoGenerationInput,
  aspectLabel: string,
): Promise<Script> {
  "use step";
  const targetDurationSec =
    input.targetDurationSec ?? DEFAULT_TARGET_DURATION_S;
  const count = deriveSegmentCount(targetDurationSec);
  const { model } = await buildVideoTextModel(
    input.textProviderId,
    input.orgId,
  );
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
      aspectLabel,
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
  outputConfig: VideoOutputConfig;
}): Promise<Segment[]> {
  "use step";
  const { model } = await buildVideoTextModel(
    input.textProviderId,
    input.orgId,
  );
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
      outputConfig: input.outputConfig,
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
    console.warn(
      "[executor] character sheet failed, degrading to text-only segments",
      {
        error: String(error).slice(0, 200),
      },
    );
    return [];
  } finally {
    cancellation.dispose();
  }
}

async function planStep(
  input: VideoGenerationInput,
  outputConfig: VideoOutputConfig,
): Promise<{
  script: Script;
  segments: Segment[];
  characterRefs: CharacterRef[];
  baseSeed: number;
}> {
  const scripted = Boolean(input.segments?.length);
  const segmentSeconds =
    scripted && input.segments
      ? scriptedSegmentSeconds(input.targetDurationSec, input.segments)
      : undefined;
  const targetDurationSec =
    input.targetDurationSec ??
    segmentSeconds?.reduce((total, seconds) => total + seconds, 0) ??
    DEFAULT_TARGET_DURATION_S;
  let script = scripted
    ? await scriptedScriptStep(input, outputConfig.aspectLabel)
    : await scriptStep(input, outputConfig.aspectLabel);

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
    outputConfig,
  });
  const characterRefs = await characterSheetStep({
    script,
    orgId: input.orgId,
    imageProviderId: input.imageProviderId,
  });
  return { script, segments, characterRefs, baseSeed: randomBaseSeed() };
}

async function initializeProductionStep(input: {
  workflowRunId: string;
  request: VideoGenerationInput;
  script: Script;
  segments: Segment[];
  characterRefs: CharacterRef[];
}) {
  "use step";
  return initializeVideoProduction({
    workflowRunId: input.workflowRunId,
    orgId: input.request.orgId,
    userId: input.request.userId,
    conversationId: input.request.conversationId,
    title: input.request.title,
    prompt: input.request.prompt,
    textProviderId: input.request.textProviderId,
    script: input.script,
    segments: input.segments,
    characterRefs: input.characterRefs,
    sourceCharacterRefs: input.request.characterRefs,
  });
}
initializeProductionStep.maxRetries = 0;

async function configureProductionCostStep(
  productionId: string,
  orgId: string,
  providerId: string,
) {
  "use step";
  const provider = await getProvider(providerId, orgId);
  if (!provider.pricing || provider.pricing.unit !== "generated_second") {
    throw new Error(
      "video provider pricing is required before storyboard approval",
    );
  }
  return configureVideoProductionCost(productionId, {
    currency: provider.pricing.currency,
    unitPriceMicros: provider.pricing.unitPriceMicros,
  });
}

async function awaitingStoryboardStep(productionId: string) {
  "use step";
  return markAwaitingStoryboardApproval(productionId);
}

async function reviseStoryboardStep(
  productionId: string,
  shotPlan: Parameters<typeof reviseStoryboard>[1],
  actorId: string,
) {
  "use step";
  return reviseStoryboard(productionId, shotPlan, actorId);
}

async function generatingProductionStep(
  productionId: string,
  budget: { budgetLimitMicros: number; currency: string },
) {
  "use step";
  return markVideoProductionGenerating(productionId, budget);
}

async function completedProductionStep(
  productionId: string,
  documentId: string,
) {
  "use step";
  return completeVideoProduction(productionId, documentId);
}

async function renderReportStep(
  productionId: string,
  results: SegmentResult[],
) {
  "use step";
  return recordVideoRenderReport(productionId, {
    shots: results.map((result) => ({
      shotOrder: result.order,
      shotId: result.shotId,
      takeId: `take-${result.takeNumber}`,
      providerTaskId: result.taskId,
      seed: result.seed,
      ok: result.ok,
      error: result.error,
    })),
  });
}

async function stageTakeStep(input: {
  productionId: string;
  userId: string;
  orgId: string;
  conversationId?: string;
  title: string;
  shot: ShotSpec;
  takeNumber: number;
  videoUrl: string;
}): Promise<string> {
  "use step";
  const bytes = await downloadVideoBytes(
    input.videoUrl,
    AbortSignal.timeout(ASSEMBLE_TIMEOUT_MS),
  );
  const staged = await createStagedMedia({
    userId: input.userId,
    orgId: input.orgId,
    conversationId: input.conversationId,
    title: `${input.title} · 镜头 ${input.shot.order + 1} · Take ${input.takeNumber}`,
    filename: `shot-${input.shot.order + 1}-take-${input.takeNumber}.mp4`,
    mimeType: "video/mp4",
    bytes,
    idempotencyKey: `${input.productionId}:${input.shot.id}:take:${input.takeNumber}`,
  });
  return staged.id;
}

async function awaitingShotReviewStep(
  productionId: string,
  shotReviews: ShotTakeReview[],
) {
  "use step";
  return markAwaitingShotReview(productionId, shotReviews);
}

async function recordTakeStep(
  productionId: string,
  shotId: string,
  take: VideoTake,
) {
  "use step";
  return recordVideoTake(productionId, shotId, take);
}

async function selectedTakesStep(
  productionId: string,
  selections: Array<{ shotId: string; takeId: string }>,
) {
  "use step";
  return markVideoTakesSelected(productionId, selections);
}

async function finalQaStep(productionId: string) {
  "use step";
  return markVideoProductionFinalQa(productionId);
}

async function awaitingPublishStep(
  productionId: string,
  stagedMediaId: string,
  qaReport: {
    deterministic: {
      passed: boolean;
      checks: Array<{ name: string; passed: boolean; detail: string }>;
    };
    semantic: { status: "human_review_required" };
  },
) {
  "use step";
  return markAwaitingPublishApproval(productionId, stagedMediaId, qaReport);
}

async function publishingProductionStep(
  productionId: string,
  actorId: string,
  waiverReason?: string,
) {
  "use step";
  return markVideoProductionPublishing(productionId, actorId, waiverReason);
}

async function rejectedProductionStep(productionId: string, reason: string) {
  "use step";
  return failVideoProduction(productionId, `storyboard rejected: ${reason}`);
}

async function failedProductionStep(productionId: string, reason: string) {
  "use step";
  return failVideoProduction(productionId, reason);
}

async function createSegmentStep(input: {
  productionId: string;
  orgId: string;
  providerId: string;
  seed: number;
  shot: ShotSpec;
  takeNumber: number;
}): Promise<{ taskId?: string; error?: string }> {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  let reservedAmount = 0;
  let reservedCurrency = "";
  let providerTaskId: string | undefined;
  try {
    const provider = await getProvider(input.providerId, input.orgId);
    if (!provider.pricing)
      throw new Error("video provider pricing is not configured");
    reservedAmount = provider.pricing.unitPriceMicros * input.shot.seconds;
    reservedCurrency = provider.pricing.currency;
    const costKey = `shot:${input.shot.id}:take:${input.takeNumber}`;
    await reserveVideoCost({
      productionId: input.productionId,
      idempotencyKey: `${costKey}:reserve`,
      amountMicros: reservedAmount,
      currency: reservedCurrency,
      payload: {
        shotId: input.shot.id,
        takeId: `take-${input.takeNumber}`,
        basis: "requested_seconds",
      },
    });
    const { prompt, images } = compileSeedancePrompt(input.shot);
    const taskId = await createArkVideoTask({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      prompt,
      images,
      seconds: input.shot.seconds,
      seed: input.seed,
      extraBody: provider.extraBody,
      signal: AbortSignal.any([
        cancellation.signal,
        AbortSignal.timeout(CREATE_REQUEST_TIMEOUT_MS),
      ]),
    });
    providerTaskId = taskId;
    await recordExternalTask(workflowRunId, taskId);
    await reconcileVideoCost({
      productionId: input.productionId,
      idempotencyKey: `${costKey}:reconcile`,
      amountMicros: reservedAmount,
      currency: reservedCurrency,
      payload: {
        shotId: input.shot.id,
        takeId: `take-${input.takeNumber}`,
        providerTaskId: taskId,
        basis: "requested_seconds",
      },
    });
    if (await isTaskCancelled(workflowRunId)) {
      await deleteArkVideoTask({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        taskId,
        signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS),
      }).catch((error) =>
        console.error(
          "[executor] failed to cancel newly created Ark video task",
          {
            taskId,
            error,
          },
        ),
      );
      return { error: "cancelled" };
    }
    return { taskId };
  } catch (error) {
    if (reservedAmount > 0 && !providerTaskId) {
      await releaseVideoCost({
        productionId: input.productionId,
        idempotencyKey: `shot:${input.shot.id}:take:${input.takeNumber}:release`,
        amountMicros: reservedAmount,
        currency: reservedCurrency,
        payload: { shotId: input.shot.id, takeId: `take-${input.takeNumber}` },
      }).catch((releaseError) =>
        console.error("[executor] failed to release video cost reservation", {
          shotId: input.shot.id,
          error: releaseError,
        }),
      );
    }
    if (cancellation.signal.aborted) throw error;
    console.warn("[executor] segment create failed without automatic retry", {
      status: error instanceof ArkRequestError ? error.status : undefined,
      error: String(error).slice(0, 300),
    });
    return {
      error:
        error instanceof Error
          ? error.message.slice(0, 500)
          : String(error).slice(0, 500),
    };
  } finally {
    cancellation.dispose();
  }
}

createSegmentStep.maxRetries = 0;

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
      if (snapshot.status === "failed" || snapshot.status === "cancelled")
        return snapshot;
    } catch (error) {
      console.warn("[executor] segment poll transient error", {
        error: String(error).slice(0, 200),
      });
    }
    if (Date.now() >= deadline)
      return { status: "failed", error: "segment generation timed out" };
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
  outputConfig: VideoOutputConfig;
  minimumDuration: number;
}): Promise<{
  stagedMediaId: string;
  sizeBytes: number;
  qaReport: {
    deterministic: {
      passed: boolean;
      checks: Array<{ name: string; passed: boolean; detail: string }>;
    };
    semantic: { status: "human_review_required" };
  };
}> {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  let bytes: Uint8Array;
  try {
    bytes = await assembleClips({
      urls: input.urls,
      outputConfig: input.outputConfig,
      signal: AbortSignal.any([
        cancellation.signal,
        AbortSignal.timeout(ASSEMBLE_TIMEOUT_MS),
      ]),
    });
  } finally {
    cancellation.dispose();
  }
  const deterministic = await inspectVideoBytes(bytes, {
    width: input.outputConfig.width,
    height: input.outputConfig.height,
    minimumDuration: input.minimumDuration,
  });
  if (!deterministic.passed) {
    const failures = deterministic.checks
      .filter((check) => !check.passed)
      .map((check) => check.name);
    throw new Error(`final deterministic QA failed: ${failures.join(", ")}`);
  }
  const staged = await createStagedMedia({
    userId: input.userId,
    orgId: input.orgId,
    conversationId: input.conversationId,
    title: input.title,
    filename: input.filename,
    mimeType: "video/mp4",
    bytes,
    idempotencyKey: input.idempotencyKey,
  });
  return {
    stagedMediaId: staged.id,
    sizeBytes: bytes.length,
    qaReport: { deterministic, semantic: { status: "human_review_required" } },
  };
}

async function publishStep(input: {
  stagedMediaId: string;
  userId: string;
  orgId: string;
}): Promise<{ documentId: string }> {
  "use step";
  const document = await publishStagedMedia({
    userId: input.userId,
    orgId: input.orgId,
    stagedId: input.stagedMediaId,
  });
  return { documentId: document.id };
}

async function discardStep(input: {
  stagedMediaId: string;
  userId: string;
  orgId: string;
}): Promise<void> {
  "use step";
  await discardStagedMedia({
    userId: input.userId,
    orgId: input.orgId,
    stagedId: input.stagedMediaId,
  });
}

async function discardAfterFailureStep(input: {
  stagedMediaId: string;
  userId: string;
  orgId: string;
}): Promise<void> {
  "use step";
  try {
    await discardStagedMedia({
      userId: input.userId,
      orgId: input.orgId,
      stagedId: input.stagedMediaId,
    });
  } catch (error) {
    console.error(
      "[executor] failed to discard staged video after production failure",
      {
        stagedMediaId: input.stagedMediaId,
        error,
      },
    );
  }
}

async function reportProgressStep(done: number, total: number): Promise<void> {
  "use step";
  try {
    const { workflowRunId } = getWorkflowMetadata();
    await reportTaskProgress(workflowRunId, { done, total });
  } catch (error) {
    console.error("[executor] progress report failed (non-fatal)", {
      done,
      total,
      error,
    });
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
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, run),
  );
  return results;
}

async function generateTake(input: {
  productionId: string;
  request: VideoGenerationInput;
  shot: ShotSpec;
  takeNumber: number;
  seed: number;
}): Promise<SegmentResult> {
  const created = await createSegmentStep({
    productionId: input.productionId,
    orgId: input.request.orgId,
    providerId: input.request.providerId,
    seed: input.seed,
    shot: input.shot,
    takeNumber: input.takeNumber,
  });
  if (!created.taskId) {
    return {
      shotId: input.shot.id,
      takeNumber: input.takeNumber,
      order: input.shot.order,
      ok: false,
      error: created.error,
      seed: input.seed,
    };
  }
  const snapshot = await waitSegmentStep({
    orgId: input.request.orgId,
    providerId: input.request.providerId,
    taskId: created.taskId,
  });
  const ok = snapshot.status === "succeeded" && Boolean(snapshot.videoUrl);
  const stagedMediaId =
    ok && snapshot.videoUrl
      ? await stageTakeStep({
          productionId: input.productionId,
          userId: input.request.userId,
          orgId: input.request.orgId,
          conversationId: input.request.conversationId,
          title: input.request.title,
          shot: input.shot,
          takeNumber: input.takeNumber,
          videoUrl: snapshot.videoUrl,
        })
      : undefined;
  return {
    shotId: input.shot.id,
    takeNumber: input.takeNumber,
    order: input.shot.order,
    ok,
    videoUrl: snapshot.videoUrl,
    error: snapshot.error,
    taskId: created.taskId,
    seed: input.seed,
    stagedMediaId,
  };
}

function toVideoTake(result: SegmentResult): VideoTake {
  return {
    id: `take-${result.takeNumber}`,
    shotId: result.shotId,
    number: result.takeNumber,
    status: result.ok ? "succeeded" : "failed",
    ...(result.taskId ? { providerTaskId: result.taskId } : {}),
    ...(result.stagedMediaId ? { stagedMediaId: result.stagedMediaId } : {}),
    seed: result.seed ?? 0,
    ...(result.error ? { error: result.error } : {}),
  };
}

export async function videoGenerationWorkflow(input: VideoGenerationInput) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  const outputConfig = await loadVideoOutputConfigStep({
    orgId: input.orgId,
    providerId: input.providerId,
  });
  const segmentConcurrency = await getVideoSegmentConcurrencyStep();
  const { script, segments, characterRefs, baseSeed } = await planStep(
    input,
    outputConfig,
  );
  const production = await initializeProductionStep({
    workflowRunId,
    request: input,
    script,
    segments,
    characterRefs,
  });
  await configureProductionCostStep(
    production.id,
    input.orgId,
    input.providerId,
  );
  let approvedShotPlan = production.shotPlan;
  if (!approvedShotPlan) throw new Error("video production has no storyboard");
  using storyboardHook = storyboardApprovalHook.create({
    token: storyboardHookToken(production.id),
  });
  const conflict = await storyboardHook.getConflict();
  if (conflict)
    throw new Error(`storyboard approval hook is owned by ${conflict.runId}`);
  await awaitingStoryboardStep(production.id);
  let storyboardApproval: {
    budgetLimitMicros: number;
    currency: string;
  } | null = null;
  const seenStoryboardDecisionIds = new Set<string>();
  for await (const storyboardDecision of storyboardHook) {
    if (seenStoryboardDecisionIds.has(storyboardDecision.actionId)) continue;
    seenStoryboardDecisionIds.add(storyboardDecision.actionId);
    if (storyboardDecision.action === "revise") {
      approvedShotPlan = await reviseStoryboardStep(
        production.id,
        storyboardDecision.shotPlan,
        storyboardDecision.actorId,
      );
      continue;
    }
    if (storyboardDecision.action === "reject") {
      await rejectedProductionStep(production.id, storyboardDecision.reason);
      throw new Error(`storyboard rejected: ${storyboardDecision.reason}`);
    }
    if (storyboardDecision.shotPlanVersion !== approvedShotPlan.version) {
      continue;
    }
    storyboardApproval = {
      budgetLimitMicros: storyboardDecision.budgetLimitMicros,
      currency: storyboardDecision.currency,
    };
    break;
  }
  if (!storyboardApproval)
    throw new Error("storyboard approval hook closed without approval");
  await generatingProductionStep(production.id, {
    budgetLimitMicros: storyboardApproval.budgetLimitMicros,
    currency: storyboardApproval.currency,
  });
  let stagedMediaId: string | undefined;
  let publishedDocumentId: string | undefined;
  const takeStagedMediaIds: string[] = [];
  try {
    const approvedShots = approvedShotPlan.shots;
    const total = approvedShots.length;
    let done = 0;
    await reportProgressStep(done, total);

    const initialResults = await mapConcurrent(
      approvedShots,
      segmentConcurrency,
      async (shot: ShotSpec) => {
        const result = await generateTake({
          productionId: production.id,
          request: input,
          shot,
          takeNumber: 1,
          seed: deriveSegmentSeed(baseSeed, shot.order),
        });
        done += 1;
        await reportProgressStep(done, total);
        return result;
      },
    );

    const allResults = [...initialResults];
    takeStagedMediaIds.push(
      ...initialResults.flatMap((result) =>
        result.stagedMediaId ? [result.stagedMediaId] : [],
      ),
    );
    let shotReviews: ShotTakeReview[] = approvedShots.map((shot) => ({
      shotId: shot.id,
      selectedTakeId: null,
      takes: initialResults
        .filter((result) => result.shotId === shot.id)
        .map(toVideoTake),
    }));
    using reviewHook = shotReviewHook.create({
      token: shotReviewHookToken(production.id),
    });
    const reviewConflict = await reviewHook.getConflict();
    if (reviewConflict)
      throw new Error(`shot review hook is owned by ${reviewConflict.runId}`);
    await awaitingShotReviewStep(production.id, shotReviews);
    const seenReviewDecisionIds = new Set<string>();
    let selections: Array<{ shotId: string; takeId: string }> | null = null;
    for await (const reviewDecision of reviewHook) {
      if (seenReviewDecisionIds.has(reviewDecision.actionId)) continue;
      seenReviewDecisionIds.add(reviewDecision.actionId);
      if (reviewDecision.action === "approve_takes") {
        selections = reviewDecision.selections;
        break;
      }
      const shot = approvedShots.find(
        (candidate) => candidate.id === reviewDecision.shotId,
      );
      if (!shot) throw new Error(`shot ${reviewDecision.shotId} is missing`);
      const review = shotReviews.find(
        (candidate) => candidate.shotId === shot.id,
      );
      const takeNumber = (review?.takes.length ?? 0) + 1;
      const result = await generateTake({
        productionId: production.id,
        request: input,
        shot,
        takeNumber,
        seed: deriveSegmentSeed(baseSeed, shot.order + takeNumber * 101),
      });
      allResults.push(result);
      if (result.stagedMediaId) takeStagedMediaIds.push(result.stagedMediaId);
      const take = toVideoTake(result);
      await recordTakeStep(production.id, shot.id, take);
      shotReviews = shotReviews.map((candidate) =>
        candidate.shotId === shot.id
          ? { ...candidate, takes: [...candidate.takes, take] }
          : candidate,
      );
    }
    if (!selections)
      throw new Error("shot review hook closed without take approval");
    await selectedTakesStep(production.id, selections);
    const selectedResults = selections
      .map((selection) => {
        const result = allResults.find(
          (candidate) =>
            candidate.shotId === selection.shotId &&
            `take-${candidate.takeNumber}` === selection.takeId,
        );
        if (!result?.ok || !result.videoUrl) {
          throw new Error(
            `selected take ${selection.takeId} for ${selection.shotId} is unavailable`,
          );
        }
        return result;
      })
      .sort((a, b) => a.order - b.order);
    const urls = selectedResults.map((result) => result.videoUrl as string);
    const segmentsFailed = allResults.filter((result) => !result.ok).length;
    await renderReportStep(production.id, allResults);

    const assembled = await assembleStep({
      userId: input.userId,
      orgId: input.orgId,
      conversationId: input.conversationId,
      title: input.title,
      filename: input.filename,
      idempotencyKey: input.idempotencyKey,
      urls,
      outputConfig,
      minimumDuration: Math.max(
        1,
        approvedShots.reduce((sum, shot) => sum + shot.seconds, 0) -
          urls.length,
      ),
    });
    stagedMediaId = assembled.stagedMediaId;
    await finalQaStep(production.id);
    using publishHook = publishApprovalHook.create({
      token: publishHookToken(production.id),
    });
    const publishConflict = await publishHook.getConflict();
    if (publishConflict)
      throw new Error(
        `publish approval hook is owned by ${publishConflict.runId}`,
      );
    await awaitingPublishStep(
      production.id,
      assembled.stagedMediaId,
      assembled.qaReport,
    );
    const publishDecision = await publishHook;
    if (!publishDecision.approved) {
      await discardStep({
        stagedMediaId: assembled.stagedMediaId,
        userId: input.userId,
        orgId: input.orgId,
      });
      throw new Error(`publish rejected: ${publishDecision.reason}`);
    }
    await publishingProductionStep(
      production.id,
      publishDecision.actorId,
      publishDecision.waiverReason,
    );
    const published = await publishStep({
      stagedMediaId: assembled.stagedMediaId,
      userId: input.userId,
      orgId: input.orgId,
    });
    publishedDocumentId = published.documentId;
    await completedProductionStep(production.id, published.documentId);
    for (const previewId of takeStagedMediaIds) {
      await discardAfterFailureStep({
        stagedMediaId: previewId,
        userId: input.userId,
        orgId: input.orgId,
      });
    }

    return {
      ok: true as const,
      documentId: published.documentId,
      title: input.title,
      filename: input.filename,
      mediaType: "video/mp4",
      sizeBytes: assembled.sizeBytes,
      segmentsTotal: total,
      segmentsDone: urls.length,
      segmentsFailed,
    };
  } catch (error) {
    if (stagedMediaId && !publishedDocumentId) {
      await discardAfterFailureStep({
        stagedMediaId,
        userId: input.userId,
        orgId: input.orgId,
      });
    }
    for (const previewId of takeStagedMediaIds) {
      await discardAfterFailureStep({
        stagedMediaId: previewId,
        userId: input.userId,
        orgId: input.orgId,
      });
    }
    await failedProductionStep(
      production.id,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}
