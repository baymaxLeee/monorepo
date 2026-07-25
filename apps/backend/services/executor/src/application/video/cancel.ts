import type { VideoGenerationInput } from "../../../workflows/video-generation.js";
import { getProvider } from "../../infrastructure/clients/admin.js";
import { deleteArkVideoTask } from "../../infrastructure/clients/ark.js";
import { discardStagedMedia } from "../../infrastructure/clients/knowledge.js";
import type { TaskProgress } from "../tasks/types.js";
import { cancelVideoProductionProjection } from "../video-production/service.js";

export async function cancelVideoGeneration(
  input: VideoGenerationInput,
  progress: TaskProgress | null,
  context: { taskId: string },
): Promise<void> {
  const taskIds = progress?.externalTaskIds ?? [];
  const production = await cancelVideoProductionProjection(context.taskId);
  const cleanup: Array<Promise<unknown>> = [];
  if (production?.stagedMediaId) {
    cleanup.push(
      discardStagedMedia({
        userId: input.userId,
        orgId: input.orgId,
        stagedId: production.stagedMediaId,
      }),
    );
  }
  for (const stagedId of production?.shotReviews.flatMap((review) =>
    review.takes.flatMap((take) => (take.stagedMediaId ? [take.stagedMediaId] : [])),
  ) ?? []) {
    cleanup.push(
      discardStagedMedia({
        userId: input.userId,
        orgId: input.orgId,
        stagedId,
      }),
    );
  }
  if (taskIds.length > 0) {
    const provider = await getProvider(input.providerId, input.orgId);
    cleanup.push(
      ...taskIds.map((taskId) =>
        deleteArkVideoTask({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          taskId,
          signal: AbortSignal.timeout(30_000),
        }),
      ),
    );
  }
  const results = await Promise.allSettled(cleanup);
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      console.error("[executor] video cancellation cleanup failed", {
        operation: index,
        error: result.reason,
      });
    }
  }
}
