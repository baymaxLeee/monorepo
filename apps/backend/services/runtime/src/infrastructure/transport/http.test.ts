import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";

import { InternalHttpClient } from "./http.js";
import { RuntimeSandboxClient, type SandboxContinue } from "./runtime-sandbox.js";

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

test("replayed terminal input keeps its identity and cursor after a lost response", async () => {
  const requests: string[] = [];
  let failure: "network" | "rejected" | "cancelled" = "network";
  const owner = new AbortController();
  const client = new RuntimeSandboxClient({
    baseUrl: "http://sandbox.internal",
    callerService: "runtime",
    internalToken: "test",
    fetchImpl: async (_url, init) => {
      requests.push(String(init?.body));
      if (failure === "rejected") return Response.json({ message: "invalid cursor" }, { status: 422 });
      if (failure === "cancelled") owner.abort();
      if (requests.length === 1 || owner.signal.aborted) throw new TypeError("fetch failed");
      return Response.json({ session_id: "p", stdout: "ok", stdout_offset: 2 });
    },
  });
  const input: SandboxContinue = {
    scope: { session_id: "c", run_id: "r", attempt_epoch: "1", workspace_generation: "1" },
    request_id: "write-once",
    chars: "line\n",
    stdout_offset: 0,
    stderr_offset: 0,
    yield_time_ms: 10,
  };
  const write = () => client.write("guest", "p", input, owner.signal);
  assert.equal((await write()).stdout, "ok");
  assert.deepEqual(requests, [JSON.stringify(input), JSON.stringify(input)]);
  failure = "rejected";
  await assert.rejects(write, /422/);
  assert.equal(requests.length, 3);
  failure = "cancelled";
  await assert.rejects(write, { name: "AbortError" });
  assert.equal(requests.length, 4);
});

test("polling one live terminal releases completed request cancellation listeners", async () => {
  const client = new InternalHttpClient({
    baseUrl: "http://sandbox.internal",
    service: "runtime-sandbox",
    callerService: "runtime",
    internalToken: "test",
    fetchImpl: async () => Response.json({}),
  });
  const owner = new AbortController();
  for (let index = 0; index < 16; index++) await client.requestJson({ path: "/poll", signal: owner.signal });
  assert.equal(getEventListeners(owner.signal, "abort").length, 0);
});
