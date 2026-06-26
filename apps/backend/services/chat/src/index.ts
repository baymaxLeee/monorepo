try {
  process.loadEnvFile();
} catch {
  // Local .env is optional; deployed environments inject process.env directly.
}

import { createApp } from "./app.js";
import { configureWorkflowWorld } from "./workflow-world.js";

configureWorkflowWorld();
const app = createApp();

export default app;
