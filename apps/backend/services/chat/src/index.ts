import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { getSettings } from "./config.js";
import { closeDb } from "./db/index.js";
import { closeRedis } from "./services/agent-streams.js";

const app = createApp();
const settings = getSettings();

const server = serve({ fetch: app.fetch, port: settings.port }, (info) => {
  console.log(`chat service listening on :${info.port}`);
});

async function shutdown() {
  await closeRedis();
  await closeDb();
  server.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
