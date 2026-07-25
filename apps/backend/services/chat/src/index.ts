try {
  process.loadEnvFile();
} catch {}

import { configureOpenTelemetry, shutdownOpenTelemetry } from "@backend/kernel-ts";
import { serve } from "@hono/node-server";

import { createApp } from "./bootstrap/app.js";
import { getSettings } from "./bootstrap/config.js";
import { bootstrapChat } from "./bootstrap/runtime.js";
import { logger } from "./infrastructure/observability/logger.js";
import { closeRedisClient } from "./infrastructure/redis/index.js";

configureOpenTelemetry("chat");

const app = createApp();
const { port } = getSettings();

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "listening");
});

void bootstrapChat().catch(() => undefined);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.allSettled([closeRedisClient(), shutdownOpenTelemetry()]).finally(() => process.exit(0));
  });
}
