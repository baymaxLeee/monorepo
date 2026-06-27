import { createWorld as createPostgresWorld } from "@workflow/world-postgres";
import { setWorld } from "workflow/runtime";

import { getSettings } from "./config.js";

let configured = false;

export function configureWorkflowWorld(): void {
  if (configured) return;
  configured = true;

  const settings = getSettings();
  if (!settings.workflowPostgresUrl) {
    throw new Error("WORKFLOW_POSTGRES_URL is required");
  }

  const world = createPostgresWorld({
    connectionString: settings.workflowPostgresUrl,
    streamFlushIntervalMs: 0,
  });
  setWorld(world);
}
