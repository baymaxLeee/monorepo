import assert from "node:assert/strict";
import test from "node:test";

import { ConflictError } from "../../errors.js";
import {
  assertContextGeneration,
  type ContextProjectionBinding,
  type ExpectedContextGeneration,
} from "./model-context.js";

const binding: ContextProjectionBinding = {
  historyRevision: 7,
  historyDigest: "history",
  instructionDigest: "instructions",
  toolCatalogDigest: "tools",
  workspaceDigest: "workspace",
  compactorVersion: "runtime-context-projection-v1",
  remoteBinding: "remote",
};

const expected: ExpectedContextGeneration = {
  instructionDigest: binding.instructionDigest,
  toolCatalogDigest: binding.toolCatalogDigest,
  workspaceDigest: binding.workspaceDigest,
  compactorVersion: binding.compactorVersion,
  remoteBinding: binding.remoteBinding,
};

test("recovery context accepts only the exact non-secret generation", () => {
  assert.doesNotThrow(() => assertContextGeneration(binding, expected));
  assert.doesNotThrow(() => assertContextGeneration(binding, undefined));

  for (const [field, value] of [
    ["instructionDigest", "changed-instructions"],
    ["toolCatalogDigest", "changed-tools"],
    ["workspaceDigest", "changed-workspace"],
    ["compactorVersion", "changed-compactor"],
    ["remoteBinding", "changed-remote"],
  ] as const) {
    assert.throws(
      () => assertContextGeneration(binding, { ...expected, [field]: value }),
      (error: unknown) => error instanceof ConflictError && error.code === "resume_generation_conflict",
      `${field} drift must fail before context projection resumes`,
    );
  }
});
