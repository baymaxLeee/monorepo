import type { UIMessageChunk } from "ai";

import {
  appendTaskSseFrame,
  closeTaskSseStream,
  encodeSseData,
} from "./service.js";

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
  return {
    type: `data-${ARTIFACT_PROGRESS_DATA_TYPE}`,
    id: `progress-${data.taskId}`,
    data,
  } as UIMessageChunk;
}

export async function publishArtifactTaskEvent(input: TaskEventInput): Promise<void> {
  const data = toProgressData(input);
  await appendTaskSseFrame(input.taskId, encodeSseData(progressChunk(data)));
  if (isTerminal(input.status)) {
    await closeTaskSseStream(input.taskId);
  }
}

export function taskSeedFrames(input: TaskEventInput): { frames: string[]; terminal: boolean } {
  const data = toProgressData(input);
  const start: UIMessageChunk = { type: "start", messageId: `task-${input.taskId}` };
  return {
    frames: [encodeSseData(start), encodeSseData(progressChunk(data))],
    terminal: isTerminal(input.status),
  };
}
