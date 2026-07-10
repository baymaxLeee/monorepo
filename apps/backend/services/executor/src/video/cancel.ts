import type { VideoGenerationInput } from "../../workflows/video-generation.js";
import { getProvider } from "../clients/admin.js";
import { deleteArkVideoTask } from "../clients/ark.js";
import type { TaskProgress } from "../tasks/types.js";

export async function cancelVideoGeneration(
  input: VideoGenerationInput,
  progress: TaskProgress | null,
): Promise<void> {
  const taskIds = progress?.externalTaskIds ?? [];
  if (taskIds.length === 0) return;
  const provider = await getProvider(input.providerId, input.orgId);
  const results = await Promise.allSettled(
    taskIds.map((taskId) =>
      deleteArkVideoTask({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        taskId,
        signal: AbortSignal.timeout(30_000),
      }),
    ),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      console.error("[executor] failed to cancel Ark video task", {
        taskId: taskIds[index],
        error: result.reason,
      });
    }
  }
}
