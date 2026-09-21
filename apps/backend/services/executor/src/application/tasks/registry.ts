import { canvasArchiveInputSchema, canvasArchiveWorkflow } from "../../../workflows/canvas-archive.js";
import { canvasImageInputSchema, canvasImageWorkflow } from "../../../workflows/canvas-image-generation.js";
import { canvasStoryboardInputSchema, canvasStoryboardWorkflow } from "../../../workflows/canvas-storyboard.js";
import { canvasFramesInputSchema, canvasFramesWorkflow } from "../../../workflows/canvas-video-frames.js";
import { canvasVideoInputSchema, canvasVideoWorkflow } from "../../../workflows/canvas-video-generation.js";
import { fileTaskBatchInputSchema, fileTaskBatchWorkflow } from "../../../workflows/file-task-batch.js";
import { textGenerationInputSchema, textGenerationWorkflow } from "../../../workflows/text-generation.js";
import { videoGenerationInputSchema, videoGenerationWorkflow } from "../../../workflows/video-generation.js";
import { cancelCanvasVideo } from "../canvas/video.js";
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
  workflow: fileTaskBatchWorkflow,
});

registerTaskType({
  name: "video-generation",
  inputSchema: videoGenerationInputSchema,
  workflow: videoGenerationWorkflow,
  cancel: cancelVideoGeneration,
});

registerTaskType({ name: "text-generation", inputSchema: textGenerationInputSchema, workflow: textGenerationWorkflow });

registerTaskType({
  name: "canvas-image-generation",
  inputSchema: canvasImageInputSchema,
  workflow: canvasImageWorkflow,
});

registerTaskType({
  name: "canvas-video-generation",
  inputSchema: canvasVideoInputSchema,
  workflow: canvasVideoWorkflow,
  cancel: cancelCanvasVideo,
});

registerTaskType({ name: "canvas-archive", inputSchema: canvasArchiveInputSchema, workflow: canvasArchiveWorkflow });

registerTaskType({
  name: "canvas-storyboard",
  inputSchema: canvasStoryboardInputSchema,
  workflow: canvasStoryboardWorkflow,
});

registerTaskType({ name: "canvas-video-frames", inputSchema: canvasFramesInputSchema, workflow: canvasFramesWorkflow });
