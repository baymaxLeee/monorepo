import { imageGenerationInputSchema } from "../../../workflows/image-generation.js";
import { videoGenerationInputSchema } from "../../../workflows/video-generation.js";
import { cancelImageGeneration } from "../image/cancel.js";
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
  name: "image-generation",
  inputSchema: imageGenerationInputSchema,
  workflow: { workflowId: "workflow//./workflows/image-generation//imageGenerationWorkflow" },
  cancel: cancelImageGeneration,
});

registerTaskType({
  name: "video-generation",
  inputSchema: videoGenerationInputSchema,
  workflow: { workflowId: "workflow//./workflows/video-generation//videoGenerationWorkflow" },
  cancel: cancelVideoGeneration,
});
