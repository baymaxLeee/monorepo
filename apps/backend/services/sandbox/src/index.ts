import { createLogger } from "@backend/kernel-ts";
import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { settings } from "./config.js";
import { Engine } from "./engine.js";

try {
  process.loadEnvFile();
} catch {}
const config = settings();
const engine = new Engine(config);
const logger = createLogger({ service: "sandbox" });
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
