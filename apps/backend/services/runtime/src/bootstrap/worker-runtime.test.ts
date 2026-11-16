import assert from "node:assert/strict";
import test from "node:test";

import { createWorkerShutdown } from "./worker-runtime.js";

test("worker shutdown drains the World before closing HTTP and dependencies", async () => {
  const events: string[] = [];
  let releaseRecovery!: () => void;
  const recoveryStopped = new Promise<void>((resolve) => {
    releaseRecovery = resolve;
  });
  const shutdown = createWorkerShutdown({
    markStopping: () => events.push("not-ready"),
    stopRecoveries: async () => {
      events.push("stop-recovery");
      await recoveryStopped;
    },
    closeWorld: async () => {
      events.push("world");
    },
    closeHttp: async () => {
      events.push("http");
    },
    closeDatabase: async () => {
      events.push("database");
    },
    closeTelemetry: async () => {
      events.push("telemetry");
    },
  });

  const first = shutdown();
  const second = shutdown();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.deepEqual(events, ["not-ready", "stop-recovery"]);
  releaseRecovery();
  await Promise.all([first, second]);

  assert.deepEqual(events.slice(0, 4), ["not-ready", "stop-recovery", "world", "http"]);
  assert.deepEqual(new Set(events.slice(4)), new Set(["database", "telemetry"]));
  assert.equal(events.length, 6);
});

test("worker shutdown still closes HTTP and dependencies when World draining fails", async () => {
  const events: string[] = [];
  const shutdown = createWorkerShutdown({
    markStopping: () => {},
    stopRecoveries: async () => {},
    closeWorld: async () => {
      events.push("world");
      throw new Error("world failed");
    },
    closeHttp: async () => {
      events.push("http");
    },
    closeDatabase: async () => {
      events.push("database");
    },
    closeTelemetry: async () => {
      events.push("telemetry");
    },
  });

  await assert.rejects(shutdown(), /world failed/);
  assert.deepEqual(events.slice(0, 2), ["world", "http"]);
  assert.deepEqual(new Set(events.slice(2)), new Set(["database", "telemetry"]));
});
