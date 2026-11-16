import {
  reconcileOrphanedRuns,
  reconcileSandboxExecutions,
  startOrphanRunReconciler,
  startSandboxExecutionReconciler,
} from "../application/agent/index.js";
import { startAssetClaimRelay } from "../application/asset-claim-relay.js";
import { startSessionArtifactCleanupRelay } from "../application/session-artifact-cleanup.js";
import { markBootFailed, markBootReady } from "../infrastructure/health/readiness.js";
import { logger } from "../infrastructure/observability/logger.js";
import { getSql } from "../infrastructure/persistence/index.js";

export async function bootstrapServer(): Promise<void> {
  try {
    await getSql()`SELECT 1`;
    await reconcileOrphanedRuns();
    await reconcileSandboxExecutions();
    startOrphanRunReconciler();
    startSandboxExecutionReconciler();
    startAssetClaimRelay();
    startSessionArtifactCleanupRelay();
    markBootReady();
    logger.info("runtime server bootstrap complete");
  } catch (error) {
    markBootFailed(error);
    logger.error({ err: error }, "runtime server bootstrap failed");
    throw error;
  }
}
