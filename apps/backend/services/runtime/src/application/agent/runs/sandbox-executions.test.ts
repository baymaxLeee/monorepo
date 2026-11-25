import assert from "node:assert/strict";
import test from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import type { SandboxScope } from "../../../infrastructure/clients/sandbox.js";
import { ConflictError } from "../../errors.js";
import { reconcileSandboxExecutions, sandboxExecutionReconciliationState } from "./sandbox-executions.js";

const first: SandboxScope = {
  session_id: "session",
  run_id: "first",
  attempt_epoch: "1",
  workspace_generation: "1",
};
const second: SandboxScope = { ...first, run_id: "second" };
const emptySummary = {
  manifestSha256: "0".repeat(64),
  files: 0,
  bytes: 0,
  created: 0,
  updated: 0,
  deleted: 0,
};

test("sandbox reconciliation always attempts finalization while a resource identity remains", () => {
  const query = new PgDialect().sqlToQuery(sandboxExecutionReconciliationState);

  assert.match(query.sql, /state.*active.*finalizing.*sandbox_id.*IS NOT NULL.*finalizing.*releasing/);
  assert.doesNotMatch(query.sql, /expires_at/);
  assert.deepEqual(query.params, []);
});

test("sandbox release reconciliation records successful terminal outcomes and retains failed responsibility", async () => {
  const destroyed: string[] = [];
  const released: Array<{ runId: string; outcome: string }> = [];
  const failed: string[] = [];

  await reconcileSandboxExecutions({
    list: async () => [
      { scope: first, sandboxId: "first-sandbox", state: "releasing" },
      { scope: second, sandboxId: "second-sandbox", state: "releasing" },
    ],
    finalize: async () => emptySummary,
    retain: async () => {},
    releasing: async () => {},
    destroy: async (scope) => {
      destroyed.push(scope.run_id);
      if (scope.run_id === second.run_id) throw new Error("runtime unavailable");
    },
    released: async (scope, outcome) => {
      released.push({ runId: scope.run_id, outcome: outcome.outcome });
    },
    failed: async (scope, error) => {
      assert.match(String(error), /runtime unavailable/);
      failed.push(scope.run_id);
    },
  });

  assert.deepEqual(destroyed.sort(), ["first", "second"]);
  assert.deepEqual(released, [{ runId: "first", outcome: "destroyed" }]);
  assert.deepEqual(failed, ["second"]);
});

test("orphaned active executions persist the workspace and retain the reusable guest", async () => {
  const calls: string[] = [];
  const summary = {
    manifestSha256: "a".repeat(64),
    files: 1,
    bytes: 4,
    created: 1,
    updated: 0,
    deleted: 0,
  };
  await reconcileSandboxExecutions({
    list: async () => [{ scope: first, sandboxId: "sandbox", state: "finalizing" }],
    finalize: async (_scope, sandboxId) => {
      assert.equal(sandboxId, "sandbox");
      calls.push("finalize");
      return summary;
    },
    retain: async () => {
      calls.push("retain");
    },
    releasing: async () => {
      calls.push("releasing");
    },
    destroy: async () => assert.fail("successfully finalized workspace stays warm"),
    released: async (_scope, outcome) => {
      assert.deepEqual(outcome, { outcome: "retained", finalization: summary });
      calls.push("released");
    },
    failed: async () => assert.fail("successful recovery must not retain an error"),
  });
  assert.deepEqual(calls, ["finalize", "retain", "released"]);
});

test("failed orphan finalization retains compute and durable responsibility", async () => {
  const calls: string[] = [];
  await reconcileSandboxExecutions({
    list: async () => [{ scope: first, sandboxId: "sandbox", state: "finalizing" }],
    finalize: async () => {
      calls.push("finalize");
      throw new Error("Storage unavailable");
    },
    retain: async () => assert.fail("failed finalization cannot become warm"),
    releasing: async () => {
      calls.push("releasing");
    },
    destroy: async () => {
      calls.push("destroy");
    },
    released: async () => assert.fail("failed finalization must retain recovery responsibility"),
    failed: async (_scope, error) => {
      assert.match(String(error), /Storage unavailable/);
      calls.push("failed");
    },
  });
  assert.deepEqual(calls, ["finalize", "failed"]);
});

test("failed warm detach remains retryable after workspace persistence", async () => {
  const calls: string[] = [];
  await reconcileSandboxExecutions({
    list: async () => [{ scope: first, sandboxId: "sandbox", state: "finalizing" }],
    finalize: async () => {
      calls.push("finalize");
      return emptySummary;
    },
    retain: async () => {
      calls.push("retain");
      throw new Error("detach unavailable");
    },
    releasing: async () => assert.fail("warm detach failure keeps finalization responsibility"),
    destroy: async () => assert.fail("persisted guest is not destroyed on an ambiguous detach"),
    released: async () => assert.fail("detach must complete before the execution is terminal"),
    failed: async (_scope, error) => {
      assert.match(String(error), /detach unavailable/);
      calls.push("failed");
    },
  });
  assert.deepEqual(calls, ["finalize", "retain", "failed"]);
});

test("orphan cleanup releases a sandbox resource that is already gone", async () => {
  const calls: string[] = [];
  await reconcileSandboxExecutions({
    list: async () => [{ scope: first, sandboxId: "sandbox", state: "finalizing" }],
    finalize: async () => {
      calls.push("finalize");
      throw Object.assign(new Error("snapshot failed"), {
        service: "runtime-sandbox",
        status: 404,
        body: { code: "sandbox_not_found", message: "sandbox-first no longer exists" },
      });
    },
    retain: async () => assert.fail("missing resource cannot become warm"),
    releasing: async () => assert.fail("missing finalized resource is already terminal"),
    destroy: async () => assert.fail("missing finalized resource needs no second delete"),
    released: async (_scope, outcome) => {
      assert.equal(outcome.outcome, "resource_missing");
      calls.push("released");
    },
    failed: async () => {
      calls.push("failed");
    },
  });
  assert.deepEqual(calls, ["finalize", "released"]);
});

test("orphan cleanup releases an obsolete writer without retrying its snapshot", async () => {
  const conflict = new ConflictError("superseded", "workspace_writer_superseded");
  const calls: string[] = [];
  await reconcileSandboxExecutions({
    list: async () => [{ scope: first, sandboxId: "sandbox", state: "finalizing" }],
    finalize: async () => {
      throw conflict;
    },
    retain: async () => assert.fail("superseded resource belongs to another attempt"),
    releasing: async () => assert.fail("superseded shared guest must not be released by the old attempt"),
    destroy: async () => assert.fail("superseded shared guest may belong to the new attempt"),
    released: async (_scope, outcome) => {
      assert.equal(outcome.outcome, "superseded");
      calls.push("released");
    },
    failed: async () => {
      calls.push("failed");
    },
  });
  assert.deepEqual(calls, ["released"]);
});
