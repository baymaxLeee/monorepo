import { AdminInternalClient } from "@backend/transport-ts";
import { createProviderImageModel } from "@backend/transport-ts/provider-model";
import { generateImage, type JSONValue } from "ai";
import { getWorkflowMetadata } from "workflow";
import { z } from "zod";

import { claimTaskStep } from "../src/application/tasks/binding.js";
import { observeTaskCancellation } from "../src/application/tasks/cancellation.js";
import { getSettings } from "../src/bootstrap/config.js";

export const canvasImageInputSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  providerId: z.string().min(1),
  prompt: z.string().min(1),
  watermark: z.boolean().optional(),
  artifactNamespace: z.string().regex(/^[a-f0-9]{64}$/),
  artifactIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  aspectRatio: z
    .string()
    .regex(/^\d+:\d+$/)
    .optional(),
  size: z
    .string()
    .regex(/^\d+x\d+$/)
    .optional(),
});
type Input = z.infer<typeof canvasImageInputSchema>;

async function generateStep(input: Input) {
  "use step";
  const settings = getSettings();
  const client = new AdminInternalClient({
    baseUrl: settings.adminServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "executor",
  });
  const provider = await client.getProvider(input.providerId, input.tenantId, input.workspaceId);
  if (provider.provider_kind !== "image" || !provider.is_enabled)
    throw new Error("An enabled image provider is required");
  const { model, providerOptionsKey } = createProviderImageModel({
    id: provider.id,
    model: provider.model,
    baseUrl: provider.base_url,
    apiKey: provider.api_key,
  });
  const cancellation = observeTaskCancellation(getWorkflowMetadata().workflowRunId);
  const headers = { "X-Internal-Token": settings.internalApiToken, "X-Caller-Service": "executor" };
  const objectUrl = `${settings.knowledgeServiceUrl.replace(/\/$/, "")}/internal/objects/${input.artifactNamespace}`;
  try {
    const images: Uint8Array[] = [];
    for (const artifactId of input.artifactIds) {
      const response = await fetch(`${objectUrl}/${artifactId}`, { headers, signal: cancellation.signal });
      if (!response.ok) throw new Error(`Canvas reference unavailable (${response.status})`);
      images.push(new Uint8Array(await response.arrayBuffer()));
    }
    const owned = new Set([
      "model",
      "prompt",
      "image",
      "images",
      "n",
      "size",
      "aspect_ratio",
      "response_format",
      "stream",
    ]);
    const options = Object.fromEntries(
      Object.entries(provider.extra_body ?? {}).filter(([key]) => !owned.has(key)),
    ) as Record<string, JSONValue>;
    if (input.watermark !== undefined) options.watermark = input.watermark;
    const result = await generateImage({
      model,
      prompt: images.length ? { text: input.prompt, images } : input.prompt,
      n: 1,
      size: input.size as `${number}x${number}` | undefined,
      aspectRatio: input.aspectRatio as `${number}:${number}` | undefined,
      providerOptions: { [providerOptionsKey]: options },
      maxRetries: 0,
      abortSignal: cancellation.signal,
    });
    cancellation.signal.throwIfAborted();
    const file = result.image;
    const response = await fetch(objectUrl, {
      method: "POST",
      headers,
      body: new Blob([new Uint8Array(file.uint8Array)]),
      signal: cancellation.signal,
    });
    if (!response.ok) throw new Error(`Canvas output storage failed (${response.status})`);
    const stored = z.object({ artifact_id: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await response.json());
    return { artifactId: stored.artifact_id, mimeType: file.mediaType || "image/png" };
  } finally {
    cancellation.dispose();
  }
}
// The provider call is paid and has no replay-safe idempotency key.
generateStep.maxRetries = 0;

export async function canvasImageWorkflow(input: Input, executorTaskId: string) {
  "use workflow";
  await claimTaskStep(executorTaskId);
  return generateStep(input);
}
