import type { ImageGenerationInput } from "../../../workflows/image-generation.js";
import { deleteDocument } from "../../infrastructure/clients/knowledge.js";
import type { TaskProgress } from "../tasks/types.js";

export async function cancelImageGeneration(
  input: ImageGenerationInput,
  progress: TaskProgress | null,
  _context: { taskId: string },
  removeDocument: typeof deleteDocument = deleteDocument,
): Promise<void> {
  await Promise.all((progress?.externalTaskIds ?? []).map((documentId) => removeDocument(input.userId, documentId)));
}
