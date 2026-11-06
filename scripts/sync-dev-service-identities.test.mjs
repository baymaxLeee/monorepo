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
  for (const service of ["admin", "canvas", "chat", "executor", "knowledge", "storage", "sandbox"]) {
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

const knowledgeMap = JSON.stringify({ chat: "dev-chat-internal-token", executor: "dev-executor-internal-token" });

test("fresh install examples pass service identity validation", (t) => {
  const { run } = fixture(t);
  const check = run();
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const result = run("--fix");
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("fix preserves valid default files and is idempotent", (t) => {
  const { env, run } = fixture(t);
  const before = readFileSync(env("knowledge"), "utf8");
  assert.equal(run("--fix").status, 0);
  assert.equal(run("--fix").status, 0);
  assert.equal(readFileSync(env("knowledge"), "utf8"), before);
});

for (const [name, map] of [
  ["custom credentials", JSON.stringify({ chat: "custom-chat", executor: "dev-executor-internal-token" })],
  ["invalid JSON", "invalid"],
  ["an undeclared Canvas caller", JSON.stringify({ canvas: "dev-canvas-internal-token", ...JSON.parse(knowledgeMap) })],
  ["an explicit empty map", "{}"],
]) {
  test(`fix preserves and rejects ${name}`, (t) => {
    const { env, set, run } = fixture(t);
    set("knowledge", "INTERNAL_SERVICE_TOKENS", map);
    const before = readFileSync(env("knowledge"), "utf8");
    assert.notEqual(run("--fix").status, 0);
    assert.equal(readFileSync(env("knowledge"), "utf8"), before);
  });
}

test("fix preserves a mismatched map when caller credentials were customized", (t) => {
  const { env, set, run } = fixture(t);
  set("knowledge", "INTERNAL_SERVICE_TOKENS", knowledgeMap);
  set("chat", "INTERNAL_API_TOKEN", "custom-chat");
  const before = readFileSync(env("knowledge"), "utf8");
  assert.notEqual(run("--fix").status, 0);
  assert.equal(readFileSync(env("knowledge"), "utf8"), before);
});

test("fix leaves non-development receiver files untouched", (t) => {
  const { env, set, run } = fixture(t);
  set("storage", "ENVIRONMENT", "production");
  set("storage", "INTERNAL_SERVICE_TOKENS", "{}");
  const before = readFileSync(env("storage"), "utf8");
  const result = run("--fix");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(env("storage"), "utf8"), before);
});
