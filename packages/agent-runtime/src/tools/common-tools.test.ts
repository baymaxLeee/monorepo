import assert from "node:assert/strict";
import test from "node:test";

import { experimental_getToolCaller as getToolCaller } from "@ai-sdk/provider-utils";
import type { Tool, ToolExecutionOptions } from "ai";

import { createCodeModeManifest } from "./code-mode.js";
import { isToolOutcome } from "./outcome.js";
import { createWebFetchManifest, createWebSearchManifest, webFetchIssue } from "./web.js";

function executable(definition: Tool<unknown, unknown> | undefined) {
  assert.ok(definition?.execute);
  return (input: unknown, options: ToolExecutionOptions<unknown>) => definition.execute!(input, options);
}

function staticDescription(definition: { description?: unknown } | undefined): string {
  const description = definition?.description;
  if (typeof description !== "string") assert.fail("expected a static tool description");
  return description;
}

const options = { toolCallId: "common-tools-test", messages: [], context: undefined };

test("Web Fetch blocks private addresses and reports a recoverable failure", async () => {
  const fetch = executable(createWebFetchManifest().tool as Tool<unknown, unknown> | undefined);
  const result = await fetch({ url: "http://127.0.0.1/private" }, options);
  assert.ok(isToolOutcome(result) && result.status === "failed");
  assert.equal(result.error.source, "web-fetch");
});

test("Web Fetch preserves HTTP availability semantics in the unified issue", () => {
  assert.deepEqual(webFetchIssue({ type: "error", errorCode: "http_error", statusCode: 429, message: "HTTP 429" }), {
    code: "PROVIDER_RATE_LIMITED",
    message: "HTTP 429",
    retryable: true,
    source: "web-fetch",
  });
  assert.deepEqual(webFetchIssue({ type: "error", errorCode: "http_error", statusCode: 403, message: "HTTP 403" }), {
    code: "SERVICE_PERMISSION_DENIED",
    message: "HTTP 403",
    retryable: false,
    source: "web-fetch",
  });
});

test("Code Mode executes isolated ECMAScript and preserves its SDK caller", async () => {
  const definition = createCodeModeManifest().tool;
  const code = executable(definition as Tool<unknown, unknown> | undefined);
  const result = await code({ js: "return [1, 2, 3].reduce((sum, n) => sum + n, 0)" }, options);
  assert.ok(isToolOutcome(result) && result.status === "completed");
  assert.equal(result.data, 6);
  const caller = getToolCaller(definition);
  assert.equal(caller?.type, "local");
  assert.ok(caller?.type === "local" && caller.bind);
  assert.equal(caller.prepareModelMessage, undefined);
});

test("common web tools describe routing and the QuickJS boundary", () => {
  const code = createCodeModeManifest().tool;
  const fetch = createWebFetchManifest().tool;
  const search = createWebSearchManifest(async (input) => ({ query: input.query, untrusted: true, results: [] })).tool;
  assert.match(staticDescription(code), /two or more independent/i);
  assert.match(staticDescription(code), /URL.*not available/i);
  assert.match(staticDescription(code), /await every tool call/i);
  assert.match(staticDescription(fetch), /one known public URL/i);
  assert.match(staticDescription(fetch), /code_mode/i);
  assert.match(staticDescription(search), /one focused public-web query/i);
  assert.match(staticDescription(search), /two or more independent queries.*code_mode/i);
  const inputExamples = (code as { inputExamples?: unknown[] } | undefined)?.inputExamples;
  assert.ok(inputExamples && inputExamples.length > 0);
});

test("Code Mode failures explain how to recover from unavailable globals", async () => {
  const code = executable(createCodeModeManifest().tool as Tool<unknown, unknown> | undefined);
  const result = await code({ js: "return new URL('https://example.com').hostname" }, options);
  assert.ok(isToolOutcome(result) && result.status === "failed");
  assert.equal(result.error.code, "CODE_MODE_UNAVAILABLE_GLOBAL");
  assert.match(result.error.message, /string operations or regular expressions/i);
});
