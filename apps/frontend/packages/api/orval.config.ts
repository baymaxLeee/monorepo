import { defineConfig } from "orval";

const schemasRoot = "../../../../schemas/openapi";

export default defineConfig({
  "asset-server": {
    input: `${schemasRoot}/asset-server.json`,
    output: {
      mode: "single",
      target: "generated/asset-server/index.ts",
      client: "axios",
      baseUrl: "/api/asset-server",
      override: { mutator: { path: "./src/orval-mutator.ts", name: "apiMutator" } },
    },
  },
  "canvas-server": {
    input: `${schemasRoot}/canvas-server.json`,
    output: {
      mode: "single",
      target: "generated/canvas-server/index.ts",
      client: "axios",
      baseUrl: "/api/canvas-server",
      override: { mutator: { path: "./src/orval-mutator.ts", name: "apiMutator" } },
    },
  },
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
  "chat-server": {
    input: `${schemasRoot}/chat-server.json`,
    output: {
      mode: "single",
      target: "generated/chat-server/index.ts",
      client: "axios",
      override: {
        mutator: {
          path: "./src/orval-mutator.ts",
          name: "apiMutator",
        },
      },
    },
  },
  "knowledge-server": {
    input: `${schemasRoot}/knowledge-server.json`,
    output: {
      mode: "single",
      target: "generated/knowledge-server/index.ts",
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
