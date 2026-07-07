import { generateImage, NoImageGeneratedError, tool, type JSONValue } from "ai";
import { z } from "zod";

import { createProviderImageModel } from "@backend/transport-ts/provider-model";
import type { ProviderSnapshot } from "../../../clients/admin.js";
import type { Task } from "../../../clients/executor.js";
import { createMediaDocument } from "../../../clients/knowledge.js";
import {
  pollTaskSnapshots,
  startTaskResilient,
  TaskWaitTimeoutError,
} from "../../tasks/executor-task.js";
import { mediaToolContextSchema, type MediaToolContext } from "../context.js";
import { defineAgentTool, defineUnavailableCapability } from "../manifest.js";

const imageOutputSchema = z.union([
  z.object({ ok: z.literal(true), status: z.literal("generating"), count: z.number() }),
  z.object({
    ok: z.literal(true),
    status: z.literal("completed"),
    images: z.array(
      z.object({ document_id: z.string(), filename: z.string(), media_type: z.string() }),
    ),
    count: z.number(),
    failed: z.number(),
    document_id: z.string().optional(),
  }),
]);

const videoOutputSchema = z.object({
  // `ok:false` carries an executor-reported terminal failure/cancellation as a
  // structured output so ChatVideoCard renders the failed state off the tool
  // part (ADR-0035); poll errors/timeout/abort still throw.
  ok: z.boolean(),
  status: z.string(),
  kind: z.literal("video"),
  title: z.string(),
  filename: z.string(),
  prompt: z.string(),
  duration: z.number().optional(),
  task_id: z.string(),
  progress_done: z.number().optional(),
  progress_total: z.number().optional(),
  document_id: z.string().optional(),
  media_type: z.literal("video/mp4").optional(),
  error: z.string().optional(),
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

export interface MediaToolProviders {
  imageProvider: ProviderSnapshot | null;
  videoProviderId: string | null;
  textProviderId: string;
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

type GeneratedImage = { document_id: string; filename: string; media_type: string };

async function* generateImages(
  input: { prompts: string[] },
  {
    context,
    toolCallId,
    abortSignal,
  }: { context: MediaToolContext; toolCallId: string; abortSignal?: AbortSignal },
  imageProvider: ProviderSnapshot,
): AsyncGenerator<z.infer<typeof imageOutputSchema>> {
  yield { ok: true, status: "generating", count: input.prompts.length };
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
    if (images.length === 0) {
      const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      throw imageError(rejected?.reason);
    }
    yield {
      ok: true,
      status: "completed",
      images,
      count: input.prompts.length,
      failed: input.prompts.length - images.length,
      document_id: images[0]?.document_id,
    };
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    console.error("[chat-agent] generate_images failed", { toolCallId, error });
    throw imageError(error);
  }
}

function videoDocumentId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const documentId = (result as { documentId?: unknown }).documentId;
  return typeof documentId === "string" ? documentId : undefined;
}

async function* generateVideo(
  input: { prompt: string; duration?: number },
  {
    context,
    toolCallId,
    abortSignal,
  }: { context: MediaToolContext; toolCallId: string; abortSignal?: AbortSignal },
  providers: MediaToolProviders & { videoProviderId: string },
): AsyncGenerator<z.infer<typeof videoOutputSchema>> {
  const title = input.prompt.slice(0, 80);
  const filename = mediaFilename(input.prompt, "mp4");
  try {
    const task = await startTaskResilient(
      {
        type: "video-generation",
        ownerRef: toolCallId,
        payload: {
          userId: context.userId,
          conversationId: context.conversationId,
          providerId: providers.videoProviderId,
          textProviderId: providers.textProviderId,
          imageProviderId: providers.imageProvider?.id,
          prompt: input.prompt,
          targetDurationSec: input.duration,
          title,
          filename,
          idempotencyKey: toolCallId,
        },
      },
      abortSignal,
    );
    const base = { kind: "video" as const, title, filename, prompt: input.prompt, duration: input.duration, task_id: task.id };
    yield { ok: true, status: task.status, ...base };
    let terminal: Task | null = null;
    try {
      for await (const snapshot of pollTaskSnapshots(task.id, abortSignal)) {
        if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled") {
          terminal = snapshot;
          break;
        }
        yield {
          ok: true,
          status: snapshot.status,
          progress_done: snapshot.progress?.done,
          progress_total: snapshot.progress?.total,
          ...base,
        };
      }
    } catch (error) {
      if (error instanceof TaskWaitTimeoutError) throw new Error("视频生成超时：超过 30 分钟未完成，已取消任务。");
      throw error;
    }
    if (terminal?.status === "failed" || terminal?.status === "cancelled") {
      yield {
        ok: false,
        status: terminal.status,
        error: terminal.error ?? (terminal.status === "cancelled" ? "视频生成已取消" : "视频生成失败"),
        ...base,
      };
      return;
    }
    if (terminal?.status !== "completed") {
      throw new Error("视频生成失败");
    }
    yield {
      ok: true,
      status: "completed",
      document_id: videoDocumentId(terminal.result),
      media_type: "video/mp4",
      ...base,
    };
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    console.error("[chat-agent] generate_video failed", { toolCallId, error });
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
    summary: "Generate a video. The current implementation produces 5–120 second vertical short-drama reels.",
    constraints: ["Current implementation supports vertical short-drama output; the public capability remains format-neutral."],
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
        "generate_video",
        tool({
          description: "Generate and persist a video from a concrete premise. Current output is a vertical short-drama reel.",
          inputSchema: z.object({
            prompt: z.string().min(1).max(4_000),
            duration: z.number().int().min(VIDEO_TARGET_MIN_S).max(VIDEO_TARGET_MAX_S).optional(),
          }),
          outputSchema: videoOutputSchema,
          contextSchema: mediaToolContextSchema,
          execute: (input, options) =>
            generateVideo(input, options, { ...providers, videoProviderId: providers.videoProviderId! }),
        }),
        videoPolicy,
        videoPlanning,
      )
    : defineUnavailableCapability("generate_video", videoPolicy, videoPlanning);

  return [imageManifest, videoManifest];
}
