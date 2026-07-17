import type { HtmlArtifactInput } from "../../../workflows/html-artifact.js";
import { cancelArtifactGeneration } from "../../infrastructure/clients/knowledge.js";
import type { TaskProgress } from "../tasks/types.js";

export async function cancelHtmlArtifact(
  input: HtmlArtifactInput,
  progress: TaskProgress | null,
): Promise<void> {
  const generationId = progress?.artifactGenerationId;
  if (!generationId) return;
  await cancelArtifactGeneration({ userId: input.userId, generationId });
}
