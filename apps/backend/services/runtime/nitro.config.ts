import { defineConfig } from "nitro";

export default defineConfig({
  modules: ["workflow/nitro"],
  traceDeps: ["@workflow/world-postgres*"],
  routes: {
    "/**": "./src/cmd/worker/app.ts",
  },
});
