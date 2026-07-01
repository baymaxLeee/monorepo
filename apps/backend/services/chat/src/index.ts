try {
  process.loadEnvFile();
} catch {
  // Local .env is optional; deployed environments inject process.env directly.
}

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { getSettings } from "./config.js";
import { reconcileOrphanedRuns } from "./agent/index.js";

const app = createApp();
const { port } = getSettings();

// Runs before the server accepts traffic so no request can observe a run
// left behind by the previous process's crash/restart (see lease.ts for the
// full gap this closes).
await reconcileOrphanedRuns().catch((error) => {
  console.error("[chat] failed to reconcile orphaned runs on boot", error);
});

serve({ fetch: app.fetch, port }, (info) => {
  console.info(`[chat] listening on :${info.port}`);
});
