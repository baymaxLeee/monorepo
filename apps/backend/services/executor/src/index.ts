import { createApp } from "./app.js";
import { reconcilePendingTasks } from "./tasks/service.js";

// Nitro mounts this module's default export as the app's HTTP handler
// (nitro.config.ts routes "/**" here); it does not call serve() itself the
// way chat's src/index.ts does with @hono/node-server.
void reconcilePendingTasks().catch((error) => {
  console.error("[executor] failed to reconcile pending tasks on boot", error);
});

export default createApp();
