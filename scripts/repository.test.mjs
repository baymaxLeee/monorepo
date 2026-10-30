import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { contextFor, navigationErrors } from "./repo.mjs";
import { consumersOf, discoverProjects, graphErrors } from "./repository.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "repository-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value = "") => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  return { root, write };
}

test("context returns root-to-leaf instructions for new files and separates same-named stacks", (t) => {
  const { root, write } = fixture(t);
  for (const path of ["AGENTS.md", "apps/backend/AGENTS.md", "apps/backend/services/chat/AGENTS.md"]) write(path);
  write("apps/backend/services/chat/package.json", { name: "chat" });
  write("apps/frontend/apps/chat/package.json", { name: "chat" });
  const context = contextFor(root, "apps/backend/services/chat/src/new/file.ts");
  assert.equal(context.owner, "backend/chat");
  assert.deepEqual(context.instructions, [
    "AGENTS.md",
    "apps/backend/AGENTS.md",
    "apps/backend/services/chat/AGENTS.md",
  ]);
  assert.equal(contextFor(root, "frontend/chat").owner, "frontend/chat");
  assert.throws(() => contextFor(root, "frontend/missing"), /Unknown target/);
  write("apps/backend/AGENTS.override.md");
  assert.equal(contextFor(root, "backend/chat").instructions[1], "apps/backend/AGENTS.override.md");
});

test("context rejects outside paths and symlink escapes without reading their contents", (t) => {
  const { root } = fixture(t);
  assert.throws(() => contextFor(root, "../outside"), /inside the repository/);
  symlinkSync(tmpdir(), join(root, "outside"));
  assert.throws(() => contextFor(root, "outside/new.ts"), /outside the repository/);
});

test("workspace graph includes dev, optional and peer consumers and rejects illegal boundaries", (t) => {
  const { root, write } = fixture(t);
  write("apps/frontend/packages/base/package.json", { name: "@repo/base" });
  write("apps/frontend/packages/feature/package.json", {
    name: "@repo/feature",
    peerDependencies: { "@repo/base": "workspace:*" },
  });
  write("apps/frontend/apps/chat/package.json", { name: "chat", devDependencies: { "@repo/feature": "workspace:*" } });
  write("apps/frontend/apps/admin/package.json", {
    name: "admin",
    optionalDependencies: { "@repo/base": "workspace:*" },
  });
  let projects = discoverProjects(root);
  assert.deepEqual(graphErrors(projects), []);
  assert.deepEqual(consumersOf(projects, ["frontend/@repo/base"]), [
    "frontend/@repo/base",
    "frontend/@repo/feature",
    "frontend/admin",
    "frontend/chat",
  ]);
  write("apps/frontend/packages/base/package.json", {
    name: "@repo/base",
    dependencies: { chat: "workspace:*", missing: "workspace:*" },
  });
  projects = discoverProjects(root);
  const errors = graphErrors(projects).join("\n");
  assert.match(errors, /must not depend on deployable frontend\/chat/);
  assert.match(errors, /unresolved local dependency/);
  assert.match(errors, /Dependency cycle/);
});

test("navigation checks relative links and ignores external URLs and anchors", (t) => {
  const { root, write } = fixture(t);
  write("docs/index.md", "[rule](../AGENTS.md) [web](https://example.com) [section](#here)");
  write("AGENTS.md");
  assert.deepEqual(navigationErrors(root, ["docs/index.md"]), []);
  write("docs/index.md", "[rule](missing.md)");
  assert.match(navigationErrors(root, ["docs/index.md"])[0], /broken link missing.md/);
});

test("public CLI emits parseable JSON and nonzero status for invalid input", () => {
  const result = spawnSync(process.execPath, ["scripts/repo.mjs", "context", "scripts/repo.mjs", "--json"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).instructions.includes("scripts/AGENTS.md"));
  const invalid = spawnSync(process.execPath, ["scripts/repo.mjs", "context", "backend/absent"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
});
