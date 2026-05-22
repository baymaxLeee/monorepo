import { defineConfig } from "orval";

const schemasRoot = "../../../../schemas/openapi";

export default defineConfig({
  "admin-server": {
    input: `${schemasRoot}/admin-server.json`,
    output: {
      mode: "single",
      target: "generated/admin-server/index.ts",
      client: "axios",
      override: {
        mutator: {
          path: "./src/orval-mutator.ts",
          name: "apiMutator",
        },
      },
    },
  },
});
