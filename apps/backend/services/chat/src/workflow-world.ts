import { createWorld, setWorld } from "workflow/runtime";

type StreamFlushWorld = ReturnType<typeof createWorld> & {
  streamFlushIntervalMs?: number;
};

let configured = false;

export function configureWorkflowWorld(): void {
  if (configured) return;
  configured = true;

  const world = createWorld() as StreamFlushWorld;
  world.streamFlushIntervalMs = 0;
  setWorld(world);
}
