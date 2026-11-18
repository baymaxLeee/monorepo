import assert from "node:assert/strict";
import test from "node:test";

import { parseAgainst, unexpectedDiagnostics } from "./check-protobuf-breaking.mjs";

const entry = {
  baselinePath: "admin/v1/admin.proto",
  baselineSha256: "expected",
  type: "SERVICE_NO_DELETE",
  message: 'Previously present service "AgentConfigurationService" was deleted from file.',
};

test("parses the repository baseline without losing its subdirectory", () => {
  assert.deepEqual(parseAgainst(".git#ref=base-sha,subdir=schemas/proto"), {
    ref: "base-sha",
    subdir: "schemas/proto",
  });
});

test("accepts only an exact deletion from the expected baseline content", () => {
  const diagnostic = {
    path: "schemas/proto/admin/v1/admin.proto",
    type: entry.type,
    message: entry.message,
  };
  assert.deepEqual(unexpectedDiagnostics([diagnostic], [entry], new Map([[entry.baselinePath, "expected"]])), []);
  assert.deepEqual(
    unexpectedDiagnostics(
      [{ ...diagnostic, message: "another deletion" }],
      [entry],
      new Map([[entry.baselinePath, "expected"]]),
    ),
    [{ ...diagnostic, message: "another deletion" }],
  );
  assert.deepEqual(unexpectedDiagnostics([diagnostic], [entry], new Map([[entry.baselinePath, "changed"]])), [
    diagnostic,
  ]);
});
