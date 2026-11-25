import assert from "node:assert/strict";
import test from "node:test";

import type { Logger } from "pino";

import { markBootReady } from "../infrastructure/health/readiness.js";
import { createApp } from "./server-app.js";

test("unexpected request failures keep the client response generic and log the original error", async () => {
  markBootReady();
  const errors: Array<{ bindings: Record<string, unknown>; message: string }> = [];
  const logger = {
    info() {},
    error(bindings: Record<string, unknown>, message: string) {
      errors.push({ bindings, message });
    },
  } as unknown as Logger;
  const failure = new Error("database detail that must not reach the client");
  const app = createApp({ logger });
  app.get("/_test/unhandled", () => {
    throw failure;
  });

  const response = await app.request("/_test/unhandled", {
    headers: {
      "X-Caller-Service": "chat",
      "X-Internal-Token": "dev-chat-internal-token",
    },
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    code: "internal_error",
    message: "An unexpected server error occurred",
  });
  assert.match(response.headers.get("X-Trace-Id") ?? "", /^[0-9a-f]{32}$/);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.bindings.err, failure);
  assert.equal(errors[0]?.bindings.method, "GET");
  assert.equal(errors[0]?.bindings.path, "/_test/unhandled");
  assert.equal(errors[0]?.message, "unhandled runtime request error");
});
