import assert from "node:assert/strict";
import test from "node:test";

import { getSandboxSettings } from "./sandbox.js";
import { parseServerSettings } from "./server.js";
import { parseWorkerSettings } from "./worker.js";

const strong = (value: string) => value.repeat(32);
const database = {
  ENVIRONMENT: "production",
  POSTGRES_HOST: "postgres",
  POSTGRES_PASSWORD: strong("p"),
};

test("each process parses only its own configuration contract", () => {
  const server = parseServerSettings({
    ...database,
    REDIS_HOST: "redis",
    INTERNAL_API_TOKEN: strong("s"),
    INTERNAL_SERVICE_TOKENS: JSON.stringify({ chat: strong("c") }),
    TOOL_APPROVAL_SECRET: strong("a"),
    WORKFLOW_POSTGRES_WORKER_CONCURRENCY: "not-a-number",
    SANDBOX_BACKEND: "not-a-backend",
  });
  const worker = parseWorkerSettings({
    ...database,
    WORKFLOW_TARGET_WORLD: "@workflow/world-postgres",
    INTERNAL_API_TOKEN: strong("w"),
    INTERNAL_SERVICE_TOKENS: JSON.stringify({ runtime: strong("r") }),
    REDIS_HOST: "invalid-for-server",
    TOOL_APPROVAL_SECRET: "invalid-for-server",
    SANDBOX_BACKEND: "not-a-backend",
  });
  const sandbox = getSandboxSettings({
    ENVIRONMENT: "production",
    INTERNAL_SERVICE_TOKENS: JSON.stringify({ runtime: strong("r") }),
    SANDBOX_BACKEND: "kubernetes",
    SANDBOX_RUNTIME: "runsc",
    POSTGRES_HOST: "invalid-for-runtime",
    EXA_API_KEY: "must-not-be-read",
  });

  assert.equal(server.chatCallerToken, strong("c"));
  assert.equal(server.knowledgeServiceUrl, "http://localhost:8010");
  assert.equal(server.canvasServiceUrl, "http://localhost:8012");
  assert.equal("internalServiceTokens" in server, false);
  assert.deepEqual(worker.internalServiceTokens, { runtime: strong("r") });
  assert.equal("redisHost" in worker, false);
  assert.equal(sandbox.backend, "kubernetes");
  assert.equal("postgresHost" in sandbox, false);
});

test("invalid numeric configuration fails instead of silently selecting a default", () => {
  const server = {
    ...database,
    REDIS_HOST: "redis",
    INTERNAL_API_TOKEN: strong("s"),
    INTERNAL_SERVICE_TOKENS: JSON.stringify({ chat: strong("c") }),
    TOOL_APPROVAL_SECRET: strong("a"),
  };
  const worker = {
    ...database,
    WORKFLOW_TARGET_WORLD: "@workflow/world-postgres",
    INTERNAL_API_TOKEN: strong("w"),
    INTERNAL_SERVICE_TOKENS: JSON.stringify({ runtime: strong("r") }),
  };

  assert.throws(() => parseServerSettings({ ...server, PORT: "not-a-port" }), /PORT must be a positive integer/);
  assert.throws(() => parseServerSettings({ ...server, REDIS_DB: "-1" }), /REDIS_DB must be a non-negative integer/);
  assert.throws(
    () => parseServerSettings({ ...server, CANVAS_SERVICE_URL: "file:///tmp/canvas" }),
    /CANVAS_SERVICE_URL must be an absolute HTTP URL/,
  );
  assert.throws(
    () => parseWorkerSettings({ ...worker, WORKFLOW_POSTGRES_WORKER_CONCURRENCY: "invalid" }),
    /WORKFLOW_POSTGRES_WORKER_CONCURRENCY must be a positive integer/,
  );
});
