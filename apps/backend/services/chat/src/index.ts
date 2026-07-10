try {
  process.loadEnvFile();
} catch {
}

import { serve } from "@hono/node-server";
import { configureOpenTelemetry, shutdownOpenTelemetry } from "@backend/kernel-ts";

import { createApp } from "./app.js";
import { bootstrapChat } from "./lib/bootstrap.js";
import { getSettings } from "./config.js";
import { logger } from "./lib/logger.js";

configureOpenTelemetry("chat");

const app = createApp();
const { port } = getSettings();

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "listening");
});

void bootstrapChat().catch(() => undefined);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdownOpenTelemetry().finally(() => process.exit(0));
  });
}
