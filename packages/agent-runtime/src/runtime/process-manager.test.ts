import assert from "node:assert/strict";
import test from "node:test";

import { ProcessManager } from "./process-manager.js";

test("released process ids may be reused but stale entry identities cannot address the replacement", () => {
  const manager = new ProcessManager<{ terminate(): void }>();
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
  const manager = new ProcessManager<{ terminate(): void }>();
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
  const manager = new ProcessManager<{ terminate(): void }>();
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
