import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { discoverTargets, selectTargets, commandFor, runTargets } from "./test.mjs";

test("discovers newly added services and colocated Python tests without a service allowlist", (t) => {
  const root = mkdtempSync(join(tmpdir(), "monorepo-tests-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "apps/backend/services/new-service");
  mkdirSync(join(dir, "src/domain"), { recursive: true });
  writeFileSync(join(dir, "pyproject.toml"), '[project]\nname="new-service"\n');
  writeFileSync(join(dir, "src/domain/test_policy.py"), "");
  const targets = discoverTargets(root);
  assert.equal(targets[0].id, "backend/new-service");
  assert.equal(targets[0].files.length, 1);
  assert.equal(commandFor(targets[0], root, ["-k", "policy"])[0], "uv");
});

test("rejects unknown targets and keeps backend/frontend names distinct", () => {
  const targets = [{ id: "backend/chat" }, { id: "frontend/chat" }];
  assert.deepEqual(selectTargets(targets, "backend"), [targets[0]]);
  assert.deepEqual(selectTargets(targets, "frontend/chat"), [targets[1]]);
  assert.throws(() => selectTargets(targets, "chat"), /Unknown test target/);
});

test("fails empty targets before invoking a runner", (t) => {
  const errors = t.mock.method(console, "error", () => {});
  let called = false;
  const status = runTargets([{ id: "backend/empty", files: [] }], "/", [], () => {
    called = true;
    return { status: 0 };
  });
  assert.equal(status, 1);
  assert.equal(called, false);
  assert.match(errors.mock.calls[0].arguments[0], /no test files found/);
});

test("preserves argument boundaries and propagates runner failures", (t) => {
  t.mock.method(console, "log", () => {});
  const target = { id: "backend/chat", runtime: "node", dir: "/repo/chat", files: ["src/run.test.ts"] };
  const status = runTargets([target], "/repo", ["--test-name-pattern=a b"], (_cmd, args, options) => {
    assert.deepEqual(args, ["test", "--test-name-pattern=a b"]);
    assert.equal(options.cwd, "/repo/chat");
    return { status: 7 };
  });
  assert.equal(status, 1);
});
