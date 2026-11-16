import { createLogger } from "@backend/kernel-ts";
import { serve } from "@hono/node-server";

import { createApp } from "../../roles/sandbox/app.js";
import { settings } from "../../roles/sandbox/config.js";
import { Engine } from "../../roles/sandbox/engine.js";

try {
  process.loadEnvFile(".env.sandbox");
} catch {}
const config = settings();
const engine = new Engine(config);
const logger = createLogger({ service: "runtime-sandbox" });
const server = serve({ fetch: createApp(config, engine).fetch, port: config.port });
let reaping = false;
const reap = async () => {
  if (reaping) return;
  reaping = true;
  try {
    await engine.reap();
  } catch (error) {
    logger.error({ err: error }, "sandbox cleanup failed");
  } finally {
    reaping = false;
  }
};
void reap();
const timer = setInterval(() => void reap(), 30000);
timer.unref();
for (const event of ["SIGINT", "SIGTERM"] as const)
  process.on(event, () => {
    clearInterval(timer);
    server.close();
  });
