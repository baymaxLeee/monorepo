import {
  reconcileOrphanedRuns,
  reconcileSandboxExecutions,
  resumeClaimedAgentRun,
  startOrphanRunReconciler,
  startSandboxExecutionReconciler,
} from "../application/agent/index.js";
import type { ToolCatalog } from "../application/agent/tools/catalog.js";
import { startAssetClaimRelay } from "../application/asset-claim-relay.js";
import { startSessionArtifactCleanupRelay } from "../application/session-artifact-cleanup.js";
import { markBootFailed, markBootReady } from "../infrastructure/health/readiness.js";
import { logger } from "../infrastructure/observability/logger.js";
import { getSql } from "../infrastructure/persistence/index.js";

export async function bootstrapServer(toolCatalog: ToolCatalog): Promise<void> {
  try {
    await getSql()`SELECT 1`;
    const recoverClaimed = (recovery: Parameters<typeof resumeClaimedAgentRun>[0]) =>
      resumeClaimedAgentRun(recovery, toolCatalog);
    await reconcileOrphanedRuns(recoverClaimed);
    await reconcileSandboxExecutions();
    startOrphanRunReconciler(recoverClaimed);
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
