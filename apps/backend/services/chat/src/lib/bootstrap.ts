import { reconcileOrphanedRuns, startOrphanRunReconciler } from "../agent/index.js";
import { getSql } from "../db/index.js";
import { logger } from "./logger.js";
import { markBootFailed, markBootReady } from "./readiness.js";

export async function bootstrapChat(): Promise<void> {
  try {
    await getSql()`SELECT 1`;
    await reconcileOrphanedRuns();
    startOrphanRunReconciler();
    markBootReady();
    logger.info("chat bootstrap complete");
  } catch (error) {
    markBootFailed(error);
    logger.error({ err: error }, "chat bootstrap failed");
    throw error;
  }
}
