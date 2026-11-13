import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    passWithNoTests: false,
    allowOnly: !process.env.CI,
    // The editor readiness contract allows up to 10 seconds. Keep the outer
    // Vitest budget larger so slower Linux CI runners can observe that result.
    testTimeout: 15_000,
    projects: globSync(["apps/*/package.json", "packages/*/package.json"], { cwd: root }).map((manifest) => {
      const projectRoot = path.join(root, path.dirname(manifest));
      const { name } = JSON.parse(readFileSync(path.join(root, manifest), "utf8")) as { name: string };
      return {
        root: projectRoot,
        configFile: false,
        plugins: [react()],
        resolve: { alias: { "@": path.join(projectRoot, "src") } },
        test: {
          name,
          environment: "jsdom",
          include: ["{src,test}/**/*.{test,spec}.{ts,tsx,js,jsx,mjs}"],
          globalSetup: existsSync(path.join(projectRoot, "test/global-setup.ts"))
            ? [path.join(projectRoot, "test/global-setup.ts")]
            : [],
          setupFiles: [path.join(root, "test/setup.ts")],
          clearMocks: true,
          restoreMocks: true,
        },
      };
    }),
  },
});
