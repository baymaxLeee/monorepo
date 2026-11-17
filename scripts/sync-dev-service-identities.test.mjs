import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "service-identities-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  cpSync(resolve("scripts/sync-dev-service-identities.py"), join(root, "scripts/sync-dev-service-identities.py"));
  for (const service of ["chat", "runtime"]) {
    const dir = join(root, "apps/backend/services", service);
    mkdirSync(dir, { recursive: true });
    cpSync(resolve("apps/backend/services", service, ".env.example"), join(dir, ".env"));
  }
  const env = (service) => join(root, "apps/backend/services", service, ".env");
  const set = (service, key, value) => {
    const path = env(service);
    const lines = readFileSync(path, "utf8").split("\n");
    writeFileSync(path, lines.map((line) => (line.startsWith(`${key}=`) ? `${key}=${value}` : line)).join("\n"));
  };
  const run = (...args) =>
    spawnSync("python3", [join(root, "scripts/sync-dev-service-identities.py"), ...args], { encoding: "utf8" });
  return { env, set, run };
}

test("the remaining HTTP streaming identity passes validation", (t) => {
  const { run } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("custom Chat credential must match Runtime's inbound map", (t) => {
  const { env, set, run } = fixture(t);
  set("chat", "INTERNAL_API_TOKEN", "custom-chat-token");
  const before = readFileSync(env("runtime"), "utf8");
  assert.notEqual(run().status, 0);
  assert.equal(readFileSync(env("runtime"), "utf8"), before);
});

for (const role of ["worker", "sandbox"]) {
  test(`Runtime ${role} accepts only the Runtime role credential`, (t) => {
    const { env, run } = fixture(t);
    const path = `${env("runtime")}.${role}`;
    writeFileSync(path, 'ENVIRONMENT=development\nINTERNAL_SERVICE_TOKENS={"chat":"dev-chat-internal-token"}\n');
    assert.notEqual(run().status, 0);
    writeFileSync(path, 'ENVIRONMENT=development\nINTERNAL_SERVICE_TOKENS={"runtime":"dev-runtime-internal-token"}\n');
    assert.equal(run().status, 0);
  });
}
