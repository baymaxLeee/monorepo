import "@workflow/world-postgres";
import "@workflow/world-postgres/cli";
import { configureOpenTelemetry, shutdownOpenTelemetry } from "@backend/kernel-ts";

import { createApp } from "./app.js";
import { bootstrapExecutor } from "./lib/bootstrap.js";

configureOpenTelemetry("executor");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdownOpenTelemetry().finally(() => process.exit(0));
  });
}

const app = createApp();
void bootstrapExecutor().catch(() => undefined);
export default app;
