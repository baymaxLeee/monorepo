import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { discoverTargets, selectTargets, commandFor, runTargets, runSelections } from "./test.mjs";

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

test("batches only selected frontend projects and reports missing suites", (t) => {
  t.mock.method(console, "log", () => {});
  const errors = t.mock.method(console, "error", () => {});
  const targets = ["one", "two", "empty"].map((name) => ({
    id: `frontend/${name}`,
    packageName: name,
    runtime: "frontend",
    dir: `/repo/apps/frontend/apps/${name}`,
    files: name === "empty" ? [] : ["src/app.test.ts"],
  }));
  const calls = [];
  const status = runTargets(targets, "/repo", [], (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return { status: 0 };
  });
  assert.equal(status, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["test", "--project", "one", "--project", "two"]);
  assert.equal(calls[0].options.cwd, "/repo/apps/frontend");
  assert.match(errors.mock.calls[0].arguments[0], /empty: no test files/);
});

test("overlapping selections run once and a failed grouped frontend runner propagates", (t) => {
  t.mock.method(console, "log", () => {});
  const targets = ["one", "two"].map((name) => ({
    id: `frontend/${name}`,
    packageName: name,
    runtime: "frontend",
    dir: `/repo/${name}`,
    files: ["src/test.ts"],
  }));
  const calls = [];
  const result = runSelections(["frontend", "frontend/one"], "/repo", [], targets, (command, args) => {
    calls.push({ command, args });
    return { status: 9 };
  });
  assert.equal(result, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["test", "--project", "one", "--project", "two"]);
});

test("aggregate frontend reports empty projects but cannot pass an entirely empty stack", (t) => {
  t.mock.method(console, "log", () => {});
  const errors = t.mock.method(console, "error", () => {});
  const empty = { id: "frontend/empty", runtime: "frontend", files: [] };
  const tested = { id: "frontend/tested", runtime: "frontend", packageName: "tested", files: ["src/test.ts"] };
  const success = () => ({ status: 0 });
  assert.equal(runSelections(["frontend"], "/repo", [], [empty, tested], success), 0);
  assert.match(errors.mock.calls[0].arguments[0], /^UNTESTED/);
  assert.equal(runSelections(["frontend"], "/repo", [], [empty], success), 1);
  assert.equal(runSelections(["frontend/empty"], "/repo", [], [empty], success), 1);
});
