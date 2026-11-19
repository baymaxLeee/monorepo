import { createHash } from "node:crypto";

import { defineAgentTool } from "@repo/agent-runtime/tools/manifest";
import { toolCompleted, type ToolEmission } from "@repo/agent-runtime/tools/outcome";
import { tool, type ModelMessage, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import {
  getTaskProvider,
  listProviderCatalog,
  type ProviderCatalogItem,
} from "../../../../infrastructure/clients/admin.js";
import { getDocument, knowledgeDocumentSessionId } from "../../../../infrastructure/clients/knowledge.js";
import { logger } from "../../../../infrastructure/observability/logger.js";
import { startDurableTask } from "../../tasks/durable-task.js";
import { mediaToolContextSchema, type MediaToolContext } from "../context.js";

const imageOutputSchema = z.object({
  kind: z.literal("image"),
  task_id: z.string(),
  count: z.number(),
});

const imageGenerationConfigurationSchema = z.object({
  provider_id: z.string().min(1).max(32).describe("Image provider id explicitly chosen by the user."),
  prompts: z
    .array(z.string().min(1).max(4_000))
    .min(1)
    .max(6)
    .describe("One complete visual prompt per requested image; all prompts run as one batch."),
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
    .describe("Optional session image document id used as the visual reference."),
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

const videoGenerationConfigurationSchema = z.object({
  provider_id: z.string().min(1).max(32).describe("Video provider id explicitly chosen by the user."),
  image_provider_id: z
    .string()
    .min(1)
    .max(32)
    .optional()
    .describe("Image provider explicitly chosen by the user when character reference sheets are required."),
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

export const confirmationIdSchema = z.string().regex(/^media_[a-f0-9]{32}$/);
const createVideoProductionInputSchema = videoGenerationConfigurationSchema.extend({
  confirmation_id: confirmationIdSchema.describe(
    "Exact confirmation id returned by prepare_media_generation and selected by the user in the second ask_user call.",
  ),
});
const generateImagesInputSchema = imageGenerationConfigurationSchema.extend({
  confirmation_id: confirmationIdSchema.describe(
    "Exact confirmation id returned by prepare_media_generation and selected by the user in the second ask_user call.",
  ),
});

const prepareMediaGenerationInputSchema = z.object({
  kind: z.enum(["image", "video"]),
  configuration: z.record(z.string(), z.json()),
});
const prepareMediaGenerationOutputSchema = z.object({
  kind: z.enum(["image", "video"]),
  confirmation_id: confirmationIdSchema,
});

type CreateVideoProductionInput = z.infer<typeof createVideoProductionInputSchema>;
type VideoCharacterInput = z.infer<typeof videoCharacterInputSchema>;

const mediaModelCatalogOutputSchema = z.object({
  kind: z.enum(["image", "video"]),
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      model: z.string(),
      is_default: z.boolean(),
    }),
  ),
});

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
  input: z.infer<typeof generateImagesInputSchema>,
  { context, toolCallId, abortSignal, messages }: ToolExecutionOptions<MediaToolContext>,
): AsyncGenerator<z.infer<typeof imageOutputSchema> | ToolEmission> {
  try {
    assertMediaGenerationConfirmed("image", input, [input.provider_id], input.confirmation_id, messages);
    const provider = await getTaskProvider(context.tenantId, context.workspaceId, input.provider_id);
    if (provider.providerKind !== "image" || !provider.isEnabled) {
      throw new Error(`provider ${provider.id} is not an enabled image model`);
    }
    const task = await startDurableTask(
      {
        type: "image-generation",
        ownerRef: toolCallId,
        payload: {
          providerId: provider.id,
          prompts: input.prompts,
          idempotencyKey: toolCallId,
          userId: context.userId,
          sessionId: context.sessionId,
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
    if (knowledgeDocumentSessionId(document) !== context.sessionId) {
      throw new Error(`document ${documentId} does not belong to this session`);
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
  { context, toolCallId, abortSignal, messages }: ToolExecutionOptions<MediaToolContext>,
): AsyncGenerator<z.infer<typeof videoProductionOutputSchema> | ToolEmission> {
  assertMediaGenerationConfirmed(
    "video",
    input,
    [input.provider_id, ...(input.image_provider_id ? [input.image_provider_id] : [])],
    input.confirmation_id,
    messages,
  );
  const videoProvider = await getTaskProvider(context.tenantId, context.workspaceId, input.provider_id);
  if (videoProvider.providerKind !== "video" || !videoProvider.isEnabled) {
    throw new Error(`provider ${videoProvider.id} is not an enabled video model`);
  }
  const imageProvider = input.image_provider_id
    ? await getTaskProvider(context.tenantId, context.workspaceId, input.image_provider_id)
    : null;
  if (imageProvider && (imageProvider.providerKind !== "image" || !imageProvider.isEnabled)) {
    throw new Error(`provider ${imageProvider.id} is not an enabled image model`);
  }
  const title = input.title;
  const filename = mediaFilename(input.title, "mp4");
  const characterRefs = await resolveVideoCharacters(input.plan.characters, context);
  try {
    const task = await startDurableTask(
      {
        type: "video-generation",
        ownerRef: toolCallId,
        payload: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          userId: context.userId,
          sessionId: context.sessionId,
          providerId: videoProvider.id,
          imageProviderId: imageProvider?.id,
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

function availableMediaModels(catalog: ProviderCatalogItem[], kind: "image" | "video") {
  return catalog
    .filter((provider) => provider.providerKind === kind && provider.isEnabled)
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      model: provider.model,
      is_default: provider.isDefault,
    }));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function mediaConfirmationId(kind: "image" | "video", configuration: unknown): string {
  return `media_${createHash("sha256")
    .update(`${kind}\0${stableJson(configuration)}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function toolOutputData(output: unknown): unknown {
  if (!output || typeof output !== "object" || !("type" in output) || !("value" in output)) return undefined;
  const envelope = output.value;
  if (!envelope || typeof envelope !== "object") return undefined;
  if (!("ok" in envelope) || envelope.ok !== true || !("status" in envelope) || envelope.status !== "completed") {
    return undefined;
  }
  return "data" in envelope ? envelope.data : undefined;
}

function confirmationHistory(messages: ModelMessage[]) {
  const calls = new Map<string, { toolName: string; input: unknown; position: number }>();
  const results: Array<{ toolName: string; input: unknown; data: unknown; position: number }> = [];
  let position = 0;
  let latestUserPosition = 0;
  for (const message of messages) {
    position += 1;
    if (message.role === "user") latestUserPosition = position;
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      position += 1;
      if (part.type === "tool-call") {
        calls.set(part.toolCallId, { toolName: part.toolName, input: part.input, position });
      } else if (part.type === "tool-result") {
        const call = calls.get(part.toolCallId);
        if (!call || call.toolName !== part.toolName) continue;
        results.push({ toolName: part.toolName, input: call.input, data: toolOutputData(part.output), position });
      }
    }
  }
  return { results, latestUserPosition };
}

function answerValues(data: unknown, id: string): string[] {
  if (!data || typeof data !== "object" || !("answers" in data) || !Array.isArray(data.answers)) return [];
  const answer = data.answers.find((candidate): candidate is { id: string; values: string[] } =>
    Boolean(
      candidate &&
      typeof candidate === "object" &&
      "id" in candidate &&
      candidate.id === id &&
      "values" in candidate &&
      Array.isArray(candidate.values) &&
      candidate.values.every((value: unknown) => typeof value === "string"),
    ),
  );
  return answer?.values ?? [];
}

function findLastMatching<T>(values: readonly T[], predicate: (value: T) => boolean): T | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== undefined && predicate(value)) return value;
  }
  return undefined;
}

export function assertMediaGenerationConfirmed(
  kind: "image" | "video",
  input: Record<string, unknown>,
  providerIds: string[],
  confirmationId: string,
  messages: ModelMessage[],
) {
  const { confirmation_id: _confirmationId, ...configuration } = input;
  if (mediaConfirmationId(kind, configuration) !== confirmationId) {
    throw new Error("media generation configuration changed after confirmation");
  }
  const { results: history, latestUserPosition } = confirmationHistory(messages);
  const catalogPositions = providerIds.map((providerId) => {
    const result = findLastMatching(history, (entry) => {
      if (entry.toolName !== "list_media_models" || !entry.data || typeof entry.data !== "object") return false;
      if (!("models" in entry.data) || !Array.isArray(entry.data.models)) return false;
      return entry.data.models.some(
        (model) => model && typeof model === "object" && "id" in model && model.id === providerId,
      );
    });
    if (!result || result.position <= latestUserPosition) {
      throw new Error(`provider ${providerId} was not selected from a fresh media model list`);
    }
    return result.position;
  });
  const selection = findLastMatching(
    history,
    (entry) =>
      entry.toolName === "ask_user" &&
      providerIds.every((providerId) => answerValues(entry.data, "media_model_selection").includes(providerId)),
  );
  if (!selection) throw new Error("media model selection was not confirmed by the user");
  const preparation = findLastMatching(
    history,
    (entry) =>
      entry.toolName === "prepare_media_generation" &&
      entry.data !== null &&
      entry.data !== undefined &&
      typeof entry.data === "object" &&
      "confirmation_id" in entry.data &&
      entry.data.confirmation_id === confirmationId,
  );
  if (!preparation) throw new Error("media generation configuration was not prepared for confirmation");
  const confirmation = findLastMatching(
    history,
    (entry) =>
      entry.toolName === "ask_user" &&
      answerValues(entry.data, "media_generation_configuration").includes(confirmationId),
  );
  if (!confirmation) throw new Error("media generation configuration was not confirmed by the user");
  if (
    Math.max(...catalogPositions) >= selection.position ||
    selection.position >= preparation.position ||
    preparation.position >= confirmation.position
  ) {
    throw new Error("media model selection and configuration confirmation occurred out of order");
  }
}

export function createMediaToolManifests() {
  const imagePolicy = {
    capability: "media" as const,
    effect: "add" as const,
    trust: "closed" as const,
    execution: "durable" as const,
    streaming: true,
    uiKind: "image-gallery" as const,
  };
  const videoPolicy = {
    capability: "media" as const,
    effect: "add" as const,
    trust: "closed" as const,
    execution: "durable" as const,
    streaming: true,
    uiKind: "video" as const,
  };
  const imagePlanning = {
    summary: "Start one durable background image-generation task for the complete gallery batch.",
    prerequisites: [
      "Call list_media_models for image models, ask the user to choose one using ask_user question id media_model_selection, call prepare_media_generation with the complete prompts/configuration, then ask the user to confirm it using a separate ask_user question id media_generation_configuration whose fixed choice value is the returned confirmation_id.",
    ],
    parallelizable: false,
  };
  const videoPlanning = {
    summary: "Submit a durable video production task and return its task/production ID immediately.",
    constraints: [
      "Treat this tool as creating a video production task, not as synchronously generating the final video.",
      "Tool completion means Runtime worker accepted the task; storyboard planning, approvals, generation, and rendering continue asynchronously.",
      "Current implementation supports vertical short-drama output; the public capability remains format-neutral.",
      "In any storyboard plan, distinguish narrative sections from generation shots. Each generation shot is one Seedance call and should last about 12 seconds, never more than 15 seconds; split every longer narrative section into multiple shots with contiguous, non-overlapping time ranges. A 60-second video therefore needs at least 5 generation shots even when they are grouped into fewer narrative sections.",
      "Every adjacent generation shot must advance a distinct information or action beat and vary the framing, subject action, or on-screen content. Never pad, loop, or restage the same moment to fill time.",
    ],
    prerequisites: [
      "Call list_media_models for video models (and image models when needed), ask the user to choose using ask_user question id media_model_selection, call prepare_media_generation with the complete creative brief/duration/shots/configuration, then ask the user to confirm it using a separate ask_user question id media_generation_configuration whose fixed choice value is the returned confirmation_id.",
    ],
    parallelizable: false,
  };

  const catalogManifest = defineAgentTool(
    "list_media_models",
    tool({
      description:
        "List the currently enabled Admin-configured image or video models. Always call this immediately before asking the user which media model to use; never rely on a model id from instructions or an earlier run.",
      inputSchema: z.object({ kind: z.enum(["image", "video"]) }),
      outputSchema: mediaModelCatalogOutputSchema,
      contextSchema: mediaToolContextSchema,
      execute: async (input, { context }) => {
        const catalog = await listProviderCatalog(context.tenantId, context.workspaceId);
        return { kind: input.kind, models: availableMediaModels(catalog, input.kind) };
      },
    }),
    { capability: "media", effect: "none", trust: "closed", execution: "inline" },
    {
      summary: "List enabled image or video models before asking the user to choose one.",
      parallelizable: false,
    },
  );

  const prepareManifest = defineAgentTool(
    "prepare_media_generation",
    tool({
      description:
        "Freeze the complete image or video generation configuration and return its confirmation id. Call only after the user selected provider ids in ask_user. Then present the complete configuration in a separate ask_user question with id media_generation_configuration and a fixed choice whose value is exactly confirmation_id.",
      inputSchema: prepareMediaGenerationInputSchema,
      outputSchema: prepareMediaGenerationOutputSchema,
      contextSchema: mediaToolContextSchema,
      execute: (input) => ({
        kind: input.kind,
        confirmation_id: mediaConfirmationId(input.kind, input.configuration),
      }),
    }),
    { capability: "media", effect: "none", trust: "closed", execution: "inline" },
    { summary: "Freeze a complete media configuration before the second user confirmation.", parallelizable: false },
  );

  const imageManifest = defineAgentTool(
    "generate_images",
    tool({
      description:
        "Start a durable background task that generates and persists one or more images. The server rejects the call unless the current user turn contains a fresh list_media_models result, separate media_model_selection and media_generation_configuration ask_user answers, and a matching prepare_media_generation confirmation_id.",
      inputSchema: generateImagesInputSchema,
      inputExamples: [
        {
          input: {
            provider_id: "selected-image-provider-id",
            prompts: [
              "Editorial isometric illustration of an AI agent tool loop, dark navy background, cyan accents, no text",
            ],
            confirmation_id: "media_0123456789abcdef0123456789abcdef",
          },
        },
      ],
      outputSchema: imageOutputSchema,
      contextSchema: mediaToolContextSchema,
      execute: generateImages,
    }),
    imagePolicy,
    imagePlanning,
  );

  const videoManifest = defineAgentTool(
    "create_video_production",
    tool({
      description:
        "Start a durable video production task and return immediately after Runtime worker accepts it. The server rejects the call unless the current user turn contains fresh model-list results, separate media_model_selection and media_generation_configuration ask_user answers, and a matching prepare_media_generation confirmation_id.",
      inputSchema: createVideoProductionInputSchema,
      outputSchema: videoProductionOutputSchema,
      contextSchema: mediaToolContextSchema,
      execute: createVideoProduction,
    }),
    videoPolicy,
    videoPlanning,
  );

  return [catalogManifest, prepareManifest, imageManifest, videoManifest];
}
