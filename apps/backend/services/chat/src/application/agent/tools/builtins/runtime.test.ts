import assert from "node:assert/strict";
import test from "node:test";

import { experimental_getToolCaller as getToolCaller } from "@ai-sdk/provider-utils";
import type { Tool, ToolExecutionOptions } from "ai";

import { isToolOutcome } from "../outcome.js";
import { createRuntimeTools } from "./runtime.js";

function executable(runtime: Awaited<ReturnType<typeof createRuntimeTools>>, name: string) {
  const definition = runtime.manifests.find((manifest) => manifest.name === name)?.tool as
    | Tool<unknown, unknown>
    | undefined;
  assert.ok(definition?.execute);
  return (input: unknown, options: ToolExecutionOptions<unknown>) => definition.execute!(input, options);
}

function staticDescription(definition: { description?: unknown } | undefined): string {
  const description = definition?.description;
  if (typeof description !== "string") assert.fail("expected a static tool description");
  return description;
}

const options = { toolCallId: "runtime-test", messages: [], context: undefined };

test("runtime tools are base tools available without discovery", async () => {
  const runtime = await createRuntimeTools();
  try {
    assert.deepEqual(
      runtime.manifests.map((manifest) => manifest.name),
      ["web_fetch", "bash", "refresh_conversation_sources", "save_sandbox_file", "code_mode"],
    );
    assert.ok(runtime.manifests.every((manifest) => manifest.tool?.deferLoading !== true));
  } finally {
    await runtime.dispose();
  }
});

test("conversation source refresh is a normal-mode incremental import capability", async () => {
  const runtime = await createRuntimeTools();
  try {
    const refresh = runtime.manifests.find((manifest) => manifest.name === "refresh_conversation_sources");
    assert.deepEqual(refresh?.policy.modes, ["normal"]);
    assert.match(staticDescription(refresh?.tool), /after another tool publishes/i);
    assert.match(staticDescription(refresh?.tool), /only newly imported or updated source paths/i);
  } finally {
    await runtime.dispose();
  }
});

test("Web Fetch blocks private addresses and reports a recoverable failure", async () => {
  const runtime = await createRuntimeTools();
  try {
    const fetch = executable(runtime, "web_fetch");
    const result = await fetch({ url: "http://127.0.0.1/private" }, options);
    assert.ok(isToolOutcome(result) && result.status === "failed");
    assert.equal(result.error.source, "web-fetch");
  } finally {
    await runtime.dispose();
  }
});

test("Code Mode executes isolated ECMAScript computation", async () => {
  const runtime = await createRuntimeTools();
  try {
    const code = executable(runtime, "code_mode");
    const result = await code({ js: "return [1, 2, 3].reduce((sum, n) => sum + n, 0)" }, options);
    assert.ok(isToolOutcome(result) && result.status === "completed");
    assert.equal(result.data, 6);
  } finally {
    await runtime.dispose();
  }
});

test("Code Mode is an AI SDK caller with a cache-stable conversation catalog", async () => {
  const runtime = await createRuntimeTools();
  try {
    const definition = runtime.manifests.find((manifest) => manifest.name === "code_mode")?.tool;
    const caller = getToolCaller(definition);
    assert.equal(caller?.type, "local");
    assert.ok(caller?.type === "local" && caller.prepareModelMessage);
  } finally {
    await runtime.dispose();
  }
});

test("Code Mode describes its QuickJS boundary, routing threshold, and a safe web batch example", async () => {
  const runtime = await createRuntimeTools();
  try {
    const definitions = Object.fromEntries(runtime.manifests.map((manifest) => [manifest.name, manifest.tool]));
    assert.match(staticDescription(definitions.code_mode), /two or more independent/i);
    assert.match(staticDescription(definitions.code_mode), /URL.*not available/i);
    assert.match(staticDescription(definitions.code_mode), /await every tool call/i);
    assert.match(staticDescription(definitions.web_fetch), /one known public URL/i);
    assert.match(staticDescription(definitions.web_fetch), /code_mode/i);
    assert.match(staticDescription(definitions.bash), /Do not use Bash for ordinary public web/i);
    const inputExamples = (definitions.code_mode as { inputExamples?: unknown[] } | undefined)?.inputExamples;
    assert.ok(inputExamples && inputExamples.length > 0);
  } finally {
    await runtime.dispose();
  }
});

test("Code Mode failures explain how to recover from unavailable globals", async () => {
  const runtime = await createRuntimeTools();
  try {
    const code = executable(runtime, "code_mode");
    const result = await code({ js: "return new URL('https://example.com').hostname" }, options);
    assert.ok(isToolOutcome(result) && result.status === "failed");
    assert.equal(result.error.code, "CODE_MODE_UNAVAILABLE_GLOBAL");
    assert.match(result.error.message, /string operations or regular expressions/i);
  } finally {
    await runtime.dispose();
  }
});

test("runtime tools propagate cancellation", async () => {
  const runtime = await createRuntimeTools();
  try {
    const bash = executable(runtime, "bash");
    const signal = AbortSignal.abort(new DOMException("Stopped", "AbortError"));
    await assert.rejects(async () => bash({ command: "echo ignored" }, { ...options, abortSignal: signal }), {
      name: "AbortError",
    });
  } finally {
    await runtime.dispose();
  }
});
