import assert from "node:assert/strict";
import test from "node:test";

import { contextCompactionThreshold, shouldResetStoredResponseLineage } from "./budget.js";

const limits = { contextWindow: 128_000, maxOutputTokens: 8_000 };

void test("reserves output and harness headroom before triggering context compaction", () => {
  assert.equal(contextCompactionThreshold(limits), 89_600);
});

void test("resets a stored response lineage at the compaction watermark", () => {
  assert.equal(shouldResetStoredResponseLineage(null, limits), true);
  assert.equal(shouldResetStoredResponseLineage(undefined, limits), true);
  assert.equal(shouldResetStoredResponseLineage(89_599, limits), false);
  assert.equal(shouldResetStoredResponseLineage(89_600, limits), true);
});
