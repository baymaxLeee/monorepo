import assert from "node:assert/strict";
import test from "node:test";

import { ToolExecutionScheduler } from "./scheduler.js";

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("exclusive tools form a fair barrier without dropping later parallel calls", async () => {
  const scheduler = new ToolExecutionScheduler();
  const releaseFirst = deferred();
  const releaseExclusive = deferred();
  const started: string[] = [];

  const first = scheduler.run(true, async () => {
    started.push("parallel:first");
    await releaseFirst.promise;
  });
  const exclusive = scheduler.run(false, async () => {
    started.push("exclusive");
    await releaseExclusive.promise;
  });
  const second = scheduler.run(true, async () => {
    started.push("parallel:second");
  });

  await Promise.resolve();
  assert.deepEqual(started, ["parallel:first"]);
  releaseFirst.resolve();
  await first;
  await Promise.resolve();
  assert.deepEqual(started, ["parallel:first", "exclusive"]);
  releaseExclusive.resolve();
  await Promise.all([exclusive, second]);
  assert.deepEqual(started, ["parallel:first", "exclusive", "parallel:second"]);
});

test("a queued tool observes cancellation before execution", async () => {
  const scheduler = new ToolExecutionScheduler();
  const releaseExclusive = deferred();
  const held = scheduler.run(false, () => releaseExclusive.promise);
  const abort = new AbortController();
  let executed = false;
  const queued = scheduler.run(
    false,
    () => {
      executed = true;
    },
    abort.signal,
  );

  abort.abort(new Error("cancelled"));
  await assert.rejects(queued, /cancelled/);
  assert.equal(executed, false);
  releaseExclusive.resolve();
  await held;
});
