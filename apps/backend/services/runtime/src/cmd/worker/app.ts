import "@workflow/world-postgres";
import "@workflow/world-postgres/cli";
import { configureOpenTelemetry, shutdownOpenTelemetry } from "@backend/kernel-ts";

import { createApp } from "../../bootstrap/worker-app.js";
import { bootstrapWorker } from "../../bootstrap/worker-runtime.js";

configureOpenTelemetry("runtime-worker");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdownOpenTelemetry().finally(() => process.exit(0));
  });
}

const app = createApp();
void bootstrapWorker().catch(() => undefined);
export default app;
