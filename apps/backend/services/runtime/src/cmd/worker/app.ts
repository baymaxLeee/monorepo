import "@workflow/world-postgres";
import "@workflow/world-postgres/cli";
import { configureOpenTelemetry } from "@backend/kernel-ts";

import { createApp } from "../../bootstrap/worker-app.js";
import { bootstrapWorker, workerShutdown } from "../../bootstrap/worker-runtime.js";
import { prepareWorkerEnvironment } from "../../config/worker.js";
import { logger } from "../../infrastructure/observability/worker-logger.js";

configureOpenTelemetry("runtime-worker");
prepareWorkerEnvironment();

const app = createApp();
void bootstrapWorker().catch(() => undefined);

if (process.env.RUNTIME_WORKER_HTTP_OWNER === "nitro") {
  // Nitro owns the listener and drains active requests on the same signal. This
  // handler owns World, recovery-loop, database and telemetry shutdown.
  const shutdown = workerShutdown(async () => {});
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown().catch((error) => {
        process.exitCode = 1;
        logger.error({ err: error, signal }, "runtime worker shutdown failed");
      });
    });
  }
}
export default app;
