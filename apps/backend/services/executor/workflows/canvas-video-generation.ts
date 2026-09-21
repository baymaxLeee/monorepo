import { secureProviderFetch } from "@backend/transport-ts/provider-url";
import { getWorkflowMetadata, sleep } from "workflow";
import { z } from "zod";

import { providerFor } from "../src/application/canvas/video.js";
import { claimTaskStep } from "../src/application/tasks/binding.js";
import { observeTaskCancellation } from "../src/application/tasks/cancellation.js";
import { isTaskCancelled, recordExternalTask } from "../src/application/tasks/notify.js";
import { pickArkVideoBody } from "../src/application/video/output-config.js";
import { getSettings } from "../src/bootstrap/config.js";
import { arkApiRoot, deleteArkVideoTask, getArkVideoTask } from "../src/infrastructure/clients/ark.js";

export const canvasVideoInputSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  providerId: z.string().min(1),
  prompt: z.string().min(1),
  objectScope: z.string().regex(/^[a-f0-9]{64}$/),
  references: z.array(
    z.object({
      key: z.string().regex(/^[a-f0-9]{64}$/),
      mimeType: z.string().regex(/^(image|video|audio)\/[a-zA-Z0-9.+-]+$/),
      role: z.enum(["reference_image", "reference_video", "reference_audio", "first_frame", "last_frame"]),
    }),
  ),
  duration: z
    .number()
    .int()
    .refine((value) => value === -1 || value > 0),
  resolution: z.enum(["480p", "720p", "1080p", "2k", "4k"]).optional(),
  aspectRatio: z.enum(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "3:2", "2:3", "adaptive"]).optional(),
  generateAudio: z.boolean(),
  watermark: z.boolean(),
});
export type CanvasVideoInput = z.infer<typeof canvasVideoInputSchema>;
type Input = CanvasVideoInput;

async function createStep(input: Input) {
  "use step";
  const provider = await providerFor(input);
  const settings = getSettings();
  const runId = getWorkflowMetadata().workflowRunId;
  const cancellation = observeTaskCancellation(runId);
  const headers = { "X-Internal-Token": settings.internalApiToken, "X-Caller-Service": "executor" };
  try {
    const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
    for (const reference of input.references) {
      const response = await fetch(
        `${settings.knowledgeServiceUrl}/internal/objects/${input.objectScope}/${reference.key}`,
        { headers, signal: cancellation.signal },
      );
      if (!response.ok) throw new Error(`Canvas reference unavailable (${response.status})`);
      const type = `${reference.mimeType.split("/")[0]}_url`;
      const url = `data:${reference.mimeType};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
      content.push({ type, [type]: { url }, role: reference.role });
    }
    cancellation.signal.throwIfAborted();
    const response = await secureProviderFetch(`${arkApiRoot(provider.baseUrl)}/contents/generations/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...pickArkVideoBody(provider.extraBody),
        model: provider.model,
        content,
        duration: input.duration,
        resolution: input.resolution,
        ratio: input.aspectRatio,
        generate_audio: input.generateAudio,
        watermark: input.watermark,
      }),
      signal: cancellation.signal,
    });
    if (!response.ok) throw new Error(`Canvas video submission failed (${response.status})`);
    const { id } = z.object({ id: z.string().min(1) }).parse(await response.json());
    await recordExternalTask(runId, id);
    if (await isTaskCancelled(runId)) {
      await deleteArkVideoTask({ ...provider, taskId: id, signal: AbortSignal.timeout(30_000) });
      throw new Error("Canvas video cancelled");
    }
    return id;
  } finally {
    cancellation.dispose();
  }
}
// Paid creation cannot be retried without a provider idempotency key.
createStep.maxRetries = 0;

async function pollStep(input: Input, taskId: string) {
  "use step";
  const provider = await providerFor(input, true);
  return getArkVideoTask({ ...provider, taskId, signal: AbortSignal.timeout(30_000) });
}

async function storeStep(input: Input, videoUrl: string) {
  "use step";
  const settings = getSettings();
  const cancellation = observeTaskCancellation(getWorkflowMetadata().workflowRunId);
  try {
    const response = await secureProviderFetch(videoUrl, { signal: cancellation.signal });
    if (!response.ok || !response.body) throw new Error(`Canvas video download failed (${response.status})`);
    const options = {
      method: "POST",
      duplex: "half",
      headers: { "X-Internal-Token": settings.internalApiToken, "X-Caller-Service": "executor" },
      body: response.body,
      signal: cancellation.signal,
    };
    const stored = await fetch(`${settings.knowledgeServiceUrl}/internal/objects/${input.objectScope}`, options);
    if (!stored.ok) throw new Error(`Canvas video storage failed (${stored.status})`);
    const { key } = z.object({ key: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await stored.json());
    return { objectKey: key, mimeType: "video/mp4" };
  } finally {
    cancellation.dispose();
  }
}

export async function canvasVideoWorkflow(input: Input, executorTaskId: string) {
  "use workflow";
  await claimTaskStep(executorTaskId);
  const taskId = await createStep(input);
  while (true) {
    const snapshot = await pollStep(input, taskId);
    if (snapshot.status === "succeeded") {
      if (!snapshot.videoUrl) throw new Error("Video provider returned no output");
      return storeStep(input, snapshot.videoUrl);
    }
    if (!["queued", "running"].includes(snapshot.status)) throw new Error(`Canvas video ${snapshot.status}`);
    await sleep("5s");
  }
}
