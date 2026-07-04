try {
  process.loadEnvFile();
} catch {
}

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { getSettings } from "./config.js";
import { reconcileOrphanedRuns } from "./agent/index.js";

const app = createApp();
const { port } = getSettings();

await reconcileOrphanedRuns().catch((error) => {
  console.error("[chat] failed to reconcile orphaned runs on boot", error);
});

serve({ fetch: app.fetch, port }, (info) => {
  console.info(`[chat] listening on :${info.port}`);
});
