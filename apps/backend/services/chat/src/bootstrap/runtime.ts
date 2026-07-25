import { reconcileOrphanedRuns, startOrphanRunReconciler } from "../application/agent/index.js";
import { startConversationArtifactCleanupRelay } from "../application/conversation-artifact-cleanup.js";
import { markBootFailed, markBootReady } from "../infrastructure/health/readiness.js";
import { logger } from "../infrastructure/observability/logger.js";
import { getSql } from "../infrastructure/persistence/index.js";

export async function bootstrapChat(): Promise<void> {
  try {
    await getSql()`SELECT 1`;
    await reconcileOrphanedRuns();
    startOrphanRunReconciler();
    startConversationArtifactCleanupRelay();
    markBootReady();
    logger.info("chat bootstrap complete");
  } catch (error) {
    markBootFailed(error);
    logger.error({ err: error }, "chat bootstrap failed");
    throw error;
  }
}
