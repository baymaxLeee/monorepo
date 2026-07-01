import type { UIMessageChunk } from "ai";

import {
  appendTaskSseFrame,
  closeTaskSseStream,
  encodeSseData,
} from "./service.js";

// One place that knows the on-the-wire shape of a background task's progress.
// Both the /internal/tasks/notify writer and the GET task stream seeder build
// frames through here so the browser only ever sees one native UIMessage data
// part type ("data-artifact-progress"), reconciled by a stable id.
export const ARTIFACT_PROGRESS_DATA_TYPE = "artifact-progress";

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ArtifactProgressData {
  taskId: string;
  status: TaskStatus;
  progress: { done: number; total: number } | null;
  documentId: string | null;
  totalChars: number | null;
  blocksTotal: number | null;
  blocksDone: number | null;
  blocksFailed: number | null;
  error: string | null;
}

export interface TaskEventInput {
  taskId: string;
  status: TaskStatus;
  progress?: { done: number; total: number } | null;
  result?: unknown;
  error?: string | null;
}

function isTerminal(status: TaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function resultFields(result: unknown) {
  if (!result || typeof result !== "object") {
    return { documentId: null, totalChars: null, blocksTotal: null, blocksDone: null, blocksFailed: null };
  }
  const r = result as Record<string, unknown>;
  return {
    documentId: typeof r.documentId === "string" ? r.documentId : null,
    totalChars: typeof r.totalChars === "number" ? r.totalChars : null,
    blocksTotal: typeof r.blocksTotal === "number" ? r.blocksTotal : null,
    blocksDone: typeof r.blocksDone === "number" ? r.blocksDone : null,
    blocksFailed: typeof r.blocksFailed === "number" ? r.blocksFailed : null,
  };
}

function toProgressData(input: TaskEventInput): ArtifactProgressData {
  return {
    taskId: input.taskId,
    status: input.status,
    progress: input.progress ?? null,
    error: input.error ?? null,
    ...resultFields(input.result),
  };
}

function progressChunk(data: ArtifactProgressData): UIMessageChunk {
  // A single stable id means every update replaces the prior card state instead
  // of appending a new part (AI SDK data-part id reconciliation).
  return {
    type: `data-${ARTIFACT_PROGRESS_DATA_TYPE}`,
    id: `progress-${data.taskId}`,
    data,
  } as UIMessageChunk;
}

// Called by the notify route on every executor push. Appends one data frame and,
// on a terminal event, the [DONE] sentinel that ends every replay.
export async function publishArtifactTaskEvent(input: TaskEventInput): Promise<void> {
  const data = toProgressData(input);
  await appendTaskSseFrame(input.taskId, encodeSseData(progressChunk(data)));
  if (isTerminal(input.status)) {
    await closeTaskSseStream(input.taskId);
  }
}

// Called by the GET task stream on connect: a `start` frame plus the current
// snapshot so a late (or post-completion) subscriber renders immediately,
// without polling. `terminal` tells the route whether to close right away.
export function taskSeedFrames(input: TaskEventInput): { frames: string[]; terminal: boolean } {
  const data = toProgressData(input);
  const start: UIMessageChunk = { type: "start", messageId: `task-${input.taskId}` };
  return {
    frames: [encodeSseData(start), encodeSseData(progressChunk(data))],
    terminal: isTerminal(input.status),
  };
}
