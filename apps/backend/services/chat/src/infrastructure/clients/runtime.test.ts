import assert from "node:assert/strict";
import test from "node:test";

import { runtimeRequest } from "./runtime.js";

test("runtime proxy preserves stream, scope headers, query and Chat workload identity", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.RUNTIME_SERVICE_URL;
  const originalToken = process.env.INTERNAL_API_TOKEN;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.RUNTIME_SERVICE_URL;
    else process.env.RUNTIME_SERVICE_URL = originalUrl;
    if (originalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = originalToken;
  });
  process.env.RUNTIME_SERVICE_URL = "http://runtime.test:8015";
  process.env.INTERNAL_API_TOKEN = "chat-token";

  const body = new ReadableStream<Uint8Array>();
  const signal = new AbortController().signal;
  let requestedUrl = "";
  let requestedInit: RequestInit & { duplex?: "half" } = {};
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init ?? {};
    return new Response("ok", { status: 202 });
  };

  const request = new Request("http://chat.test/conversations/session/agents/run?cursor=3", {
    method: "POST",
    headers: {
      "X-Auth-User-ID": "user",
      "X-Auth-Tenant-ID": "tenant",
      "X-Auth-Workspace-ID": "workspace",
      "Content-Type": "application/json",
    },
    body,
    signal,
    duplex: "half",
  });

  const response = await runtimeRequest(request, "/v1/sessions/session/agents/run?cursor=3");

  assert.equal(response.status, 202);
  assert.equal(requestedUrl, "http://runtime.test:8015/v1/sessions/session/agents/run?cursor=3");
  assert.equal(requestedInit.method, "POST");
  assert.equal(requestedInit.body, body);
  assert.equal(requestedInit.signal, request.signal);
  assert.equal(requestedInit.duplex, "half");
  const headers = new Headers(requestedInit.headers);
  assert.equal(headers.get("X-Caller-Service"), "chat");
  assert.equal(headers.get("X-Internal-Token"), "chat-token");
  assert.equal(headers.get("X-Auth-User-ID"), "user");
  assert.equal(headers.get("X-Auth-Tenant-ID"), "tenant");
  assert.equal(headers.get("X-Auth-Workspace-ID"), "workspace");
  assert.equal(headers.get("Content-Type"), "application/json");
});
