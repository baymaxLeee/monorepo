import { getWorld } from "workflow/runtime";

import { reconcileTaskCleanup, startTaskCleanupRecovery } from "../application/tasks/cleanup.js";
import { reconcilePendingTasks, startPendingTaskRecovery } from "../application/tasks/service.js";
import {
  recoverStaleVideoProductionDecisions,
  startStaleVideoProductionDecisionRecovery,
} from "../application/video-production/decisions.js";
import { markBootFailed, markBootReady, markWorkflowWorldStarted } from "../infrastructure/health/worker-readiness.js";
import { logger } from "../infrastructure/observability/worker-logger.js";
import { getSql } from "../infrastructure/persistence/index.js";

export async function bootstrapWorker(): Promise<void> {
  try {
    await getSql()`SELECT 1`;
    if (process.env.WORKFLOW_TARGET_WORLD) {
      await (await getWorld()).start?.();
      markWorkflowWorldStarted();
    }
    await reconcilePendingTasks();
    startPendingTaskRecovery();
    await reconcileTaskCleanup();
    startTaskCleanupRecovery();
    await recoverStaleVideoProductionDecisions();
    startStaleVideoProductionDecisionRecovery();
    markBootReady();
    logger.info("runtime worker bootstrap complete");
  } catch (error) {
    markBootFailed(error);
    logger.error({ err: error }, "runtime worker bootstrap failed");
    throw error;
  }
}
