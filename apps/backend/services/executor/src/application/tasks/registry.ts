import { canvasArchiveInputSchema } from "../../../workflows/canvas-archive.js";
import { canvasVideoFramesInputSchema } from "../../../workflows/canvas-video-frames.js";
import { fileTaskBatchInputSchema } from "../../../workflows/file-task-batch.js";
import { videoGenerationInputSchema } from "../../../workflows/video-generation.js";
import { cancelVideoGeneration } from "../video/cancel.js";
import type { TaskTypeDefinition } from "./types.js";

const registry = new Map<string, TaskTypeDefinition>();

export function registerTaskType<TInput, TOutput>(definition: TaskTypeDefinition<TInput, TOutput>): void {
  if (registry.has(definition.name)) {
    throw new Error(`task type "${definition.name}" is already registered`);
  }
  registry.set(definition.name, definition as TaskTypeDefinition);
}

export function getTaskType(name: string): TaskTypeDefinition | undefined {
  return registry.get(name);
}

registerTaskType({
  name: "file-task-batch",
  inputSchema: fileTaskBatchInputSchema,
  workflow: { workflowId: "workflow//./workflows/file-task-batch//fileTaskBatchWorkflow" },
});

registerTaskType({
  name: "video-generation",
  inputSchema: videoGenerationInputSchema,
  workflow: { workflowId: "workflow//./workflows/video-generation//videoGenerationWorkflow" },
  cancel: cancelVideoGeneration,
});

registerTaskType({
  name: "canvas-archive",
  inputSchema: canvasArchiveInputSchema,
  workflow: { workflowId: "workflow//./workflows/canvas-archive//canvasArchiveWorkflow" },
});

registerTaskType({
  name: "canvas-video-frames",
  inputSchema: canvasVideoFramesInputSchema,
  workflow: { workflowId: "workflow//./workflows/canvas-video-frames//canvasVideoFramesWorkflow" },
});
