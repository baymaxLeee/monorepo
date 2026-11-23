import type { ImageGenerationInput } from "../../../workflows/image-generation.js";
import { releaseTaskAsset } from "../../infrastructure/clients/storage-media.js";
import type { TaskProgress } from "../tasks/types.js";

export async function cancelImageGeneration(
  _input: ImageGenerationInput,
  progress: TaskProgress | null,
  context: { taskId: string },
  releaseAsset: typeof releaseTaskAsset = releaseTaskAsset,
): Promise<void> {
  await Promise.all((progress?.externalTaskIds ?? []).map((slot) => releaseAsset(context.taskId, slot)));
}
