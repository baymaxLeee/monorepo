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
  "telemetry-server": {
    input: `${schemasRoot}/telemetry-server.json`,
    output: {
      mode: "single",
      target: "generated/telemetry-server/index.ts",
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
