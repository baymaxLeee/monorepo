import assert from "node:assert/strict";
import test from "node:test";

import { clampArkDuration } from "./limits.js";

test("provider durations stay within supported bounds, including malformed inputs", () => {
  for (const [input, expected] of [
    [undefined, 12],
    [NaN, 12],
    [Infinity, 12],
    [-1, 4],
    [4.4, 4],
    [14.8, 15],
    [100, 15],
  ] as const) {
    assert.equal(clampArkDuration(input), expected, `duration ${input}`);
  }
});
