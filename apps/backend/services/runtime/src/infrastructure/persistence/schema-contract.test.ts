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

  assert.match(sql, /CREATE UNIQUE INDEX ux_turns_one_active\s+ON public\.turns \(thread_id\)/);
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
