import { createWorld, setWorld } from "workflow/runtime";

import { getSettings } from "./config.js";

type StreamFlushWorld = ReturnType<typeof createWorld> & {
  streamFlushIntervalMs?: number;
};

let configured = false;

export function configureWorkflowWorld(): void {
  if (configured) return;
  configured = true;

  const settings = getSettings();
  if (
    settings.workflowTargetWorld === "@workflow/world-postgres" &&
    !settings.workflowPostgresUrl
  ) {
    throw new Error(
      "WORKFLOW_POSTGRES_URL is required when WORKFLOW_TARGET_WORLD=@workflow/world-postgres",
    );
  }

  const world = createWorld() as StreamFlushWorld;
  world.streamFlushIntervalMs = 0;
  setWorld(world);
}
