import "@workflow/world-postgres";
import "@workflow/world-postgres/cli";
import { getWorld } from "workflow/runtime";

import { createApp } from "./app.js";
import { reconcilePendingTasks } from "./tasks/service.js";

if (process.env.WORKFLOW_TARGET_WORLD) {
  void getWorld()
    .start?.()
    .catch((error: unknown) => {
      console.error("[executor] failed to start workflow world", error);
    });
}

void reconcilePendingTasks().catch((error) => {
  console.error("[executor] failed to reconcile pending tasks on boot", error);
});

export default createApp();
