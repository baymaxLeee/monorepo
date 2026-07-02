import { echoInputSchema, echoWorkflow } from "../../workflows/echo.js";
import { htmlArtifactInputSchema, htmlArtifactWorkflow } from "../../workflows/html-artifact.js";
import { videoGenerationInputSchema, videoGenerationWorkflow } from "../../workflows/video-generation.js";
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

// "echo" is a smoke-test task type only, proving the Task API contract
// (queue -> workflow run -> durable result) end to end. Real task types
// (starting with html-artifact in Phase 2) register the same way.
registerTaskType({
  name: "echo",
  inputSchema: echoInputSchema,
  workflow: echoWorkflow,
});

registerTaskType({
  name: "html-artifact",
  inputSchema: htmlArtifactInputSchema,
  workflow: htmlArtifactWorkflow,
});

registerTaskType({
  name: "video-generation",
  inputSchema: videoGenerationInputSchema,
  workflow: videoGenerationWorkflow,
});
