import assert from "node:assert/strict";
import test from "node:test";

import { internalAuthMiddleware } from "./worker-auth.js";

function context(caller: string, token: string) {
  return {
    req: { header: (name: string) => ({ "X-Caller-Service": caller, "X-Internal-Token": token })[name] },
    set() {},
  } as never;
}

test("Runtime worker accepts only the Runtime server workload identity", async () => {
  let called = false;
  await internalAuthMiddleware(context("runtime", "dev-runtime-internal-token"), async () => {
    called = true;
  });
  assert.equal(called, true);
  await assert.rejects(internalAuthMiddleware(context("chat", "dev-runtime-internal-token"), async () => {}));
});
