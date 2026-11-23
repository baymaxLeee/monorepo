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

test("accepts an intentional file replacement only for the pinned baseline file", () => {
  const replacement = {
    baselinePath: "storage/v1/storage.proto",
    baselineSha256: "storage-baseline",
    type: "FILE_REPLACEMENT",
    message: "Storage v1 is intentionally replaced as a greenfield contract.",
  };
  const storageDiagnostics = [
    {
      path: "schemas/proto/storage/v1/storage.proto",
      type: "FIELD_NO_DELETE",
      message: "deleted field",
    },
    {
      path: "schemas/proto/storage/v1/storage.proto",
      type: "FIELD_SAME_TYPE",
      message: "changed field type",
    },
  ];
  const otherDiagnostic = {
    path: "schemas/proto/admin/v1/admin.proto",
    type: "FIELD_NO_DELETE",
    message: "unrelated deletion",
  };

  assert.deepEqual(
    unexpectedDiagnostics(
      [...storageDiagnostics, otherDiagnostic],
      [replacement],
      new Map([[replacement.baselinePath, replacement.baselineSha256]]),
    ),
    [otherDiagnostic],
  );
  assert.deepEqual(
    unexpectedDiagnostics(
      storageDiagnostics,
      [replacement],
      new Map([[replacement.baselinePath, "different-baseline"]]),
    ),
    storageDiagnostics,
  );
});
