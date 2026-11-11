import assert from "node:assert/strict";
import test from "node:test";

import { updateConversationFileContent } from "./conversations.js";
import { AppError } from "./errors.js";
import { assertEditableFileSize, editableFileByteLimit } from "./file-edit-limits.js";

test("text editing enforces UTF-8 bytes before persistence or upload", async (t) => {
  const previous = process.env.CHAT_EDITABLE_FILE_MAX_BYTES;
  t.after(() => {
    if (previous === undefined) delete process.env.CHAT_EDITABLE_FILE_MAX_BYTES;
    else process.env.CHAT_EDITABLE_FILE_MAX_BYTES = previous;
  });
  process.env.CHAT_EDITABLE_FILE_MAX_BYTES = "4";
  assert.equal(editableFileByteLimit(), 4);
  assert.doesNotThrow(() => assertEditableFileSize(4));
  await assert.rejects(
    updateConversationFileContent(
      { userId: "user", tenantId: "tenant", workspaceId: "workspace" },
      "conversation",
      "file",
      {
        content: "中文",
        expectedEtag: '"etag"',
        operationId: "operation",
      },
    ),
    (error: unknown) => error instanceof AppError && error.code === "file_too_large",
  );
  process.env.CHAT_EDITABLE_FILE_MAX_BYTES = "NaN";
  assert.throws(editableFileByteLimit, /positive safe byte limit/);
});
