import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "./errors.js";
import { assertEditableFileSize, editableFileByteLimit } from "./file-edit-limits.js";
import { updateSessionFileContent } from "./sessions.js";

test("text editing enforces UTF-8 bytes before persistence or upload", async (t) => {
  const previous = process.env.RUNTIME_EDITABLE_FILE_MAX_BYTES;
  t.after(() => {
    if (previous === undefined) delete process.env.RUNTIME_EDITABLE_FILE_MAX_BYTES;
    else process.env.RUNTIME_EDITABLE_FILE_MAX_BYTES = previous;
  });
  process.env.RUNTIME_EDITABLE_FILE_MAX_BYTES = "4";
  assert.equal(editableFileByteLimit(), 4);
  assert.doesNotThrow(() => assertEditableFileSize(4));
  await assert.rejects(
    updateSessionFileContent("session", "file", {
      content: "中文",
      expectedEtag: '"etag"',
      operationId: "operation",
    }),
    (error: unknown) => error instanceof AppError && error.code === "file_too_large",
  );
  process.env.RUNTIME_EDITABLE_FILE_MAX_BYTES = "NaN";
  assert.throws(editableFileByteLimit, /positive safe byte limit/);
});
