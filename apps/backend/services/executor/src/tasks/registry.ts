import { echoInputSchema, echoWorkflow } from "../../workflows/echo.js";
import { htmlArtifactInputSchema, htmlArtifactWorkflow } from "../../workflows/html-artifact.js";
import { videoGenerationInputSchema, videoGenerationWorkflow } from "../../workflows/video-generation.js";
import { cancelHtmlArtifact } from "../artifacts/cancel.js";
import { cancelVideoGeneration } from "../video/cancel.js";
import type { TaskTypeDefinition } from "./types.js";

const registry = new Map<string, TaskTypeDefinition>();

export function registerTaskType<TInput, TOutput>(
  definition: TaskTypeDefinition<TInput, TOutput>,
): void {
  if (registry.has(definition.name)) {
    throw new Error(`task type "${definition.name}" is already registered`);
  }
  registry.set(definition.name, definition as TaskTypeDefinition);
}

export function getTaskType(name: string): TaskTypeDefinition | undefined {
  return registry.get(name);
}

export function listTaskTypes(): string[] {
  return [...registry.keys()];
}

registerTaskType({
  name: "echo",
  inputSchema: echoInputSchema,
  workflow: echoWorkflow,
});

registerTaskType({
  name: "html-artifact",
  inputSchema: htmlArtifactInputSchema,
  workflow: htmlArtifactWorkflow,
  cancel: cancelHtmlArtifact,
});

registerTaskType({
  name: "video-generation",
  inputSchema: videoGenerationInputSchema,
  workflow: videoGenerationWorkflow,
  cancel: cancelVideoGeneration,
});
