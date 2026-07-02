import { z } from "zod";

import { getProvider } from "../src/clients/admin.js";
import { createMediaDocument } from "../src/clients/knowledge.js";
import {
  createArkVideoTask,
  downloadArkVideo,
  getArkVideoTask,
  type ArkVideoSnapshot,
} from "../src/clients/ark.js";

export const videoGenerationInputSchema = z.object({
  userId: z.string().min(1),
  conversationId: z.string().optional(),
  providerId: z.string().min(1),
  prompt: z.string().min(1).max(4000),
  title: z.string().min(1).max(120),
  filename: z.string().min(1).max(160),
  idempotencyKey: z.string().min(1).max(120).optional(),
});
export type VideoGenerationInput = z.infer<typeof videoGenerationInputSchema>;

// Video generation is minutes-scale; poll on a coarse interval and give up well
// under the chat tool's foreground-block ceiling (30 min) so a stuck provider
// surfaces as a failed task instead of hanging the turn.
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 15 * 60_000;
const POLL_REQUEST_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Create the Ark video task and return its id. Fetching the provider inside the
// step (rather than passing credentials through workflow-serialized args) keeps
// the api key out of the durable execution store and picks up key rotation.
async function createTaskStep(input: VideoGenerationInput): Promise<string> {
  "use step";
  const provider = await getProvider(input.userId, input.providerId);
  return createArkVideoTask({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
    prompt: input.prompt,
    extraBody: provider.extraBody,
    signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS),
  });
}

// Poll the Ark task to a terminal state. Runs as one durable step: on a mid-poll
// process loss the step simply re-runs and re-polls the same (already-created)
// task id, so no duplicate generation is billed.
async function waitForTaskStep(
  input: VideoGenerationInput,
  taskId: string,
): Promise<ArkVideoSnapshot> {
  "use step";
  const provider = await getProvider(input.userId, input.providerId);
  const deadline = Date.now() + MAX_WAIT_MS;
  while (true) {
    const snapshot = await getArkVideoTask({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      taskId,
      signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS),
    });
    if (snapshot.status === "succeeded") return snapshot;
    if (snapshot.status === "failed" || snapshot.status === "cancelled") return snapshot;
    if (Date.now() >= deadline) {
      return { status: "failed", error: "video generation timed out" };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// Download the finished video and persist it to Knowledge in a single step, so
// the (multi-MB) bytes never cross a workflow-step serialization boundary.
async function persistStep(
  input: VideoGenerationInput,
  videoUrl: string,
): Promise<{ documentId: string; mediaType: string; sizeBytes: number }> {
  "use step";
  const { bytes, mediaType } = await downloadArkVideo({
    videoUrl,
    signal: AbortSignal.timeout(5 * 60_000),
  });
  const document = await createMediaDocument({
    userId: input.userId,
    conversationId: input.conversationId,
    title: input.title,
    filename: input.filename,
    mimeType: mediaType,
    bytes,
    idempotencyKey: input.idempotencyKey,
  });
  return { documentId: document.id, mediaType, sizeBytes: bytes.length };
}

export async function videoGenerationWorkflow(input: VideoGenerationInput) {
  "use workflow";
  const taskId = await createTaskStep(input);
  const terminal = await waitForTaskStep(input, taskId);
  if (terminal.status !== "succeeded" || !terminal.videoUrl) {
    throw new Error(terminal.error ?? `video generation ${terminal.status}`);
  }
  const persisted = await persistStep(input, terminal.videoUrl);
  return {
    ok: true as const,
    documentId: persisted.documentId,
    title: input.title,
    filename: input.filename,
    mediaType: persisted.mediaType,
    sizeBytes: persisted.sizeBytes,
  };
}
