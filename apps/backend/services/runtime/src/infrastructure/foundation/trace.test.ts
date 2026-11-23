import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import { propagationHeaders, runWithContext } from "./trace.js";

test("concurrent request contexts do not leak trace headers", async () => {
  await Promise.all(
    ["a", "b"].map((suffix) =>
      runWithContext({ traceId: `trace-${suffix}`, traceState: `vendor=${suffix}` }, async () => {
        await setImmediate();
        assert.deepEqual(propagationHeaders(), {
          "X-Trace-Id": `trace-${suffix}`,
          tracestate: `vendor=${suffix}`,
        });
      }),
    ),
  );
  assert.deepEqual(propagationHeaders(), {});
});
