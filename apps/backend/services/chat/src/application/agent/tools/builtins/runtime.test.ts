import assert from "node:assert/strict";
import test from "node:test";

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

const options = { toolCallId: "runtime-test", messages: [], context: undefined };

test("runtime tools are base tools available without discovery", async () => {
  const runtime = await createRuntimeTools();
  try {
    assert.deepEqual(
      runtime.manifests.map((manifest) => manifest.name),
      ["web_fetch", "bash", "code_mode"],
    );
    assert.ok(runtime.manifests.every((manifest) => manifest.tool?.deferLoading !== true));
  } finally {
    await runtime.dispose();
  }
});

test("Bash keeps scratch files within a run and isolates subsequent runs", async () => {
  const first = await createRuntimeTools();
  const second = await createRuntimeTools();
  try {
    const bash = executable(first, "bash");
    const isolated = executable(second, "bash");
    const write = await bash({ command: "printf 'one\\ntwo\\n' > notes.txt" }, options);
    assert.ok(isToolOutcome(write) && write.ok);
    const read = await bash({ command: "cat notes.txt" }, options);
    assert.ok(isToolOutcome(read) && read.status === "completed");
    assert.deepEqual(read.data, { stdout: "one\ntwo\n", stderr: "", exitCode: 0 });
    const absent = await isolated({ command: "cat notes.txt" }, options);
    assert.ok(isToolOutcome(absent) && absent.status === "partial" && !absent.ok);
  } finally {
    await first.dispose();
    await second.dispose();
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

test("Code Mode computes in isolation and cannot invoke business writes", async () => {
  const runtime = await createRuntimeTools();
  try {
    const code = executable(runtime, "code_mode");
    const result = await code({ js: "return [1, 2, 3].reduce((sum, n) => sum + n, 0)" }, options);
    assert.ok(isToolOutcome(result) && result.status === "completed");
    assert.equal(result.data, 6);
    const denied = await code({ js: "return await tools.write_file({path: 'x', content: 'x'})" }, options);
    assert.ok(isToolOutcome(denied) && denied.status === "failed");
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
