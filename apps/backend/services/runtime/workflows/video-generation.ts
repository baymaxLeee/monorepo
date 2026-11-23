import { getStepMetadata, getWorkflowMetadata } from "workflow";
import { z } from "zod";

import { ARK_DURATION_MAX, ARK_DURATION_MIN } from "../src/application/video/limits.js";
import type { ArkVideoSnapshot } from "../src/infrastructure/clients/ark.js";
import {
  mediaProviderCapabilitySchema,
  type MediaProviderCapability,
} from "../src/infrastructure/provider/capability.js";

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;

const videoReferenceSchema = z.object({
  assetId: z.string().uuid(),
  revisionId: z.string().uuid(),
});

export const videoGenerationInputSchema = z.object({
  sessionId: z.string().optional(),
  provider: mediaProviderCapabilitySchema.refine((provider) => provider.providerKind === "video", {
    message: "video provider capability is required",
  }),
  prompt: z.string().min(1).max(4_000),
  references: z.array(videoReferenceSchema).max(5).default([]),
  durationSeconds: z.number().int().min(ARK_DURATION_MIN).max(ARK_DURATION_MAX).optional(),
  filename: z.string().min(1).max(160),
  idempotencyKey: z.string().min(1).max(120),
});

export type VideoGenerationInput = z.infer<typeof videoGenerationInputSchema>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

async function createVideoStep(input: VideoGenerationInput): Promise<string> {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const [cancellationModule, taskModule, arkModule, storageModule] = await Promise.all([
    import("../src/application/tasks/cancellation.js"),
    import("../src/application/tasks/notify.js"),
    import("../src/infrastructure/clients/ark.js"),
    import("../src/infrastructure/clients/storage-media.js"),
  ]);
  const { observeTaskCancellation } = cancellationModule;
  const { isTaskCancelled, recordExternalTask } = taskModule;
  const { createArkVideoTask, deleteArkVideoTask, seedanceCaps } = arkModule;
  const { mintAssetDelivery } = storageModule;
  const cancellation = observeTaskCancellation(workflowRunId);
  try {
    const { validateMediaProviderCapability } = await import("../src/infrastructure/provider/capability-validation.js");
    const provider = await validateMediaProviderCapability(input.provider, "video");
    const referenceLimit = seedanceCaps(provider.model).multiImageReference ? input.references.length : 1;
    const images = await Promise.all(
      input.references.slice(0, referenceLimit).map(async (reference) => ({
        role: "reference_image" as const,
        url: (
          await mintAssetDelivery({
            assetId: reference.assetId,
            revisionId: reference.revisionId,
            maxDim: 1536,
          })
        ).url,
      })),
    );
    const providerTaskId = await createArkVideoTask({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      prompt: input.prompt,
      images,
      seconds: input.durationSeconds,
      extraBody: provider.extraBody,
      signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    await recordExternalTask(workflowRunId, `provider:${providerTaskId}`);
    if (await isTaskCancelled(workflowRunId)) {
      await deleteArkVideoTask({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        taskId: providerTaskId,
        signal: AbortSignal.timeout(30_000),
      }).catch(() => undefined);
      throw new Error("video generation was cancelled");
    }
    return providerTaskId;
  } finally {
    cancellation.dispose();
  }
}

// The provider may have accepted a paid request even if its response is lost.
// Task recovery re-enters with the persisted step result; it never replays this call.
createVideoStep.maxRetries = 0;

async function waitForVideoStep(input: {
  provider: MediaProviderCapability;
  providerTaskId: string;
}): Promise<ArkVideoSnapshot> {
  "use step";
  const [{ isTaskCancelled }, { deleteArkVideoTask, getArkVideoTask }] = await Promise.all([
    import("../src/application/tasks/notify.js"),
    import("../src/infrastructure/clients/ark.js"),
  ]);
  const { validateMediaProviderCapability } = await import("../src/infrastructure/provider/capability-validation.js");
  const provider = await validateMediaProviderCapability(input.provider, "video");
  const { workflowRunId } = getWorkflowMetadata();
  const deadline = Date.now() + MAX_WAIT_MS;
  while (true) {
    if (await isTaskCancelled(workflowRunId)) {
      await deleteArkVideoTask({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        taskId: input.providerTaskId,
        signal: AbortSignal.timeout(30_000),
      }).catch(() => undefined);
      return { status: "cancelled" };
    }
    try {
      const snapshot = await getArkVideoTask({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        taskId: input.providerTaskId,
        signal: AbortSignal.timeout(30_000),
      });
      if (["succeeded", "failed", "cancelled"].includes(snapshot.status)) return snapshot;
    } catch (error) {
      console.warn("[runtime-worker] video status poll failed; retrying", {
        providerTaskId: input.providerTaskId,
        error: String(error).slice(0, 300),
      });
    }
    if (Date.now() >= deadline) return { status: "failed", error: "video generation timed out" };
    await sleep(POLL_INTERVAL_MS);
  }
}

async function persistVideoStep(input: { taskId: string; filename: string; idempotencyKey: string; videoUrl: string }) {
  "use step";
  const [{ secureProviderFetch }, { observeTaskCancellation }, { recordExternalTask }, storageModule] =
    await Promise.all([
      import("#runtime/provider-url"),
      import("../src/application/tasks/cancellation.js"),
      import("../src/application/tasks/notify.js"),
      import("../src/infrastructure/clients/storage-media.js"),
    ]);
  const { claimTaskAsset, uploadAsset } = storageModule;
  const { stepId } = getStepMetadata();
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  try {
    const response = await secureProviderFetch(input.videoUrl, { signal: cancellation.signal });
    if (!response.ok || !response.body) throw new Error(`video download failed: ${response.status}`);
    const rawLength = response.headers.get("content-length");
    const contentLength = rawLength == null ? undefined : Number(rawLength);
    const asset = await uploadAsset({
      filename: input.filename,
      mediaType: "video/mp4",
      category: "generated-video",
      body: response.body,
      contentLength:
        contentLength !== undefined && Number.isSafeInteger(contentLength) && contentLength >= 0
          ? contentLength
          : undefined,
      idempotencyKey: input.idempotencyKey || stepId,
      signal: cancellation.signal,
    });
    await claimTaskAsset({
      taskId: input.taskId,
      slot: "video:final",
      assetId: asset.assetId,
      revisionId: asset.revisionId,
    });
    await recordExternalTask(workflowRunId, "asset:video:final");
    return asset;
  } finally {
    cancellation.dispose();
  }
}

async function claimTask(taskId: string): Promise<void> {
  "use step";
  const { claimTaskStep } = await import("../src/application/tasks/binding.js");
  await claimTaskStep(taskId);
}

async function reportProgressStep(done: number, total: number): Promise<void> {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const { reportTaskProgress } = await import("../src/application/tasks/notify.js");
  await reportTaskProgress(workflowRunId, { done, total });
}

export async function videoGenerationWorkflow(input: VideoGenerationInput, taskId: string) {
  "use workflow";
  await claimTask(taskId);
  await reportProgressStep(0, 1);
  const providerTaskId = await createVideoStep(input);
  const snapshot = await waitForVideoStep({ provider: input.provider, providerTaskId });
  if (snapshot.status !== "succeeded" || !snapshot.videoUrl) {
    throw new Error(snapshot.error || `video provider ended with status ${snapshot.status}`);
  }
  const video = await persistVideoStep({
    taskId,
    filename: input.filename,
    idempotencyKey: input.idempotencyKey,
    videoUrl: snapshot.videoUrl,
  });
  await reportProgressStep(1, 1);
  return {
    video: {
      assetId: video.assetId,
      revisionId: video.revisionId,
      filename: video.filename,
      mediaType: video.mediaType,
      sizeBytes: video.sizeBytes,
      sha256: video.sha256,
    },
    durationSeconds: input.durationSeconds ?? null,
  };
}
