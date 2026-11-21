import assert from "node:assert/strict";
import test from "node:test";

import { selectFileLines } from "../read-file.js";
import { applyPatchToText } from "./file-update.js";
import { parseApplyPatch } from "./parser.js";

test("read_file bounds context by complete lines and returns an actionable continuation", () => {
  const content = `${Array.from({ length: 2_005 }, (_, index) => `line ${index + 1}`).join("\n")}\n`;
  const selected = selectFileLines(content, { offset: 2, limit: 2_000, maxBytes: 50 * 1024 });
  assert.equal(selected.startLine, 2);
  assert.equal(selected.endLine, 2_001);
  assert.equal(selected.totalLines, 2_006);
  assert.equal(selected.truncated, true);
  assert.equal(selected.nextOffset, 2_002);
  assert.match(selected.content, /^line 2\n/);
  assert.match(selected.content, /line 2001$/);
});

test("apply_patch parses every source and move destination before execution", () => {
  const patch = parseApplyPatch(
    "*** Begin Patch\n*** Add File: src/new.ts\n+new\n*** Update File: src/old.ts\n*** Move to: src/moved.ts\n@@\n-old\n+updated\n*** Delete File: src/dead.ts\n*** End Patch",
  );
  assert.deepEqual(
    patch.actions.map((action) =>
      action.type === "update" ? [action.type, action.path, action.moveTo] : [action.type, action.path],
    ),
    [
      ["add", "src/new.ts"],
      ["update", "src/old.ts", "src/moved.ts"],
      ["delete", "src/dead.ts"],
    ],
  );
  assert.deepEqual(patch.paths, ["src/new.ts", "src/old.ts", "src/moved.ts", "src/dead.ts"]);
});

test("apply_patch preserves a UTF-8 BOM and CRLF while applying contextual hunks", () => {
  const original = "\uFEFFfirst\r\nsecond\r\nthird\r\n";
  const action = parseApplyPatch(
    "*** Begin Patch\n*** Update File: file.txt\n@@\n first\n-second\n+changed\n third\n*** End Patch",
  ).actions[0];
  if (action?.type !== "update") throw new Error("expected update action");
  assert.equal(applyPatchToText(original, action), "\uFEFFfirst\r\nchanged\r\nthird\r\n");
});

test("apply_patch uses the first matching sequence unless a chunk is anchored at EOF", () => {
  const action = parseApplyPatch("*** Begin Patch\n*** Update File: file.txt\n@@\n-repeat\n+changed\n*** End Patch")
    .actions[0];
  if (action?.type !== "update") throw new Error("expected update action");
  assert.equal(applyPatchToText("repeat\nkeep\nrepeat\n", action), "changed\nkeep\nrepeat\n");
  const last = parseApplyPatch(
    "*** Begin Patch\n*** Update File: file.txt\n-repeat\n+changed\n*** End of File\n*** End Patch",
  ).actions[0];
  if (last?.type !== "update") throw new Error("expected update action");
  assert.equal(applyPatchToText("repeat\nkeep\nrepeat\n", last), "repeat\nkeep\nchanged\n");
  assert.throws(() => applyPatchToText("repeat\nkeep\n", last), /not found/);
});

test("apply_patch uses change context to select the intended repeated body", () => {
  const action = parseApplyPatch(
    "*** Begin Patch\n*** Update File: file.ts\n@@ function second() {\n-  return shared;\n+  return changed;\n*** End Patch",
  ).actions[0];
  if (action?.type !== "update") throw new Error("expected update action");

  assert.equal(
    applyPatchToText("function first() {\n  return shared;\n}\n\nfunction second() {\n  return shared;\n}\n", action),
    "function first() {\n  return shared;\n}\n\nfunction second() {\n  return changed;\n}\n",
  );
});

test("apply_patch appends an add-only hunk to EOF after locating its change context", () => {
  const action = parseApplyPatch(
    "*** Begin Patch\n*** Update File: file.ts\n@@ function second() {\n+  initialize();\n*** End Patch",
  ).actions[0];
  if (action?.type !== "update") throw new Error("expected update action");

  assert.equal(
    applyPatchToText("function first() {\n}\n\nfunction second() {\n}\n", action),
    "function first() {\n}\n\nfunction second() {\n}\n  initialize();\n",
  );
});

test("apply_patch fuzzy context matching preserves untouched indentation", () => {
  const action = parseApplyPatch(
    "*** Begin Patch\n*** Update File: file.yaml\n@@\n root:\n   keep: yes\n-   old: yes\n+   new: yes\n*** End Patch",
  ).actions[0];
  if (action?.type !== "update") throw new Error("expected update action");

  assert.equal(applyPatchToText("root:\n    keep: yes\n    old: yes\n", action), "root:\n    keep: yes\n   new: yes\n");
});

test("apply_patch preserves untouched line terminators in mixed-ending files", () => {
  const action = parseApplyPatch(
    "*** Begin Patch\n*** Update File: file.txt\n@@\n first\n-second\n+changed\n third\n*** End Patch",
  ).actions[0];
  if (action?.type !== "update") throw new Error("expected update action");

  assert.equal(applyPatchToText("first\r\nsecond\nthird\r\nfourth\n", action), "first\r\nchanged\r\nthird\r\nfourth\n");
});

test("repeated operations preserve hunk order and share one admission path", () => {
  const patch = parseApplyPatch("*** Begin Patch\n*** Delete File: old\n*** Add File: old\n+new\n*** End Patch");
  assert.deepEqual(patch.paths, ["old"]);
  assert.deepEqual(
    patch.actions.map((action) => action.type),
    ["delete", "add"],
  );
});
test("the terminating empty context line can match the final newline", () => {
  const patch = parseApplyPatch("*** Begin Patch\n*** Update File: f\n-old\n+new\n \n*** End of File\n*** End Patch");
  const action = patch.actions[0];
  assert.ok(action?.type === "update");
  assert.equal(applyPatchToText("old\n", action), "new\n");
});
