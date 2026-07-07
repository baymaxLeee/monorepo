import "@workflow/world-postgres";
import "@workflow/world-postgres/cli";
import { getWorld } from "workflow/runtime";

import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { reconcilePendingTasks } from "./tasks/service.js";

if (process.env.WORKFLOW_TARGET_WORLD) {
  void getWorld()
    .start?.()
    .catch((error: unknown) => {
      logger.error({ err: error }, "failed to start workflow world");
    });
}

void reconcilePendingTasks().catch((error) => {
  logger.error({ err: error }, "failed to reconcile pending tasks on boot");
});

export default createApp();
