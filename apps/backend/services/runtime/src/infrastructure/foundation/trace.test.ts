import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import { propagationHeaders, runWithContext } from "./trace.js";

test("concurrent request contexts do not leak trace headers", async () => {
  await Promise.all(
    ["a", "b"].map((suffix, index) => {
      const traceId = String(index + 1).repeat(32);
      const traceParent = `00-${traceId}-${String(index + 3).repeat(16)}-01`;
      return runWithContext({ traceId, traceParent, traceState: `vendor=${suffix}` }, async () => {
        await setImmediate();
        assert.deepEqual(propagationHeaders(), {
          traceparent: traceParent,
          tracestate: `vendor=${suffix}`,
        });
      });
    }),
  );
  assert.deepEqual(propagationHeaders(), {});
});
