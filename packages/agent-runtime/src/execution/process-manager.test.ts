import assert from "node:assert/strict";
import test from "node:test";

import { ProcessManager } from "./process-manager.js";

test("released process ids may be reused but stale entry identities cannot address the replacement", () => {
  const manager = new ProcessManager();
  const first = manager.reserve();
  manager.markRunning(first, { terminate() {} });
  manager.markExited(first);
  manager.close(first);

  const second = manager.reserve();
  assert.equal(second.processId, first.processId);
  assert.notEqual(second.entryId, first.entryId);
  assert.throws(() => manager.get(first), /unknown process/);
  assert.equal(manager.state(second), "starting");
});

test("closing the manager terminates the exact retained process entries", () => {
  const terminated: string[] = [];
  const manager = new ProcessManager();
  const one = manager.reserve();
  const two = manager.reserve();
  manager.markRunning(one, { terminate: () => terminated.push("one") });
  manager.markRunning(two, { terminate: () => terminated.push("two") });

  manager.closeAll();

  assert.deepEqual(terminated.sort(), ["one", "two"]);
  assert.throws(() => manager.get(one), /unknown process/);
  assert.throws(() => manager.get(two), /unknown process/);
});

test("one-shot processes reject a late result after manager closure", async () => {
  const manager = new ProcessManager();
  let release!: () => void;
  const operation = manager.run(
    async (_identity, signal) =>
      await new Promise<string>((resolve) => {
        release = () => resolve(signal.aborted ? "late" : "running");
      }),
  );

  manager.closeAll();
  release();
  await assert.rejects(operation, /process 1 closed/);
});

test("bulk shutdown revokes every old identity before invoking host callbacks", () => {
  const manager = new ProcessManager();
  const first = manager.reserve();
  const second = manager.reserve();
  let secondWasLive = false;
  let secondStopped = false;
  manager.markRunning(first, {
    terminate() {
      secondWasLive = manager.contains(second);
      throw new Error("native shutdown failed");
    },
  });
  manager.markRunning(second, {
    terminate() {
      secondStopped = true;
    },
  });
  assert.throws(() => manager.closeAll());
  assert.equal(secondWasLive, false);
  assert.equal(secondStopped, true);
  assert.equal(manager.contains(first), false);
});
