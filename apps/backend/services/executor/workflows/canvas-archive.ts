import { TransportError } from "@backend/transport-ts";
import { CanvasInternalClient } from "@backend/transport-ts/canvas";
import { getWorkflowMetadata, FatalError } from "workflow";
import { z } from "zod";

import { observeTaskCancellation } from "../src/application/tasks/cancellation.js";
import { getSettings } from "../src/bootstrap/config.js";

export const canvasArchiveInputSchema = z.object({ taskRunId: z.string().regex(/^[a-f0-9]{32}$/) });
type Input = z.infer<typeof canvasArchiveInputSchema>;

async function archiveStep(input: Input) {
  "use step";
  const settings = getSettings();
  const client = new CanvasInternalClient({
    baseUrl: settings.canvasServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "executor",
  });
  const cancellation = observeTaskCancellation(getWorkflowMetadata().workflowRunId);
  try {
    return await client.executeArchive(input.taskRunId, cancellation.signal);
  } catch (error) {
    if (error instanceof TransportError && [400, 401, 403, 404, 409].includes(error.status)) {
      throw new FatalError(error.message);
    }
    throw error;
  } finally {
    cancellation.dispose();
  }
}

export async function canvasArchiveWorkflow(input: Input) {
  "use workflow";
  return archiveStep(input);
}
