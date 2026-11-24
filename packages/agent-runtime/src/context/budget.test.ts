import assert from "node:assert/strict";
import test from "node:test";

import { resolveContextWindow, shouldResetStoredResponseLineage } from "./budget.js";

const limits = { contextWindow: 128_000, maxOutputTokens: 8_000 };

test("treats the provider context window as input capacity instead of subtracting its output ceiling", () => {
  assert.deepEqual(resolveContextWindow(limits), {
    inputCapacity: 120_000,
    compactAt: 115_200,
    summaryMaxTokens: 5_744,
    recentTailTokens: 109_200,
  });

  const largeOutputModel = { contextWindow: 307_200, maxOutputTokens: 262_144 };
  assert.deepEqual(resolveContextWindow(largeOutputModel), {
    inputCapacity: 299_200,
    compactAt: 276_480,
    summaryMaxTokens: 5_744,
    recentTailTokens: 270_480,
  });
});

test("stored response lineage is discarded at or above the context watermark", () => {
  assert.equal(shouldResetStoredResponseLineage(null, limits), true);
  assert.equal(shouldResetStoredResponseLineage(115_199, limits), false);
  assert.equal(shouldResetStoredResponseLineage(115_200, limits), true);
});

test("model-specific watermarks are capped by the runtime context limit", () => {
  assert.equal(resolveContextWindow({ contextWindow: 500_000, maxOutputTokens: 4_000 }).compactAt, 450_000);
  assert.equal(resolveContextWindow({ ...limits, autoCompactTokenLimit: 90_000 }).compactAt, 90_000);
});
