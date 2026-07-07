try {
  process.loadEnvFile();
} catch {
}

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { getSettings } from "./config.js";
import { reconcileOrphanedRuns } from "./agent/index.js";
import { logger } from "./lib/logger.js";

const app = createApp();
const { port } = getSettings();

await reconcileOrphanedRuns().catch((error) => {
  logger.error({ err: error }, "failed to reconcile orphaned runs on boot");
});

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "listening");
});
