import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { affectedSelections, changedFiles } from "./test-affected.mjs";

const root = "/repo";
const targets = [
  { id: "frontend/chat", dir: "/repo/apps/frontend/apps/chat" },
  { id: "frontend/admin", dir: "/repo/apps/frontend/apps/admin" },
  { id: "backend/chat", dir: "/repo/apps/backend/services/chat" },
  { id: "backend/admin", dir: "/repo/apps/backend/services/admin" },
  { id: "tooling", dir: root },
];

test("isolates app changes and keeps same-named frontend and backend targets distinct", () => {
  const files = ["apps/frontend/apps/chat/src/App.tsx", "apps/backend/services/admin/src/route.py"];
  assert.deepEqual(affectedSelections(files, targets, root), ["backend/admin", "frontend/chat"]);
  assert.deepEqual(affectedSelections(files, targets, root, "frontend"), ["frontend/chat"]);
  assert.deepEqual(affectedSelections(files, targets, root, "tooling"), []);
});

test("shared libraries expand to their stack and subsume individual consumers", () => {
  assert.deepEqual(
    affectedSelections(
      ["apps/frontend/packages/shared/src/id.ts", "apps/frontend/apps/chat/src/App.tsx"],
      targets,
      root,
    ),
    ["frontend"],
  );
  assert.deepEqual(affectedSelections(["apps/backend/libs/kernel/src/kernel/errors.py"], targets, root), ["backend"]);
});

test("global configuration and missing diff bases conservatively select all scopes", () => {
  for (const files of [
    null,
    ["scripts/test.mjs"],
    ["schemas/openapi/chat.json"],
    [".github/workflows/build-images.yml"],
  ]) {
    assert.deepEqual(affectedSelections(files, targets, root), ["backend", "frontend", "tooling"]);
  }
  assert.deepEqual(affectedSelections(["apps/backend/services/deleted/src/old.py"], targets, root), ["backend"]);
  assert.throws(() => affectedSelections([], targets, root, "typo"), /Unknown test scope/);
});

test("documentation-only changes select no tests", () => {
  assert.deepEqual(
    affectedSelections(["AGENTS.md", "docs/plan.md", "apps/frontend/apps/chat/README.md"], targets, root),
    [],
  );
});

test("runtime Markdown and renamed files remain in the affected scope", () => {
  assert.deepEqual(affectedSelections(["apps/backend/services/chat/src/prompts/system.md"], targets, root), [
    "backend/chat",
  ]);
  assert.deepEqual(
    affectedSelections(["apps/frontend/apps/chat/src/old.ts", "apps/frontend/apps/admin/src/new.ts"], targets, root),
    ["frontend/admin", "frontend/chat"],
  );
});

test("diff includes deleted paths, staged edits, unstaged edits and untracked files", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "test-affected-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "-q");
  mkdirSync(join(repo, "src"));
  for (const file of ["removed.ts", "staged.ts", "unstaged.ts"]) writeFileSync(join(repo, "src", file), "old");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "base",
  );
  rmSync(join(repo, "src/removed.ts"));
  writeFileSync(join(repo, "src/staged.ts"), "new");
  git("add", "src/staged.ts");
  writeFileSync(join(repo, "src/unstaged.ts"), "new");
  writeFileSync(join(repo, "src/untracked file.ts"), "new");
  assert.deepEqual(changedFiles(repo, "HEAD").sort(), [
    "src/removed.ts",
    "src/staged.ts",
    "src/unstaged.ts",
    "src/untracked file.ts",
  ]);
  assert.equal(changedFiles(repo, "missing-ref"), null);
});
