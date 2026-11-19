import assert from "node:assert/strict";
import test from "node:test";

import { contextCompactionThreshold, shouldResetStoredResponseLineage } from "./budget.js";

const limits = { contextWindow: 128_000, maxOutputTokens: 8_000 };

test("reserves model output and measured harness headroom before compaction", () => {
  assert.equal(contextCompactionThreshold(limits), 89_600);
});

test("stored response lineage is discarded at or above the context watermark", () => {
  assert.equal(shouldResetStoredResponseLineage(null, limits), true);
  assert.equal(shouldResetStoredResponseLineage(89_599, limits), false);
  assert.equal(shouldResetStoredResponseLineage(89_600, limits), true);
});
