import { getWorld } from "workflow/runtime";

import { reconcilePendingTasks } from "../application/tasks/service.js";
import {
  recoverStaleVideoProductionDecisions,
  startStaleVideoProductionDecisionRecovery,
} from "../application/video-production/decisions.js";
import { markBootFailed, markBootReady, markWorkflowWorldStarted } from "../infrastructure/health/readiness.js";
import { logger } from "../infrastructure/observability/logger.js";
import { getSql } from "../infrastructure/persistence/index.js";

export async function bootstrapExecutor(): Promise<void> {
  try {
    await getSql()`SELECT 1`;
    if (process.env.WORKFLOW_TARGET_WORLD) {
      await getWorld().start?.();
      markWorkflowWorldStarted();
    }
    await reconcilePendingTasks();
    await recoverStaleVideoProductionDecisions();
    startStaleVideoProductionDecisionRecovery();
    markBootReady();
    logger.info("executor bootstrap complete");
  } catch (error) {
    markBootFailed(error);
    logger.error({ err: error }, "executor bootstrap failed");
    throw error;
  }
}
