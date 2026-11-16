import { defineConfig } from "nitro";

// Worker-only build graph. Server and sandbox run their explicit cmd entrypoints;
// they must not be added to this bundle or inherit Workflow World configuration.
export default defineConfig({
  modules: ["workflow/nitro"],
  traceDeps: ["@workflow/world-postgres*"],
  routes: {
    "/**": "./src/cmd/worker/app.ts",
  },
});
