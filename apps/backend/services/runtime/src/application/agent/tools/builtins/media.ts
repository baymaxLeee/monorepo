import { createHash } from "node:crypto";

import { defineAgentTool, toolCompleted, type ToolEmission } from "@repo/agent-runtime";
import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import { logger } from "../../../../infrastructure/observability/logger.js";
import { getSessionAttachment, publishSessionFile } from "../../../session-files.js";
import { workspaceFilename } from "../../../workspace-paths.js";
import { runDurableTask } from "../../tasks/durable-task.js";
import { mediaToolContextSchema, type MediaToolContext } from "../context.js";

const generatedTaskFileSchema = z.object({
  assetId: z.string().uuid(),
  revisionId: z.string().uuid(),
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const imageTaskResultSchema = z.object({
  images: z.array(generatedTaskFileSchema).min(1),
  count: z.number().int().positive(),
  failed: z.number().int().nonnegative(),
  failedItems: z.array(z.object({ index: z.number().int().nonnegative(), message: z.string() })).optional(),
});

const videoTaskResultSchema = z.object({
  video: generatedTaskFileSchema,
  durationSeconds: z.number().int().nullable(),
});

const generatedFileOutputSchema = z.object({
  file_id: z.string(),
  filename: z.string(),
  media_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  workspace_path: z.string(),
});

const DEFAULT_SEEDREAM_MODEL = "doubao-seedream-5-0-260128";
const DEFAULT_SEEDANCE_MODEL = "doubao-seedance-2-5-260628";
const imageResolutionSchema = z.enum(["1K", "1.5K", "2K"]);
const aspectRatioSchema = z.enum(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"]);
const videoResolutionSchema = z.enum(["480p", "720p", "1080p", "4k"]);
const videoRatioSchema = z.enum(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]);

const imageSizes: Record<z.infer<typeof imageResolutionSchema>, Record<z.infer<typeof aspectRatioSchema>, string>> = {
  "1K": {
    "1:1": "1024x1024",
    "4:3": "1152x864",
    "3:4": "864x1152",
    "16:9": "1424x800",
    "9:16": "800x1424",
    "3:2": "1248x832",
    "2:3": "832x1248",
    "21:9": "1568x672",
  },
  "1.5K": {
    "1:1": "1536x1536",
    "4:3": "1792x1344",
    "3:4": "1344x1792",
    "16:9": "2048x1152",
    "9:16": "1152x2048",
    "3:2": "1872x1248",
    "2:3": "1248x1872",
    "21:9": "2352x1008",
  },
  "2K": {
    "1:1": "2048x2048",
    "4:3": "2368x1776",
    "3:4": "1776x2368",
    "16:9": "2816x1584",
    "9:16": "1584x2816",
    "3:2": "2496x1664",
    "2:3": "1664x2496",
    "21:9": "3136x1344",
  },
};

const imageOutputSchema = z.object({
  kind: z.literal("image"),
  images: z.array(generatedFileOutputSchema).min(1),
  count: z.number().int().positive(),
  failed: z.number().int().nonnegative(),
});

const videoOutputSchema = z.object({
  kind: z.literal("video"),
  file: generatedFileOutputSchema,
  prompt: z.string(),
  duration_seconds: z.number().int().nullable(),
});

// defineAgentTool unwraps ToolEmission values and uses this schema for the
// completed data payload. AI SDK's tool() types the pre-wrapper execute result,
// so keep the runtime schema while exposing the emission type to its overload.
function emittedDataSchema<T>(schema: z.ZodType<T>): z.ZodType<ToolEmission<T>> {
  return schema as unknown as z.ZodType<ToolEmission<T>>;
}

const referenceFileIdsSchema = z
  .array(z.string().min(1).max(32))
  .max(5)
  .default([])
  .describe("Runtime Session image file ids to use as generation or editing references.");

const generateImagesInputSchema = z.object({
  prompts: z
    .array(z.string().min(1).max(4_000))
    .min(1)
    .max(6)
    .describe("One complete visual prompt per requested image."),
  resolution: imageResolutionSchema.describe("Confirmed output resolution tier."),
  aspect_ratio: aspectRatioSchema.describe("Confirmed output aspect ratio."),
  reference_file_ids: referenceFileIdsSchema,
});

const generateVideoInputSchema = z.object({
  prompt: z.string().min(1).max(4_000).describe("Complete visual, motion, camera, lighting, and audio direction."),
  reference_file_ids: referenceFileIdsSchema,
  duration_seconds: z.number().int().min(4).max(30).describe("Confirmed clip duration in seconds."),
  resolution: videoResolutionSchema.describe("Confirmed video resolution."),
  ratio: videoRatioSchema.describe("Confirmed video aspect ratio, or adaptive for reference-guided generation."),
  filename: z.string().min(1).max(160).optional(),
});

function mediaFilename(prompt: string, extension: string): string {
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "media";
  return `${slug}.${extension}`;
}

function mediaProvider(context: MediaToolContext, kind: "image" | "video") {
  const candidates = context.media.providers.filter((candidate) => candidate.providerKind === kind);
  const provider =
    kind === "video"
      ? candidates.find((candidate) => candidate.model.toLowerCase() === DEFAULT_SEEDANCE_MODEL)
      : (candidates.find((candidate) => candidate.model.toLowerCase() === DEFAULT_SEEDREAM_MODEL) ??
        candidates.find((candidate) => candidate.model.toLowerCase().includes("seedream")));
  if (!provider) {
    const expected = kind === "video" ? DEFAULT_SEEDANCE_MODEL : DEFAULT_SEEDREAM_MODEL;
    throw new Error(`the ${kind} capability requires configured model ${expected}`);
  }
  return provider;
}

function durableOwnerRef(sessionId: string, toolCallId: string): string {
  return createHash("sha256")
    .update(JSON.stringify([sessionId, toolCallId]))
    .digest("hex");
}

async function resolveImageReferences(fileIds: string[], context: MediaToolContext) {
  const unique = [...new Set(fileIds)];
  return Promise.all(
    unique.map(async (fileId) => {
      const file = await getSessionAttachment(context.sessionId, fileId);
      if (!file.mime_type.startsWith("image/")) throw new Error(`session file ${fileId} is not an image reference`);
      return {
        assetId: file.asset_id,
        revisionId: file.revision_id,
        mediaType: file.mime_type,
      };
    }),
  );
}

async function publishGeneratedFile(input: {
  context: MediaToolContext;
  toolCallId: string;
  taskId: string;
  index: number;
  file: z.infer<typeof generatedTaskFileSchema>;
}) {
  const filename = workspaceFilename(input.file.filename) ?? `generated-${input.index + 1}`;
  const published = await publishSessionFile({
    sessionId: input.context.sessionId,
    assetId: input.file.assetId,
    revisionId: input.file.revisionId,
    title: filename,
    filename,
    mediaType: input.file.mediaType,
    sizeBytes: input.file.sizeBytes,
    sha256: input.file.sha256,
    idempotencyKey: `media:${input.taskId}:${input.index}`,
    workspacePath: `/workspace/generated-media/${input.taskId}/${filename}`,
    writerType: "agent",
    writerId: input.toolCallId,
  });
  return {
    file_id: published.id,
    filename: published.filename,
    media_type: published.mime_type,
    size_bytes: published.size,
    workspace_path: published.workspace_path,
  };
}

async function* generateImages(
  input: z.infer<typeof generateImagesInputSchema>,
  { context, toolCallId, abortSignal }: ToolExecutionOptions<MediaToolContext>,
): AsyncGenerator<ToolEmission<z.infer<typeof imageOutputSchema>>> {
  try {
    const provider = mediaProvider(context, "image");
    const ownerRef = durableOwnerRef(context.sessionId, toolCallId);
    const references = await resolveImageReferences(input.reference_file_ids, context);
    const task = await runDurableTask(
      {
        type: "image-generation",
        ownerRef,
        payload: {
          provider,
          prompts: input.prompts,
          references,
          size: imageSizes[input.resolution][input.aspect_ratio],
          idempotencyKey: ownerRef,
          sessionId: context.sessionId,
        },
      },
      abortSignal,
    );
    const result = imageTaskResultSchema.parse(task.result);
    const images = await Promise.all(
      result.images.map((file, index) => publishGeneratedFile({ context, toolCallId, taskId: task.id, index, file })),
    );
    yield toolCompleted({ kind: "image" as const, images, count: result.count, failed: result.failed });
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    logger.error({ toolCallId, err: error }, "generate_images failed");
    throw error;
  }
}

async function* generateVideo(
  input: z.infer<typeof generateVideoInputSchema>,
  { context, toolCallId, abortSignal }: ToolExecutionOptions<MediaToolContext>,
): AsyncGenerator<ToolEmission<z.infer<typeof videoOutputSchema>>> {
  try {
    const provider = mediaProvider(context, "video");
    const ownerRef = durableOwnerRef(context.sessionId, toolCallId);
    const references = await resolveImageReferences(input.reference_file_ids, context);
    const filename = workspaceFilename(input.filename ?? mediaFilename(input.prompt, "mp4")) ?? "generated-video.mp4";
    const task = await runDurableTask(
      {
        type: "video-generation",
        ownerRef,
        payload: {
          sessionId: context.sessionId,
          provider: {
            ...provider,
            extraBody: { ...provider.extraBody, ratio: input.ratio, resolution: input.resolution },
          },
          prompt: input.prompt,
          references: references.map(({ assetId, revisionId }) => ({ assetId, revisionId })),
          durationSeconds: input.duration_seconds,
          filename,
          idempotencyKey: ownerRef,
        },
      },
      abortSignal,
    );
    const result = videoTaskResultSchema.parse(task.result);
    const file = await publishGeneratedFile({
      context,
      toolCallId,
      taskId: task.id,
      index: 0,
      file: result.video,
    });
    yield toolCompleted({
      kind: "video" as const,
      file,
      prompt: input.prompt,
      duration_seconds: result.durationSeconds,
    });
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    logger.error({ toolCallId, err: error }, "generate_video failed");
    throw error;
  }
}

export function createMediaToolManifests() {
  const imageManifest = defineAgentTool(
    "generate_images",
    tool<z.infer<typeof generateImagesInputSchema>, ToolEmission<z.infer<typeof imageOutputSchema>>, MediaToolContext>({
      description:
        "Generate or edit images with the configured Seedream capability from complete prompts and optional Runtime Session image file references. This call can take several minutes and returns only after durable generation and Session file publication finish. The generated images are already displayed to the user; do not add Markdown image links.",
      inputSchema: generateImagesInputSchema,
      outputSchema: emittedDataSchema(imageOutputSchema),
      contextSchema: mediaToolContextSchema,
      execute: generateImages,
    }),
    {
      capability: "media",
      effect: "add",
      trust: "closed",
      execution: "durable",
      uiKind: "image-gallery",
    },
    {
      summary:
        "Generate or edit images and wait for their durable Session files. Search aliases: 图片生成, 图像生成, 图片编辑.",
      prerequisites: [
        "Immediately before every call, use ask_user once to confirm resolution, aspect ratio, and image count. Then call this as the final work-producing tool; do not run it in parallel with other tools.",
      ],
      constraints: ["Wait for the terminal tool result before answering."],
      parallelizable: false,
    },
  );

  const videoManifest = defineAgentTool(
    "generate_video",
    tool<z.infer<typeof generateVideoInputSchema>, ToolEmission<z.infer<typeof videoOutputSchema>>, MediaToolContext>({
      description:
        "Generate one video clip with Seedance 2.5 from a complete prompt and optional Runtime Session image file references. This call can take many minutes and returns only after the durable provider task completes and the video is published as a Session file. The video is already displayed to the user; do not add a duplicate Markdown link.",
      inputSchema: generateVideoInputSchema,
      outputSchema: emittedDataSchema(videoOutputSchema),
      contextSchema: mediaToolContextSchema,
      execute: generateVideo,
    }),
    {
      capability: "media",
      effect: "add",
      trust: "closed",
      execution: "durable",
      uiKind: "video",
    },
    {
      summary: "Generate a video clip and wait for its durable Session file. Search aliases: 视频生成, 生成视频.",
      prerequisites: [
        "Immediately before every call, use ask_user once to confirm resolution, aspect ratio, and duration. Then call this as the final work-producing tool; do not run it in parallel with other tools.",
      ],
      constraints: [
        "Do not create a storyboard approval workflow. Wait for the terminal tool result before answering.",
      ],
      parallelizable: false,
    },
  );

  return [imageManifest, videoManifest];
}
