import assert from "node:assert/strict";
import test from "node:test";

import { contextCompactionThreshold, recentContextTailBudget, shouldResetStoredResponseLineage } from "./budget.js";

const limits = { contextWindow: 128_000, maxOutputTokens: 8_000 };

test("reserves model output and measured harness headroom before compaction", () => {
  assert.equal(contextCompactionThreshold(limits), 112_000);
  assert.equal(recentContextTailBudget(limits), 106_000);
});

test("stored response lineage is discarded at or above the context watermark", () => {
  assert.equal(shouldResetStoredResponseLineage(null, limits), true);
  assert.equal(shouldResetStoredResponseLineage(111_999, limits), false);
  assert.equal(shouldResetStoredResponseLineage(112_000, limits), true);
});

test("model-specific watermarks are capped by the Codex model limit", () => {
  assert.equal(contextCompactionThreshold({ contextWindow: 500_000, maxOutputTokens: 4_000 }), 450_000);
  assert.equal(contextCompactionThreshold({ ...limits, autoCompactTokenLimit: 90_000 }), 90_000);
});
