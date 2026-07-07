try {
  process.loadEnvFile();
} catch {
}

import { serve } from "@hono/node-server";
import { configureOpenTelemetry, shutdownOpenTelemetry } from "@backend/kernel-ts";

import { createApp } from "./app.js";
import { getSettings } from "./config.js";
import { reconcileOrphanedRuns } from "./agent/index.js";
import { logger } from "./lib/logger.js";

configureOpenTelemetry("chat");

const app = createApp();
const { port } = getSettings();

await reconcileOrphanedRuns().catch((error) => {
  logger.error({ err: error }, "failed to reconcile orphaned runs on boot");
});

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdownOpenTelemetry().finally(() => process.exit(0));
  });
}
