import { defineConfig } from "nitro";

export default defineConfig({
  modules: ["workflow/nitro"],
  // The runtime image copies only `.output` (no node_modules), so production
  // deps must be self-contained. Two distinct cases:
  //   - @backend/transport-ts is a source-only workspace package; inlining it
  //     forces Nitro to bundle it AND its transitive dep `openapi-fetch`
  //     (which otherwise stays external and is unresolvable at runtime).
  //   - @vercel/oidc resolves its entry at runtime so it can't be bundled;
  //     trace (copy) it into the output instead.
  externals: {
    inline: ["@backend/transport-ts", "openapi-fetch"],
  },
  traceDeps: ["@vercel/oidc"],
  routes: {
    "/**": "./src/index.ts",
  },
});
