try {
  process.loadEnvFile();
} catch {}

import { configureOpenTelemetry, shutdownOpenTelemetry } from "@backend/kernel-ts";
import { serve } from "@hono/node-server";

import { createApp } from "./bootstrap/app.js";
import { getSettings } from "./bootstrap/config.js";
import { bootstrapChat } from "./bootstrap/runtime.js";
import { logger } from "./infrastructure/observability/logger.js";
import { closeSql } from "./infrastructure/persistence/index.js";

configureOpenTelemetry("chat");
serve({ fetch: createApp().fetch, port: getSettings().port }, (info) => {
  logger.info({ port: info.port }, "listening");
});

void bootstrapChat().catch(() => undefined);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.allSettled([closeSql(), shutdownOpenTelemetry()]).finally(() => process.exit(0));
  });
}
