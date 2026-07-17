try {
  process.loadEnvFile();
} catch {
}

import { serve } from "@hono/node-server";
import { configureOpenTelemetry, shutdownOpenTelemetry } from "@backend/kernel-ts";

import { createApp } from "./bootstrap/app.js";
import { bootstrapChat } from "./bootstrap/runtime.js";
import { getSettings } from "./bootstrap/config.js";
import { logger } from "./infrastructure/observability/logger.js";

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
