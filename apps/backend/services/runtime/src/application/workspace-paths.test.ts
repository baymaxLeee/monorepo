import assert from "node:assert/strict";
import test from "node:test";

import { allocateLegacyWorkspacePaths, isValidWorkspacePath, type LegacyWorkspaceFile } from "./workspace-paths.js";

const at = new Date("2026-01-01T00:00:00.000Z");

function file(id: string, filename: string, offset = 0): LegacyWorkspaceFile {
  return { id, filename, createdAt: new Date(at.getTime() + offset) };
}

test("legacy workspace paths normalize unique names without changing file identity", () => {
  assert.deepEqual(allocateLegacyWorkspacePaths([file("a", "cafe\u0301.md")]), [
    { id: "a", workspacePath: "/workspace/café.md" },
  ]);
});

test("normalization collisions suffix every member and preserve natural names", () => {
  const allocated = allocateLegacyWorkspacePaths([
    file("01ab23cd-one", "demo.js"),
    file("01ab23cd-two", "demo.js", 1),
    file("natural", "demo~01ab23cd.js", 2),
  ]);
  assert.deepEqual(allocated, [
    { id: "01ab23cd-one", workspacePath: "/workspace/demo~01ab23cd-.js" },
    { id: "01ab23cd-two", workspacePath: "/workspace/demo~01ab23cd-t.js" },
    { id: "natural", workspacePath: "/workspace/demo~01ab23cd.js" },
  ]);
});

test("a reserved full token uses a stable counter without taking the natural path", () => {
  assert.deepEqual(
    allocateLegacyWorkspacePaths([
      file("alpha", "demo.js"),
      file("beta", "demo.js", 1),
      file("natural", "demo~alpha.js", 2),
    ]),
    [
      { id: "alpha", workspacePath: "/workspace/demo~alpha~1.js" },
      { id: "beta", workspacePath: "/workspace/demo~beta.js" },
      { id: "natural", workspacePath: "/workspace/demo~alpha.js" },
    ],
  );
});

test("unsafe names use deterministic id tokens and non-ASCII ids use UTF-8 hex", () => {
  assert.deepEqual(allocateLegacyWorkspacePaths([file("safe_id", "../secret"), file("文件", "bad/name", 1)]), [
    { id: "safe_id", workspacePath: "/workspace/file~safe_id" },
    { id: "文件", workspacePath: "/workspace/file~e69687e4bbb6" },
  ]);
});

test("overlong components fall back safely and every result satisfies the path contract", () => {
  const allocated = allocateLegacyWorkspacePaths([
    file("first", `${"界".repeat(100)}.txt`),
    file("second", `${"a".repeat(250)}.extension`, 1),
  ]);
  assert.equal(allocated.length, 2);
  assert.ok(allocated.every(({ workspacePath }) => isValidWorkspacePath(workspacePath)));
  assert.ok(allocated.every(({ workspacePath }) => Buffer.byteLength(workspacePath.split("/").at(-1)!, "utf8") <= 255));
});

test("allocation order is deterministic by created time and UTF-8 id bytes", () => {
  const input = [file("b", "same.txt"), file("a", "same.txt")];
  assert.deepEqual(allocateLegacyWorkspacePaths(input), allocateLegacyWorkspacePaths([...input].reverse()));
  assert.deepEqual(
    allocateLegacyWorkspacePaths(input).map(({ id }) => id),
    ["a", "b"],
  );
});
