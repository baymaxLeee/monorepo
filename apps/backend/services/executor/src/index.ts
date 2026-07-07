import "@workflow/world-postgres";
import "@workflow/world-postgres/cli";
import { configureOpenTelemetry, shutdownOpenTelemetry } from "@backend/kernel-ts";
import { getWorld } from "workflow/runtime";

import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { reconcilePendingTasks } from "./tasks/service.js";

configureOpenTelemetry("executor");

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

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdownOpenTelemetry().finally(() => process.exit(0));
  });
}

export default createApp();
