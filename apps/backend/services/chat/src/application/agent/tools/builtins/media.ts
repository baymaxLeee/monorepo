import { generateImage, NoImageGeneratedError, tool, type JSONValue } from "ai";
import { z } from "zod";

import { createProviderImageModel } from "@backend/transport-ts/provider-model";
import { logger } from "../../../../infrastructure/observability/logger.js";
import type { ProviderSnapshot } from "../../../../infrastructure/clients/admin.js";
import {
  getVideoProduction,
  type Task,
} from "../../../../infrastructure/clients/executor.js";
import { createMediaDocument, getDocument } from "../../../../infrastructure/clients/knowledge.js";
import {
  pollTaskSnapshots,
  startExecutorTask,
  TaskWaitTimeoutError,
} from "../../tasks/executor-task.js";
import { mediaToolContextSchema, type MediaToolContext } from "../context.js";
import { defineAgentTool, defineUnavailableCapability } from "../manifest.js";
import {
  toolCompleted,
  toolFailed,
  toolPartial,
  toolRunning,
  type ToolEmission,
} from "../outcome.js";

const imageOutputSchema = z.object({
  images: z.array(
    z.object({ document_id: z.string(), filename: z.string(), media_type: z.string() }),
  ),
  count: z.number(),
  failed: z.number(),
  failed_items: z.array(z.object({ index: z.number(), message: z.string() })).optional(),
  document_id: z.string().optional(),
});

const videoProductionOutputSchema = z.object({
  kind: z.literal("video"),
  title: z.string(),
  filename: z.string(),
  prompt: z.string(),
  duration: z.number().optional(),
  task_id: z.string(),
  production_id: z.string().optional(),
  production_stage: z.string().optional(),
  awaiting_action: z.enum(["storyboard_approval", "shot_review", "publish_approval"]).optional(),
  production_version: z.number().int().optional(),
  progress_done: z.number().optional(),
  progress_total: z.number().optional(),
  document_id: z.string().optional(),
  media_type: z.literal("video/mp4").optional(),
});

const IMAGE_OWNED_KEYS = new Set(["response_format", "prompt", "model", "n", "test_prompt"]);
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};
const VIDEO_TARGET_MIN_S = 5;
const VIDEO_TARGET_MAX_S = 120;
const NON_RETRYABLE_MEDIA_FAILURE =
  /moderation|content policy|safety|审核|违规|敏感|unsupported|not supported|不支持|permission|unauthori[sz]ed|forbidden|not configured|缺少配置/i;
const VIDEO_POST_PLANNING_STAGES = new Set([
  "awaiting_storyboard_approval",
  "generating",
  "shot_review",
  "assembling",
  "final_qa",
  "awaiting_publish_approval",
  "publishing",
]);

const videoCharacterInputSchema = z.object({
  name: z.string().min(1).max(40),
  appearance: z.string().min(1).max(400),
  reference_document_id: z.string().max(32).optional(),
});

const videoShotInputSchema = z.object({
  purpose: z.string().min(1).max(80), plot: z.string().min(1).max(500), emotion: z.string().min(1).max(120),
  character_names: z.array(z.string().min(1).max(40)).max(3), seconds: z.number().int().min(4).max(15), action: z.string().min(1).max(1_000),
  camera: z.object({ shot_size: z.string().min(1).max(80), movement: z.string().min(1).max(160), focus: z.string().max(160).optional() }),
  environment: z.string().min(1).max(500), lighting_palette: z.string().min(1).max(300), audio_direction: z.string().max(500),
  continuity_contract: z.array(z.string().min(1).max(300)).max(20), acceptance_criteria: z.array(z.string().min(1).max(1_200)).min(1).max(20),
});

const createVideoProductionInputSchema = z.object({
  title: z.string().min(1).max(120),
  creative_brief: z.string().min(1).max(4_000),
  plan: z.object({
    target_duration_seconds: z.number().int().min(VIDEO_TARGET_MIN_S).max(VIDEO_TARGET_MAX_S),
    logline: z.string().min(1).max(240), motif: z.string().min(1).max(160), style_bible: z.string().min(1).max(240), setting_bible: z.string().min(1).max(240),
    characters: z.array(videoCharacterInputSchema).max(3), shots: z.array(videoShotInputSchema).min(1).max(12),
  }).superRefine((plan, ctx) => {
    const names = new Set(plan.characters.map((character) => character.name));
    if (names.size !== plan.characters.length) ctx.addIssue({ code: "custom", path: ["characters"], message: "character names must be unique" });
    if (plan.shots.reduce((sum, shot) => sum + shot.seconds, 0) !== plan.target_duration_seconds) ctx.addIssue({ code: "custom", path: ["shots"], message: "shot seconds must equal target_duration_seconds" });
    plan.shots.forEach((shot, shotIndex) => shot.character_names.forEach((name, characterIndex) => {
      if (!names.has(name)) ctx.addIssue({ code: "custom", path: ["shots", shotIndex, "character_names", characterIndex], message: `unknown character ${name}` });
    }));
  }),
});

type CreateVideoProductionInput = z.infer<typeof createVideoProductionInputSchema>;
type VideoCharacterInput = z.infer<typeof videoCharacterInputSchema>;

export interface MediaToolProviders {
  imageProvider: ProviderSnapshot | null;
  videoProviderId: string | null;
}

function isJsonValue(value: unknown): value is JSONValue {
  if (value == null) return true;
  if (["string", "boolean"].includes(typeof value)) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === "object" && Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function imageProviderOptions(extraBody: Record<string, unknown>): Record<string, JSONValue> {
  return Object.fromEntries(
    Object.entries(extraBody).filter(([key, value]) => !IMAGE_OWNED_KEYS.has(key) && isJsonValue(value)),
  ) as Record<string, JSONValue>;
}

function imageMediaType(mediaType: string | undefined, bytes: Uint8Array): string {
  if (mediaType?.startsWith("image/")) return mediaType;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "image/png";
}

function mediaFilename(prompt: string, extension: string, index?: number): string {
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "media";
  return index && index > 0 ? `${slug}-${index + 1}.${extension}` : `${slug}.${extension}`;
}

function imageError(error: unknown): Error {
  if (NoImageGeneratedError.isInstance(error)) {
    const detail = error.cause instanceof Error ? error.cause.message : String(error.cause ?? "");
    return new Error(`图片生成失败：模型未返回图片${detail ? `（${detail.slice(0, 200)}）` : ""}`);
  }
  return error instanceof Error ? error : new Error(`图片生成失败：${String(error).slice(0, 300)}`);
}

function isRetryableMediaFailure(message: string | undefined): boolean {
  return !message || !NON_RETRYABLE_MEDIA_FAILURE.test(message);
}

type GeneratedImage = { document_id: string; filename: string; media_type: string };

async function* generateImages(
  input: { prompts: string[] },
  {
    context,
    toolCallId,
    abortSignal,
  }: { context: MediaToolContext; toolCallId: string; abortSignal?: AbortSignal },
  imageProvider: ProviderSnapshot,
): AsyncGenerator<z.infer<typeof imageOutputSchema> | ToolEmission> {
  yield toolRunning({ count: input.prompts.length });
  try {
    const { model, providerOptionsKey } = createProviderImageModel({
      id: imageProvider.id,
      model: imageProvider.model,
      baseUrl: imageProvider.baseUrl,
      apiKey: imageProvider.apiKey,
    });
    const providerOptions = imageProviderOptions(imageProvider.extraBody);
    const generateOne = async (prompt: string, index: number): Promise<GeneratedImage> => {
      const result = await generateImage({
        model,
        prompt,
        n: 1,
        abortSignal,
        providerOptions: { [providerOptionsKey]: providerOptions },
      });
      const file = result.images[0] ?? result.image;
      const mediaType = imageMediaType(file.mediaType, file.uint8Array);
      const filename = mediaFilename(prompt, IMAGE_EXTENSIONS[mediaType] ?? "png", index);
      const document = await createMediaDocument({
        userId: context.userId,
        orgId: context.orgId,
        conversationId: context.conversationId,
        title: prompt.slice(0, 80),
        filename,
        mimeType: mediaType,
        bytes: file.uint8Array,
        idempotencyKey: `${toolCallId}-${index}`,
      });
      return { document_id: document.id, filename: document.filename, media_type: mediaType };
    };
    const settled = await Promise.allSettled(input.prompts.map(generateOne));
    if (abortSignal?.aborted) throw new DOMException("aborted", "AbortError");
    const images = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const failedItems = settled.flatMap((result, index) =>
      result.status === "rejected"
        ? [{ index, message: imageError(result.reason).message }]
        : [],
    );
    if (images.length === 0) {
      const message = failedItems[0]?.message ?? "图片生成失败";
      yield toolFailed({
        code: "IMAGE_BATCH_FAILED",
        message,
        retryable: isRetryableMediaFailure(message),
        source: "image-provider",
        details: {
          count: input.prompts.length,
          failed: failedItems.length,
          failed_items: failedItems,
        },
      });
      return;
    }
    if (failedItems.length > 0) {
      yield toolPartial(
        {
          images,
          count: input.prompts.length,
          failed: failedItems.length,
          failed_items: failedItems,
          document_id: images[0]?.document_id,
        },
        {
          code: "IMAGE_BATCH_PARTIAL",
          message: `${failedItems.length} 张图片生成失败`,
          retryable: failedItems.some((item) => isRetryableMediaFailure(item.message)),
          source: "image-provider",
          details: { failed_items: failedItems },
        },
      );
      return;
    }
    yield toolCompleted({
      images,
      count: input.prompts.length,
      failed: input.prompts.length - images.length,
      document_id: images[0]?.document_id,
    });
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    logger.error({ toolCallId, err: error }, "generate_image failed");
    throw imageError(error);
  }
}

function videoDocumentId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const documentId = (result as { documentId?: unknown }).documentId;
  return typeof documentId === "string" ? documentId : undefined;
}

async function resolveVideoCharacters(
  characters: VideoCharacterInput[],
  context: MediaToolContext,
): Promise<Array<{ name: string; documentId?: string; appearance: string }>> {
  async function validateDocument(documentId: string) {
    const document = await getDocument(context.userId, documentId);
    if (document.conversation_id !== context.conversationId) {
      throw new Error(`document ${documentId} does not belong to this conversation`);
    }
    const mimeType = document.source_mime_type ?? document.mime_type;
    if (!mimeType.startsWith("image/")) {
      throw new Error(`document ${documentId} is not an image reference`);
    }
    return document;
  }

  return Promise.all(characters.map(async (character) => {
    if (character.reference_document_id) await validateDocument(character.reference_document_id);
    return {
      name: character.name,
      appearance: character.appearance,
      ...(character.reference_document_id ? { documentId: character.reference_document_id } : {}),
    };
  }));
}

async function* createVideoProduction(
  input: CreateVideoProductionInput,
  {
    context,
    toolCallId,
    abortSignal,
  }: { context: MediaToolContext; toolCallId: string; abortSignal?: AbortSignal },
  providers: MediaToolProviders & { videoProviderId: string },
): AsyncGenerator<z.infer<typeof videoProductionOutputSchema> | ToolEmission> {
  const title = input.title;
  const filename = mediaFilename(input.title, "mp4");
  const characterRefs = await resolveVideoCharacters(input.plan.characters, context);
  try {
    const task = await startExecutorTask(
      {
        type: "video-generation",
        ownerRef: toolCallId,
        payload: {
          orgId: context.orgId,
          userId: context.userId,
          conversationId: context.conversationId,
          providerId: providers.videoProviderId,
          imageProviderId: providers.imageProvider?.id,
          creativeBrief: input.creative_brief,
          title,
          filename,
          idempotencyKey: toolCallId,
          plan: {
            targetDurationSec: input.plan.target_duration_seconds,
            logline: input.plan.logline,
            motif: input.plan.motif,
            styleBible: input.plan.style_bible,
            settingBible: input.plan.setting_bible,
            characters: characterRefs,
            shots: input.plan.shots.map((shot) => ({
              purpose: shot.purpose, plot: shot.plot, emotion: shot.emotion, characterNames: shot.character_names,
              seconds: shot.seconds, action: shot.action,
              camera: { shotSize: shot.camera.shot_size, movement: shot.camera.movement, focus: shot.camera.focus },
              environment: shot.environment, lightingPalette: shot.lighting_palette, audioDirection: shot.audio_direction,
              continuityContract: shot.continuity_contract, acceptanceCriteria: shot.acceptance_criteria,
            })),
          },
        },
      },
      abortSignal,
    );
    const base = { kind: "video" as const, title, filename, prompt: input.creative_brief, duration: input.plan.target_duration_seconds, task_id: task.id };
    yield toolRunning(base);
    let terminal: Task | null = null;
    try {
      for await (const snapshot of pollTaskSnapshots(task.id, task.ownerRef, abortSignal)) {
        try {
          const detail = await getVideoProduction(task.id);
          const production = detail.production;
          if (
            VIDEO_POST_PLANNING_STAGES.has(production.stage) &&
            production.shotPlan != null &&
            production.cost.estimatedMicros != null
          ) {
            yield toolCompleted({
              ...base,
              production_id: production.id,
              production_version: production.version,
              production_stage: production.stage,
              ...(production.awaitingAction
                ? { awaiting_action: production.awaitingAction }
                : {}),
            });
            return;
          }
        } catch (error) {
          if (!(error instanceof Error && error.message.includes("not found"))) throw error;
        }
        if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled") {
          terminal = snapshot;
          break;
        }
        yield toolRunning({
          progress_done: snapshot.progress?.done,
          progress_total: snapshot.progress?.total,
          ...base,
        });
      }
    } catch (error) {
      if (error instanceof TaskWaitTimeoutError) {
        yield toolFailed({
          code: "VIDEO_TASK_TIMEOUT",
          message: "视频制片任务创建超时：初步分镜与预算规划超过 30 分钟，已取消任务。",
          retryable: true,
          source: "executor",
          details: base,
        });
        return;
      }
      throw error;
    }
    if (terminal?.status === "failed" || terminal?.status === "cancelled") {
      const message =
        terminal.error ??
        (terminal.status === "cancelled"
          ? "视频制片任务创建已取消"
          : "视频制片任务创建失败");
      yield toolFailed({
        code: terminal.status === "cancelled" ? "VIDEO_TASK_CANCELLED" : "VIDEO_TASK_FAILED",
        message,
        retryable:
          terminal.status === "cancelled" ? false : isRetryableMediaFailure(message),
        source: "executor",
        details: {
          ...base,
          progress_done: terminal.progress?.done,
          progress_total: terminal.progress?.total,
        },
      });
      return;
    }
    if (terminal?.status !== "completed") {
      yield toolFailed({
        code: "VIDEO_TASK_UNEXPECTED",
        message: "视频制片任务在没有完成创建的情况下结束",
        retryable: false,
        source: "executor",
        details: base,
      });
      return;
    }
    yield toolCompleted({
      document_id: videoDocumentId(terminal.result),
      media_type: "video/mp4",
      ...base,
    });
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    logger.error({ toolCallId, err: error }, "create_video_production failed");
    throw error;
  }
}

export function createMediaToolManifests(providers: MediaToolProviders) {
  const imagePolicy = {
    capability: "media" as const,
    effect: "add" as const,
    trust: "closed" as const,
    execution: "inline" as const,
    modes: ["normal" as const],
    uiKind: "image-gallery" as const,
  };
  const videoPolicy = {
    capability: "media" as const,
    effect: "add" as const,
    trust: "closed" as const,
    execution: "durable" as const,
    modes: ["normal" as const],
    uiKind: "video" as const,
  };
  const imagePlanning = {
    summary: "Generate one or more images as a single concurrent gallery batch.",
    prerequisites: providers.imageProvider ? undefined : ["Configure an image provider."],
    parallelizable: true,
  };
  const videoPlanning = {
    summary: "Create a durable video production task and complete after its initial storyboard and cost plan are handed to Executor Workflow.",
    constraints: [
      "Treat this tool as creating a video production task, not as synchronously generating the final video.",
      "The tool is completed once the initial storyboard and cost plan are durable in Executor Workflow, even if approval races ahead before Chat observes the approval state.",
      "Current implementation supports vertical short-drama output; the public capability remains format-neutral.",
      "In any storyboard plan, distinguish narrative sections from generation shots. Each generation shot is one Seedance call and should last about 12 seconds, never more than 15 seconds; split every longer narrative section into multiple shots with contiguous, non-overlapping time ranges. A 60-second video therefore needs at least 5 generation shots even when they are grouped into fewer narrative sections.",
      "Every adjacent generation shot must advance a distinct information or action beat and vary the framing, subject action, or on-screen content. Never pad, loop, or restage the same moment to fill time.",
    ],
    prerequisites: providers.videoProviderId ? undefined : ["Configure a video provider."],
    parallelizable: true,
  };

  const imageManifest = providers.imageProvider
    ? defineAgentTool(
        "generate_images",
        tool({
          description: "Generate and persist one or more images from detailed visual prompts as one gallery batch.",
          inputSchema: z.object({
            prompts: z.array(z.string().min(1).max(4_000)).min(1).max(6),
          }),
          outputSchema: imageOutputSchema,
          contextSchema: mediaToolContextSchema,
          execute: (input, options) => generateImages(input, options, providers.imageProvider!),
        }),
        imagePolicy,
        imagePlanning,
      )
    : defineUnavailableCapability("generate_images", imagePolicy, imagePlanning);

  const videoManifest = providers.videoProviderId
    ? defineAgentTool(
        "create_video_production",
        tool({
          description:
            "Create a durable video production task. Provide the complete creative plan in this native tool call: duration, characters, and every ordered generation shot. The tool completes after Executor materializes that plan and hands it to the director workspace; final media generation continues through approvals and rendering.",
          inputSchema: createVideoProductionInputSchema,
          outputSchema: videoProductionOutputSchema,
          contextSchema: mediaToolContextSchema,
          execute: (input, options) =>
            createVideoProduction(input, options, { ...providers, videoProviderId: providers.videoProviderId! }),
        }),
        videoPolicy,
        videoPlanning,
      )
    : defineUnavailableCapability("create_video_production", videoPolicy, videoPlanning);

  return [imageManifest, videoManifest];
}
