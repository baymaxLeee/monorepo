try {
  process.loadEnvFile();
} catch {
  // Local .env is optional; deployed environments inject process.env directly.
}

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { getSettings } from "./config.js";
import { startArtifactWorkerPool } from "./services/agent/artifacts/worker-pool.js";

const app = createApp();
const { port } = getSettings();

startArtifactWorkerPool();

serve({ fetch: app.fetch, port }, (info) => {
  console.info(`[chat] listening on :${info.port}`);
});
