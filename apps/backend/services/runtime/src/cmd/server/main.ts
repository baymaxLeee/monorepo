try {
  process.loadEnvFile();
} catch {}

import { serve } from "@hono/node-server";

import { configureOpenTelemetry, shutdownOpenTelemetry } from "#runtime/foundation";

import { createApp } from "../../bootstrap/server-app.js";
import { bootstrapServer } from "../../bootstrap/server-runtime.js";
import { getServerSettings } from "../../config/server.js";
import { logger } from "../../infrastructure/observability/logger.js";
import { closeSql } from "../../infrastructure/persistence/index.js";
import { closeRedisClient } from "../../infrastructure/redis/index.js";

configureOpenTelemetry("runtime");

const app = createApp();
const { port } = getServerSettings();

const server = serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "listening");
});

void bootstrapServer().catch(() => undefined);

let shutdown: Promise<void> | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown ??= (async () => {
      let firstError: unknown;
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      } catch (error) {
        firstError = error;
      }
      const trailing = await Promise.allSettled([closeSql(), closeRedisClient(), shutdownOpenTelemetry()]);
      firstError ??= trailing.find((result) => result.status === "rejected")?.reason;
      if (firstError) throw firstError;
    })();
    void shutdown.then(
      () => process.exit(0),
      (error) => {
        logger.error({ err: error, signal }, "runtime server shutdown failed");
        process.exit(1);
      },
    );
  });
}
