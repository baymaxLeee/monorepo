try {
  process.loadEnvFile();
} catch {}

import { configureOpenTelemetry, shutdownOpenTelemetry } from "@backend/kernel-ts";
import { serve } from "@hono/node-server";

import { createApp } from "../../bootstrap/server-app.js";
import { getServerSettings } from "../../bootstrap/server-config.js";
import { bootstrapServer as bootstrapRuntime } from "../../bootstrap/server-runtime.js";
import { logger } from "../../infrastructure/observability/logger.js";
import { closeRedisClient } from "../../infrastructure/redis/index.js";

configureOpenTelemetry("runtime");

const app = createApp();
const { port } = getServerSettings();

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "listening");
});

void bootstrapRuntime().catch(() => undefined);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.allSettled([closeRedisClient(), shutdownOpenTelemetry()]).finally(() => process.exit(0));
  });
}
