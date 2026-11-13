import { tool } from "ai";
import { z } from "zod";

import type { ProviderSnapshot } from "../../../../infrastructure/clients/admin.js";
import { getDocument } from "../../../../infrastructure/clients/knowledge.js";
import { logger } from "../../../../infrastructure/observability/logger.js";
import { startExecutorTask } from "../../tasks/executor-task.js";
import { mediaToolContextSchema, type MediaToolContext } from "../context.js";
import { defineAgentTool, defineUnavailableCapability } from "../manifest.js";
import { toolCompleted, type ToolEmission } from "../outcome.js";

const imageOutputSchema = z.object({
  kind: z.literal("image"),
  task_id: z.string(),
  count: z.number(),
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

const VIDEO_TARGET_MIN_S = 5;
const VIDEO_TARGET_MAX_S = 120;

const videoCharacterInputSchema = z.object({
  name: z.string().min(1).max(40).describe("Stable character name referenced by shot.character_names."),
  appearance: z.string().min(1).max(400).describe("Persistent visual identity and wardrobe description."),
  reference_document_id: z
    .string()
    .max(32)
    .optional()
    .describe("Optional conversation image document id used as the visual reference."),
});

const videoShotInputSchema = z.object({
  purpose: z.string().min(1).max(80),
  plot: z.string().min(1).max(500),
  emotion: z.string().min(1).max(120),
  character_names: z.array(z.string().min(1).max(40)).max(3),
  seconds: z.number().int().min(4).max(15),
  action: z.string().min(1).max(1_000),
  camera: z.object({
    shot_size: z.string().min(1).max(80),
    movement: z.string().min(1).max(160),
    focus: z.string().max(160).optional(),
  }),
  environment: z.string().min(1).max(500),
  lighting_palette: z.string().min(1).max(300),
  audio_direction: z.string().max(500),
  continuity_contract: z.array(z.string().min(1).max(300)).max(20),
  acceptance_criteria: z.array(z.string().min(1).max(1_200)).min(1).max(20),
});

const createVideoProductionInputSchema = z.object({
  title: z.string().min(1).max(120).describe("User-visible production title."),
  creative_brief: z
    .string()
    .min(1)
    .max(4_000)
    .describe("Complete creative intent, audience, narrative, visual direction, and constraints."),
  plan: z
    .object({
      target_duration_seconds: z
        .number()
        .int()
        .min(VIDEO_TARGET_MIN_S)
        .max(VIDEO_TARGET_MAX_S)
        .describe("Exact total duration; it must equal the sum of every shot.seconds."),
      logline: z.string().min(1).max(240),
      motif: z.string().min(1).max(160),
      style_bible: z.string().min(1).max(240),
      setting_bible: z.string().min(1).max(240),
      characters: z
        .array(videoCharacterInputSchema)
        .max(3)
        .describe("Characters used by shots; use an empty array when no recurring character exists."),
      shots: z
        .array(videoShotInputSchema)
        .min(1)
        .max(12)
        .describe("Complete ordered generation-shot list. Each shot is one provider generation call."),
    })
    .superRefine((plan, ctx) => {
      const names = new Set(plan.characters.map((character) => character.name));
      if (names.size !== plan.characters.length) {
        ctx.addIssue({ code: "custom", path: ["characters"], message: "character names must be unique" });
      }
      if (plan.shots.reduce((sum, shot) => sum + shot.seconds, 0) !== plan.target_duration_seconds) {
        ctx.addIssue({ code: "custom", path: ["shots"], message: "shot seconds must equal target_duration_seconds" });
      }
      plan.shots.forEach((shot, shotIndex) =>
        shot.character_names.forEach((name, characterIndex) => {
          if (!names.has(name)) {
            ctx.addIssue({
              code: "custom",
              path: ["shots", shotIndex, "character_names", characterIndex],
              message: `unknown character ${name}`,
            });
          }
        }),
      );
    }),
});

type CreateVideoProductionInput = z.infer<typeof createVideoProductionInputSchema>;
type VideoCharacterInput = z.infer<typeof videoCharacterInputSchema>;

export interface MediaToolProviders {
  imageProvider: ProviderSnapshot | null;
  videoProviderId: string | null;
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

async function* generateImages(
  input: { prompts: string[] },
  { context, toolCallId, abortSignal }: { context: MediaToolContext; toolCallId: string; abortSignal?: AbortSignal },
  imageProvider: ProviderSnapshot,
): AsyncGenerator<z.infer<typeof imageOutputSchema> | ToolEmission> {
  try {
    const task = await startExecutorTask(
      {
        type: "image-generation",
        ownerRef: toolCallId,
        payload: {
          providerId: imageProvider.id,
          prompts: input.prompts,
          idempotencyKey: toolCallId,
          userId: context.userId,
          conversationId: context.conversationId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      },
      abortSignal,
    );
    yield toolCompleted({ kind: "image", task_id: task.id, count: input.prompts.length });
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    logger.error({ toolCallId, err: error }, "generate_images task start failed");
    throw error;
  }
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

  return Promise.all(
    characters.map(async (character) => {
      if (character.reference_document_id) {
        await validateDocument(character.reference_document_id);
      }
      return {
        name: character.name,
        appearance: character.appearance,
        ...(character.reference_document_id ? { documentId: character.reference_document_id } : {}),
      };
    }),
  );
}

async function* createVideoProduction(
  input: CreateVideoProductionInput,
  { context, toolCallId, abortSignal }: { context: MediaToolContext; toolCallId: string; abortSignal?: AbortSignal },
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
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
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
              purpose: shot.purpose,
              plot: shot.plot,
              emotion: shot.emotion,
              characterNames: shot.character_names,
              seconds: shot.seconds,
              action: shot.action,
              camera: { shotSize: shot.camera.shot_size, movement: shot.camera.movement, focus: shot.camera.focus },
              environment: shot.environment,
              lightingPalette: shot.lighting_palette,
              audioDirection: shot.audio_direction,
              continuityContract: shot.continuity_contract,
              acceptanceCriteria: shot.acceptance_criteria,
            })),
          },
        },
      },
      abortSignal,
    );
    const base = {
      kind: "video" as const,
      title,
      filename,
      prompt: input.creative_brief,
      duration: input.plan.target_duration_seconds,
      task_id: task.id,
    };
    yield toolCompleted({ ...base, production_id: task.id, production_stage: task.status });
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw error;
    }
    logger.error({ toolCallId, err: error }, "create_video_production failed");
    throw error;
  }
}

export function createMediaToolManifests(providers: MediaToolProviders) {
  const imagePolicy = {
    capability: "media" as const,
    effect: "add" as const,
    trust: "closed" as const,
    execution: "durable" as const,
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
    summary: "Start one durable background image-generation task for the complete gallery batch.",
    prerequisites: providers.imageProvider ? undefined : ["Configure an image provider."],
    parallelizable: false,
  };
  const videoPlanning = {
    summary: "Submit a durable video production task and return its task/production ID immediately.",
    constraints: [
      "Treat this tool as creating a video production task, not as synchronously generating the final video.",
      "Tool completion means Executor accepted the task; storyboard planning, approvals, generation, and rendering continue asynchronously.",
      "Current implementation supports vertical short-drama output; the public capability remains format-neutral.",
      "In any storyboard plan, distinguish narrative sections from generation shots. Each generation shot is one Seedance call and should last about 12 seconds, never more than 15 seconds; split every longer narrative section into multiple shots with contiguous, non-overlapping time ranges. A 60-second video therefore needs at least 5 generation shots even when they are grouped into fewer narrative sections.",
      "Every adjacent generation shot must advance a distinct information or action beat and vary the framing, subject action, or on-screen content. Never pad, loop, or restage the same moment to fill time.",
    ],
    prerequisites: providers.videoProviderId ? undefined : ["Configure a video provider."],
    parallelizable: false,
  };

  const imageManifest = providers.imageProvider
    ? defineAgentTool(
        "generate_images",
        tool({
          description:
            "Start a durable background task that generates and persists one or more images. Return immediately after Executor accepts the task.",
          inputSchema: z.object({
            prompts: z
              .array(z.string().min(1).max(4_000))
              .min(1)
              .max(6)
              .describe("One complete visual prompt per requested image; all prompts run as one batch."),
          }),
          inputExamples: [
            {
              input: {
                prompts: [
                  "Editorial isometric illustration of an AI agent tool loop, dark navy background, cyan accents, no text",
                ],
              },
            },
          ],
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
            "Start a durable video production task and return immediately after Executor accepts it. Provide the complete creative plan: duration, characters, and every ordered generation shot. Planning, approvals, generation, and rendering continue in the background.",
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
