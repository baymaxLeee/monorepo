import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

import { buildShared } from "../config/mf-shared.mjs";
import { frontendRoot } from "../config/rspack.mjs";

test("build resources retain the frontend root after package consolidation", () => {
  const expected = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  assert.equal(frontendRoot, expected);
});

test("module federation consumers still share the runtime package root", () => {
  assert.deepEqual(buildShared("host")["@repo/shared"], {
    singleton: true,
    requiredVersion: false,
  });
  assert.equal(buildShared("remote")["@repo/shared"].import, false);
});
