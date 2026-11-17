import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import { propagationHeaders, runWithContext } from "./trace.js";

test("concurrent request contexts do not leak tenant or trace headers", async () => {
  await Promise.all(
    ["tenant-a", "tenant-b"].map((tenantId) =>
      runWithContext({ tenantId, traceId: `trace-${tenantId}` }, async () => {
        await setImmediate();
        assert.deepEqual(propagationHeaders(), { "X-Tenant-Id": tenantId, "X-Trace-Id": `trace-${tenantId}` });
      }),
    ),
  );
  assert.deepEqual(propagationHeaders(), {});
});
