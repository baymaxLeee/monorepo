import { getWorld } from "workflow/runtime";

import { getSql } from "../db/index.js";
import { reconcilePendingTasks } from "../tasks/service.js";
import { logger } from "./logger.js";
import {
  markBootFailed,
  markBootReady,
  markWorkflowWorldStarted,
} from "./readiness.js";

export async function bootstrapExecutor(): Promise<void> {
  try {
    await getSql()`SELECT 1`;
    if (process.env.WORKFLOW_TARGET_WORLD) {
      await getWorld().start?.();
      markWorkflowWorldStarted();
    }
    await reconcilePendingTasks();
    markBootReady();
    logger.info("executor bootstrap complete");
  } catch (error) {
    markBootFailed(error);
    logger.error({ err: error }, "executor bootstrap failed");
    throw error;
  }
}
