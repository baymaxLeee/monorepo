import assert from "node:assert/strict";
import test from "node:test";

import type { SandboxScope } from "@backend/transport-ts";

import { reconcileSandboxExecutions } from "./sandbox-executions.js";

const first: SandboxScope = {
  tenant_id: "tenant",
  workspace_id: "workspace",
  user_id: "user",
  conversation_id: "conversation",
  run_id: "first",
};
const second: SandboxScope = { ...first, run_id: "second" };

test("sandbox release reconciliation deletes successful rows and retains failed responsibility", async () => {
  const destroyed: string[] = [];
  const released: string[] = [];
  const failed: string[] = [];

  await reconcileSandboxExecutions({
    list: async () => [
      { scope: first, sandboxId: "first-sandbox", state: "releasing" },
      { scope: second, sandboxId: "second-sandbox", state: "releasing" },
    ],
    finalize: async () => {},
    releasing: async () => {},
    destroy: async (scope) => {
      destroyed.push(scope.run_id);
      if (scope.run_id === second.run_id) throw new Error("runtime unavailable");
    },
    released: async (scope) => {
      released.push(scope.run_id);
    },
    failed: async (scope, error) => {
      assert.match(String(error), /runtime unavailable/);
      failed.push(scope.run_id);
    },
  });

  assert.deepEqual(destroyed.sort(), ["first", "second"]);
  assert.deepEqual(released, ["first"]);
  assert.deepEqual(failed, ["second"]);
});

test("orphaned active executions persist the workspace before resource destruction", async () => {
  const calls: string[] = [];
  await reconcileSandboxExecutions({
    list: async () => [{ scope: first, sandboxId: "sandbox", state: "finalizing" }],
    finalize: async (_scope, sandboxId) => {
      assert.equal(sandboxId, "sandbox");
      calls.push("finalize");
    },
    releasing: async () => {
      calls.push("releasing");
    },
    destroy: async () => {
      calls.push("destroy");
    },
    released: async () => {
      calls.push("released");
    },
    failed: async () => assert.fail("successful recovery must not retain an error"),
  });
  assert.deepEqual(calls, ["finalize", "releasing", "destroy", "released"]);
});

test("failed orphan finalization retains compute and durable responsibility", async () => {
  const calls: string[] = [];
  await reconcileSandboxExecutions({
    list: async () => [{ scope: first, sandboxId: "sandbox", state: "finalizing" }],
    finalize: async () => {
      calls.push("finalize");
      throw new Error("Storage unavailable");
    },
    releasing: async () => {
      calls.push("releasing");
    },
    destroy: async () => {
      calls.push("destroy");
    },
    released: async () => {
      calls.push("released");
    },
    failed: async (_scope, error) => {
      assert.match(String(error), /Storage unavailable/);
      calls.push("failed");
    },
  });
  assert.deepEqual(calls, ["finalize", "failed"]);
});
