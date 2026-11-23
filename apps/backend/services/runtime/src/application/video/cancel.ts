import type { VideoGenerationInput } from "../../../workflows/video-generation.js";
import { deleteArkVideoTask } from "../../infrastructure/clients/ark.js";
import { releaseTaskAsset } from "../../infrastructure/clients/storage-media.js";
import type { TaskProgress } from "../tasks/types.js";

export async function cancelVideoGeneration(
  input: VideoGenerationInput,
  progress: TaskProgress | null,
  context: { taskId: string },
): Promise<void> {
  const externalIds = progress?.externalTaskIds ?? [];
  const cleanup: Array<Promise<unknown>> = [];
  if (externalIds.includes("asset:video:final")) {
    cleanup.push(releaseTaskAsset(context.taskId, "video:final"));
  }
  const providerTaskIds = externalIds.flatMap((value) => (value.startsWith("provider:") ? [value.slice(9)] : []));
  if (providerTaskIds.length > 0) {
    cleanup.push(
      ...providerTaskIds.map((taskId) =>
        deleteArkVideoTask({
          baseUrl: input.provider.baseUrl,
          apiKey: input.provider.apiKey,
          taskId,
          signal: AbortSignal.timeout(30_000),
        }),
      ),
    );
  }
  const results = await Promise.allSettled(cleanup);
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      "Video cancellation cleanup is incomplete",
    );
}
