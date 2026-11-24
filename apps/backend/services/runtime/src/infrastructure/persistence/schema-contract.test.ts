import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const baselineUrl = new URL("../../../migrations/v1.0.0/v1.0.0.0.up.sql", import.meta.url);
const protocolUrls = ["runtime-server", "runtime-worker", "runtime-sandbox"].map(
  (name) => new URL(`../../../../../../../schemas/openapi/${name}.json`, import.meta.url),
);

test("Runtime baseline is tenant-neutral and media tools use only generic internal tasks", async () => {
  const sql = await readFile(baselineUrl, "utf8");

  for (const forbidden of [
    "tenant_id",
    "workspace_id",
    "user_id",
    "video_productions",
    "production_events",
    "production_artifacts",
    "production_decisions",
    "production_cost_entries",
  ]) {
    assert.equal(sql.includes(forbidden), false, `${forbidden} must not be persisted by Runtime`);
  }

  assert.match(sql, /CREATE TABLE public\.thread_turns\s*\(/);
  assert.doesNotMatch(sql, /CREATE TABLE public\.turns\s*\(/);
  assert.match(sql, /CREATE UNIQUE INDEX ux_thread_turns_one_active\s+ON public\.thread_turns \(thread_id\)/);
  assert.deepEqual(
    [...sql.matchAll(/CREATE TABLE public\.([a-z_]+)/g)].map((match) => match[1]),
    [
      "threads",
      "thread_turns",
      "thread_items",
      "context_checkpoints",
      "thread_files",
      "thread_file_save_operations",
      "turn_plugin_snapshots",
      "turn_attempts",
      "turn_resume_envelopes",
      "turn_inputs",
      "turn_leases",
      "turn_steps",
      "tool_effects",
      "turn_sandbox_executions",
      "sandbox_workspace_checkout",
      "asset_claim_intents",
      "thread_artifact_cleanup_outbox",
      "tasks",
    ],
  );
  assert.match(sql, /WHERE status IN \('running', 'cancel_requested', 'waiting'\)/);
  assert.match(sql, /CREATE TABLE public\.tasks/);
  assert.match(sql, /CONSTRAINT ux_tasks_owner UNIQUE \(owner_service, owner_ref\)/);
  assert.doesNotMatch(sql, /extension_state|task_items/);
});

test("Runtime wire protocols contain no product identity scope", async () => {
  for (const url of protocolUrls) {
    const protocol = await readFile(url, "utf8");
    for (const forbidden of ["tenant_id", "workspace_id", "user_id", "tenantId", "workspaceId", "userId"]) {
      assert.equal(protocol.includes(forbidden), false, `${forbidden} must not appear in ${url.pathname}`);
    }
  }
});
