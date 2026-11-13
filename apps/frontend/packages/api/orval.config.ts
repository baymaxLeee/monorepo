import { defineConfig } from "orval";

const schemasRoot = "../../../../schemas/openapi";

export default defineConfig({
  "iam-server": {
    input: `${schemasRoot}/iam-server.json`,
    output: {
      mode: "single",
      target: "src/iam-server.ts",
      client: "axios-functions",
      baseUrl: "/api/iam-server",
      override: { mutator: { path: "./src/orval-mutator.ts", name: "apiMutator" } },
    },
  },
  "storage-server": {
    input: `${schemasRoot}/storage-server.json`,
    output: {
      mode: "single",
      target: "src/storage-server.ts",
      client: "axios-functions",
      baseUrl: "/api/storage-server",
      override: { mutator: { path: "./src/orval-mutator.ts", name: "apiMutator" } },
    },
  },
  "canvas-server": {
    input: `${schemasRoot}/canvas-server.json`,
    output: {
      mode: "single",
      target: "src/canvas-server.ts",
      client: "axios-functions",
      baseUrl: "/api/canvas-server",
      override: { mutator: { path: "./src/orval-mutator.ts", name: "apiMutator" } },
    },
  },
  "admin-server": {
    input: `${schemasRoot}/admin-server.json`,
    output: {
      mode: "single",
      target: "src/admin-server.ts",
      client: "axios-functions",
      baseUrl: "/api/admin-server",
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
      target: "src/chat-server.ts",
      client: "axios-functions",
      baseUrl: "/api/chat-server",
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
      target: "src/knowledge-server.ts",
      client: "axios-functions",
      baseUrl: "/api/knowledge-server",
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
      target: "src/telemetry-server.ts",
      client: "axios-functions",
      baseUrl: "/api/telemetry-server",
      override: {
        mutator: {
          path: "./src/orval-mutator.ts",
          name: "apiMutator",
        },
      },
    },
  },
});
