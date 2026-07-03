import { generateImage, NoImageGeneratedError, tool } from "ai";
import type { JSONValue } from "ai";
import { z } from "zod";

import { createProviderImageModel } from "@backend/transport-ts/provider-model";
import type { ProviderSnapshot } from "../../../clients/admin.js";
import { createMediaDocument } from "../../../clients/knowledge.js";
import { mediaToolContextSchema, type MediaToolContext } from "../context.js";

// Fields the tool or the OpenAI-compatible image model owns. Everything else in
// the admin-configured `extra_body` (size, watermark, seed, guidance, ...) is
// forwarded to Ark verbatim as request-body options. `response_format` is
// dropped because the model always forces `b64_json` so we get raw bytes.
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
  if (value == null) return true;
  const type = typeof value;
  if (type === "string" || type === "boolean") return true;
  if (type === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (type !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function buildImageProviderOptions(extraBody: Record<string, unknown>): Record<string, JSONValue> {
  const options: Record<string, JSONValue> = {};
  for (const [key, value] of Object.entries(extraBody)) {
    if (IMAGE_OWNED_KEYS.has(key)) continue;
    if (isJsonValue(value)) options[key] = value;
  }
  return options;
}

// Prefer the SDK-provided media type; fall back to sniffing common image magic
// bytes so a document always carries a correct, previewable MIME.
function resolveImageMediaType(mediaType: string | undefined, bytes: Uint8Array): string {
  if (mediaType && mediaType.startsWith("image/")) return mediaType;
  if (bytes.length >= 4) {
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
  }
  return "image/png";
}

function imageFilename(prompt: string, mediaType: string, index: number): string {
  const ext = IMAGE_EXTENSIONS[mediaType] ?? "png";
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "image";
  return index > 0 ? `${slug}-${index + 1}.${ext}` : `${slug}.${ext}`;
}

function describeImageError(error: unknown): string {
  if (NoImageGeneratedError.isInstance(error)) {
    const cause = error.cause;
    const detail = cause instanceof Error ? cause.message : String(cause ?? "");
    return `图片生成失败：模型未返回图片${detail ? `（${detail.slice(0, 200)}）` : ""}`;
  }
  if (error instanceof Error) return `图片生成失败：${error.message.slice(0, 300)}`;
  return `图片生成失败：${String(error).slice(0, 300)}`;
}

export function createMediaTools(imageProvider: ProviderSnapshot) {
  return {
    generate_image: tool({
      description:
        "Generate one or more images in a SINGLE call from the user's configured image model (e.g. Volcengine Ark Seedream) and render them inline as one grouped gallery card. Use this whenever the user asks to create, draw, paint, or generate pictures, illustrations, posters, icons, logos, or similar visuals. To produce SEVERAL images (a set, options/variations, or different subjects), put ALL of their prompts in the `prompts` array of ONE call — do NOT call this tool multiple times for a multi-image request; batched prompts generate concurrently and preview together. Write each prompt in concrete visual detail (subject, style, composition, colors, lighting, mood). Generated images are persisted automatically; do not describe file IDs or download steps. Requires the user to have configured and selected an image provider — if none is available the tool returns an error you must relay, asking them to configure one in model management. Do not use this to edit an already-uploaded image.",
      inputSchema: z.object({
        prompts: z
          .array(z.string().min(1).max(4000))
          .min(1)
          .max(6)
          .describe(
            "One rich, concrete visual prompt per image (subject, style, composition, colors, lighting, mood). Pass every image this request needs in this one array — multiple prompts generate concurrently and render as a single gallery card. For N variations of one idea, repeat or vary the prompt N times.",
          ),
        todo_id: z
          .string()
          .max(64)
          .optional()
          .describe(
            "Optional id of the todo item this image group fulfills. Set it when executing a plan/todo list so the UI flips that todo to done the moment this batch finishes; omit for ad-hoc calls.",
          ),
      }),
      contextSchema: mediaToolContextSchema,
      execute: (input, options) => generateImageTool(input, options, imageProvider),
    }),
  };
}

type GeneratedImage = { document_id: string; filename: string; media_type: string };

type GenerateImageInput = { prompts: string[]; todo_id?: string };

export async function* generateImageTool(
  input: GenerateImageInput,
  {
    context,
    toolCallId,
    abortSignal,
  }: { context: MediaToolContext; toolCallId: string; abortSignal?: AbortSignal },
  imageProvider: ProviderSnapshot,
): AsyncGenerator<Record<string, unknown>> {
  const prompts = input.prompts;
  const todoId = input.todo_id;
  yield { ok: true, status: "generating", count: prompts.length, todo_id: todoId };

  try {
    const { model, providerOptionsKey } = createProviderImageModel({
      id: imageProvider.id,
      model: imageProvider.model,
      baseUrl: imageProvider.baseUrl,
      apiKey: imageProvider.apiKey,
    });
    const providerOptions = buildImageProviderOptions(imageProvider.extraBody);

    // One image per prompt, all generated concurrently. Each prompt is an
    // independent request/document (unique idempotency key by index), so a
    // single failed prompt degrades to a partial gallery instead of failing
    // the whole batch.
    const generateOne = async (prompt: string, index: number): Promise<GeneratedImage> => {
      const result = await generateImage({
        model,
        prompt,
        n: 1,
        abortSignal,
        providerOptions: { [providerOptionsKey]: providerOptions },
      });
      const file = result.images[0] ?? result.image;
      const mediaType = resolveImageMediaType(file.mediaType, file.uint8Array);
      const filename = imageFilename(prompt, mediaType, index);
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

    const settled = await Promise.allSettled(prompts.map(generateOne));

    // A cancelled run surfaces as AbortError on the individual calls; re-throw
    // so the run records cancellation instead of a partial "completed".
    if (abortSignal?.aborted) {
      const aborted = settled.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === "rejected" &&
          outcome.reason instanceof Error &&
          outcome.reason.name === "AbortError",
      );
      throw aborted?.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" });
    }

    const images: GeneratedImage[] = [];
    const errors: unknown[] = [];
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") images.push(outcome.value);
      else errors.push(outcome.reason);
    }

    if (images.length === 0) {
      yield { ok: false, status: "failed", error: describeImageError(errors[0]), todo_id: todoId };
      return;
    }

    yield {
      ok: true,
      status: "completed",
      images,
      count: prompts.length,
      failed: prompts.length - images.length,
      document_id: images[0]?.document_id,
      todo_id: todoId,
    };
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    console.error("[chat-agent] generate_image failed", { toolCallId, error });
    yield { ok: false, status: "failed", error: describeImageError(error), todo_id: todoId };
  }
}
