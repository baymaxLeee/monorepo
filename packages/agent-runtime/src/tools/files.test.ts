import assert from "node:assert/strict";
import test from "node:test";

import { applyPatchToText, parseApplyPatch } from "./apply-patch.js";
import { selectFileLines } from "./read-file.js";

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

test("apply_patch rejects ambiguous context instead of guessing", () => {
  const action = parseApplyPatch("*** Begin Patch\n*** Update File: file.txt\n@@\n-repeat\n+changed\n*** End Patch")
    .actions[0];
  if (action?.type !== "update") throw new Error("expected update action");
  assert.throws(() => applyPatchToText("repeat\nkeep\nrepeat\n", action), /matches more than once/);
});
