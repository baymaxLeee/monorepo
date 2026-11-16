import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { AuthContext } from "../../api/http/middleware/auth.js";
import { getSql } from "../../infrastructure/persistence/index.js";
import { reserveInference } from "./admission.js";

const url = process.env.LOCAL_INFERENCE_TEST_URL;
if (!url) throw new Error("LOCAL_INFERENCE_TEST_URL must point to an isolated migrated database");
const connection = new URL(url);
Object.assign(process.env, {
  ENVIRONMENT: "development",
  POSTGRES_HOST: connection.hostname,
  POSTGRES_PORT: connection.port,
  POSTGRES_USER: decodeURIComponent(connection.username),
  POSTGRES_PASSWORD: decodeURIComponent(connection.password),
  POSTGRES_DATABASE: connection.pathname.slice(1),
});
const auth: AuthContext = {
  userId: "local-user",
  tenantId: "tenant",
  workspaceId: "workspace",
  workspaceRole: "member",
  username: "test",
  email: "",
  roles: [],
};

test("default local inference admits without a separate quota, serializes concurrency and records usage", async (t) => {
  t.after(async () => getSql().end());
  const ids = [randomUUID(), randomUUID()];
  const results = await Promise.allSettled(ids.map((id) => reserveInference(auth, id, "model", 700)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const winner = results.findIndex((result) => result.status === "fulfilled");
  const accepted = results[winner];
  if (accepted?.status !== "fulfilled") throw new Error("missing accepted request");
  await accepted.value.settle(100);
  await accepted.value.settle(5);
  const [budget] = await getSql()`SELECT used_tokens FROM local_inference_budgets WHERE user_id=${auth.userId}`;
  assert.equal(Number(budget?.used_tokens), 100);
  await assert.rejects(reserveInference(auth, ids[winner]!, "model", 700), /already admitted/);
  const second = await reserveInference(auth, randomUUID(), "model", 700);
  await second.settle(null);
  const continued = await reserveInference(auth, randomUUID(), "model", 2_000_000);
  await continued.settle(25);
  const isolated = await reserveInference({ ...auth, workspaceId: "other" }, randomUUID(), "model", 700);
  await isolated.settle(20);
  const crashId = randomUUID();
  await reserveInference({ ...auth, userId: "crashed" }, crashId, "model", 700);
  await getSql()`UPDATE local_inference_requests SET deadline=now()-interval '1 minute' WHERE id=${crashId}`;
  const next = await reserveInference({ ...auth, userId: "crashed" }, randomUUID(), "model", 200);
  await next.settle(100);
  const [crashBudget] = await getSql()`SELECT used_tokens FROM local_inference_budgets WHERE user_id='crashed'`;
  assert.equal(Number(crashBudget?.used_tokens), 800);
});
