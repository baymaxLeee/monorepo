import { TransportError } from "@backend/transport-ts";
import { CanvasInternalClient } from "@backend/transport-ts/canvas";
import { FatalError, getWorkflowMetadata } from "workflow";
import { z } from "zod";

import { claimTaskStep } from "../src/application/tasks/binding.js";
import { observeTaskCancellation } from "../src/application/tasks/cancellation.js";
import { getSettings } from "../src/bootstrap/config.js";

export const canvasVideoFramesInputSchema = z.object({
  taskRunId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
});

type Input = z.infer<typeof canvasVideoFramesInputSchema>;

async function extractVideoFramesStep(input: Input) {
  "use step";
  const settings = getSettings();
  const client = new CanvasInternalClient({
    baseUrl: settings.canvasServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "executor",
    timeoutMs: 10 * 60 * 1000,
  });
  const cancellation = observeTaskCancellation(getWorkflowMetadata().workflowRunId);
  try {
    await client.extractVideoFrames(input.taskRunId, cancellation.signal);
    return { status: "succeeded" };
  } catch (error) {
    if (error instanceof TransportError && [400, 401, 403, 404, 409].includes(error.status)) {
      throw new FatalError(error.message);
    }
    throw error;
  } finally {
    cancellation.dispose();
  }
}

export async function canvasVideoFramesWorkflow(input: Input, executorTaskId: string) {
  "use workflow";
  await claimTaskStep(executorTaskId);
  return extractVideoFramesStep(input);
}
