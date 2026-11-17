import assert from "node:assert/strict";
import test from "node:test";

import { InternalHttpClient } from "./http.js";

test("workload identity cannot be overridden by call or propagation headers", async () => {
  let observed: Request | undefined;
  const client = new InternalHttpClient({
    baseUrl: "http://storage.internal",
    service: "storage",
    callerService: "runtime",
    internalToken: "secret",
    propagatedHeaders: () => ({
      "X-Caller-Service": "forged-propagation",
      "X-Internal-Token": "forged-propagation",
      "X-Trace-Id": "trace-1",
    }),
    fetchImpl: (request, init) => {
      observed = new Request(request, init);
      return Promise.resolve(Response.json({ ok: true }));
    },
  });

  await client.requestJson({
    method: "POST",
    path: "/internal/example",
    body: { ok: true },
    headers: { "X-Caller-Service": "forged-call", "X-Internal-Token": "forged-call" },
  });

  assert.ok(observed);
  assert.equal(observed.headers.get("X-Caller-Service"), "runtime");
  assert.equal(observed.headers.get("X-Internal-Token"), "secret");
  assert.equal(observed.headers.get("X-Trace-Id"), "trace-1");
});
