import { defineConfig } from "nitro";

export default defineConfig({
  modules: ["workflow/nitro"],
  // Workflow selects its World from WORKFLOW_TARGET_WORLD at runtime. That
  // environment-driven require is invisible to static tracing, so explicitly
  // keep the deployed Postgres World and its dependency tree in .output.
  traceDeps: ["@workflow/world-postgres"],
  routes: {
    "/**": "./src/index.ts",
  },
});
