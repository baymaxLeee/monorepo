import { generateImage, NoImageGeneratedError, type JSONValue } from "ai";
import { getWorkflowMetadata } from "workflow";
import { z } from "zod";

import { mediaProviderCapabilitySchema } from "../src/infrastructure/provider/capability.js";

export const imageGenerationInputSchema = z.object({
  sessionId: z.string().optional(),
  provider: mediaProviderCapabilitySchema.refine((provider) => provider.providerKind === "image", {
    message: "image provider capability is required",
  }),
  prompts: z.array(z.string().min(1).max(4_000)).min(1).max(6),
  size: z
    .string()
    .regex(/^\d+x\d+$/)
    .default("2048x2048"),
  references: z
    .array(
      z.object({
        assetId: z.string().uuid(),
        revisionId: z.string().uuid(),
        mediaType: z.string().regex(/^image\//),
      }),
    )
    .max(5)
    .default([]),
  idempotencyKey: z.string().min(1).max(120),
});

export type ImageGenerationInput = z.infer<typeof imageGenerationInputSchema>;

type GeneratedImage = {
  assetId: string;
  revisionId: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
};
type FailedImage = { index: number; message: string };

const IMAGE_OWNED_KEYS = new Set(["response_format", "prompt", "model", "n", "test_prompt"]);
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

function isJsonValue(value: unknown): value is JSONValue {
  if (value == null || ["string", "boolean"].includes(typeof value)) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === "object" && Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function providerOptions(extraBody: Record<string, unknown>): Record<string, JSONValue> {
  return Object.fromEntries(
    Object.entries(extraBody).filter(([key, value]) => !IMAGE_OWNED_KEYS.has(key) && isJsonValue(value)),
  ) as Record<string, JSONValue>;
}

function mediaType(value: string | undefined, bytes: Uint8Array): string {
  if (value?.startsWith("image/")) return value;
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

function filename(prompt: string, extension: string, index: number): string {
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "image";
  return index > 0 ? `${slug}-${index + 1}.${extension}` : `${slug}.${extension}`;
}

function errorMessage(error: unknown): string {
  if (NoImageGeneratedError.isInstance(error)) {
    const detail = error.cause instanceof Error ? error.cause.message : String(error.cause ?? "");
    return `image provider returned no image${detail ? `: ${detail.slice(0, 200)}` : ""}`;
  }
  return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

async function generateOneImageStep(
  input: ImageGenerationInput & { taskId: string; prompt: string; index: number },
): Promise<{ ok: true; image: GeneratedImage } | { ok: false; failure: FailedImage }> {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const [cancellationModule, taskModule, storageModule] = await Promise.all([
    import("../src/application/tasks/cancellation.js"),
    import("../src/application/tasks/notify.js"),
    import("../src/infrastructure/clients/storage-media.js"),
  ]);
  const { observeTaskCancellation } = cancellationModule;
  const { recordExternalTask } = taskModule;
  const { claimTaskAsset, readAsset, uploadAsset } = storageModule;
  const cancellation = observeTaskCancellation(workflowRunId);
  try {
    const [{ validateMediaProviderCapability }, { createProviderImageModel }] = await Promise.all([
      import("../src/infrastructure/provider/capability-validation.js"),
      import("../src/infrastructure/provider/provider-model.js"),
    ]);
    const provider = await validateMediaProviderCapability(input.provider, "image");
    const configured = createProviderImageModel(provider);
    const referenceImages = await Promise.all(
      input.references.map((reference) =>
        readAsset({ assetId: reference.assetId, revisionId: reference.revisionId, signal: cancellation.signal }),
      ),
    );
    const generated = await generateImage({
      model: configured.model,
      prompt: referenceImages.length > 0 ? { text: input.prompt, images: referenceImages } : input.prompt,
      n: 1,
      abortSignal: cancellation.signal,
      providerOptions: {
        [configured.providerOptionsKey]: { ...providerOptions(provider.extraBody), size: input.size },
      },
    });
    const file = generated.images[0] ?? generated.image;
    const contentType = mediaType(file.mediaType, file.uint8Array);
    const outputFilename = filename(input.prompt, IMAGE_EXTENSIONS[contentType] ?? "png", input.index);
    const asset = await uploadAsset({
      filename: outputFilename,
      mediaType: contentType,
      category: "generated-image",
      body: file.uint8Array,
      contentLength: file.uint8Array.byteLength,
      idempotencyKey: `${input.idempotencyKey}-${input.index}`,
      signal: cancellation.signal,
    });
    const slot = `image:${input.index}`;
    await claimTaskAsset({
      taskId: input.taskId,
      slot,
      assetId: asset.assetId,
      revisionId: asset.revisionId,
    });
    await recordExternalTask(workflowRunId, slot);
    return {
      ok: true,
      image: {
        assetId: asset.assetId,
        revisionId: asset.revisionId,
        filename: asset.filename,
        mediaType: contentType,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
      },
    };
  } catch (error) {
    if (cancellation.signal.aborted) throw error;
    return { ok: false, failure: { index: input.index, message: errorMessage(error) } };
  } finally {
    cancellation.dispose();
  }
}

// A lost provider response may already represent a paid image. Never replay this
// step automatically because the provider API has no idempotency contract.
generateOneImageStep.maxRetries = 0;

async function reportProgressStep(done: number, total: number): Promise<void> {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const { reportTaskProgress } = await import("../src/application/tasks/notify.js");
  await reportTaskProgress(workflowRunId, { done, total });
}

async function claimTask(taskId: string): Promise<void> {
  "use step";
  const { claimTaskStep } = await import("../src/application/tasks/binding.js");
  await claimTaskStep(taskId);
}

export async function imageGenerationWorkflow(input: ImageGenerationInput, taskId: string) {
  "use workflow";
  await claimTask(taskId);
  const images: GeneratedImage[] = [];
  const failedItems: FailedImage[] = [];
  await reportProgressStep(0, input.prompts.length);
  for (const [index, prompt] of input.prompts.entries()) {
    const result = await generateOneImageStep({ ...input, taskId, prompt, index });
    if (result.ok) images.push(result.image);
    else failedItems.push(result.failure);
    await reportProgressStep(index + 1, input.prompts.length);
  }
  if (images.length === 0) {
    throw new Error(failedItems[0]?.message ?? "image generation failed");
  }
  return {
    images,
    count: input.prompts.length,
    failed: failedItems.length,
    ...(failedItems.length ? { failedItems } : {}),
  };
}
