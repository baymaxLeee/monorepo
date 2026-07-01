import { getWorld } from "workflow/runtime";

import { createApp } from "./app.js";
import { reconcilePendingTasks } from "./tasks/service.js";

// Nitro mounts this module's default export as the app's HTTP handler
// (nitro.config.ts routes "/**" here); it does not call serve() itself the
// way chat's src/index.ts does with @hono/node-server.
//
// Required for the Postgres World (deployed environments — see
// docs/微服务/executor.md): setting WORKFLOW_TARGET_WORLD alone does not
// start anything, the graphile-worker queue that actually processes steps
// only begins polling once something calls start(). The docs' own example
// wires this via a Nitro plugin importing "nitro/~internal/runtime/plugin",
// but that subpath isn't exported by nitro@3.0.260610-beta (another Nitro v3
// beta API mismatch, see executor/AGENTS.md); calling it here at module
// scope — the same place reconcilePendingTasks() already runs — works
// instead and needs no Nitro-specific plugin API.
//
// Only do this when a non-default world is actually configured: calling
// start() against the bundled Local World (empirically verified, not a
// documentation assumption) throws `Invalid version string: "bundled"` —
// harmless since it's caught below and local dev's queue works without an
// explicit start() either way, but noisy on every boot for no benefit.
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
