import { fileTaskBatchInputSchema, fileTaskBatchWorkflow } from "../../../workflows/file-task-batch.js";
import { videoGenerationInputSchema, videoGenerationWorkflow } from "../../../workflows/video-generation.js";
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
