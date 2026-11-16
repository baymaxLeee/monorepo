import assert from "node:assert/strict";
import test from "node:test";

import { asSchema } from "@ai-sdk/provider-utils";
import type { Tool, ToolExecutionOptions } from "ai";

import { createCloudToolAdapters } from "./cloud-tools.js";

function executable(runtime: Awaited<ReturnType<typeof createCloudToolAdapters>>, name: string) {
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

test("cloud artifact schema has a strict-provider-compatible object root", async () => {
  const runtime = await createCloudToolAdapters();
  const definition = runtime.manifests.find((entry) => entry.name === "upload_artifacts")!.tool;
  assert.ok(definition && definition.inputSchema);
  const schema = await asSchema(definition.inputSchema).jsonSchema;
  assert.equal(schema.type, "object");
  assert.equal(schema.oneOf, undefined);
  assert.equal(schema.anyOf, undefined);
});

test("cloud adapters expose only cloud workspace capabilities", async () => {
  const runtime = await createCloudToolAdapters();
  assert.deepEqual(
    runtime.manifests.map((manifest) => manifest.name),
    ["bash", "refresh_session_sources", "upload_artifacts"],
  );
  assert.ok(runtime.manifests.every((manifest) => manifest.tool?.deferLoading !== true));
});

test("session source refresh remains a Runtime-only incremental import adapter", async () => {
  const runtime = await createCloudToolAdapters();
  const refresh = runtime.manifests.find((manifest) => manifest.name === "refresh_session_sources");
  assert.deepEqual(refresh?.policy.modes, ["normal"]);
  assert.match(staticDescription(refresh?.tool), /after another tool publishes/i);
  assert.match(staticDescription(refresh?.tool), /only newly imported or updated source paths/i);
});

test("cloud Bash adapter propagates cancellation", async () => {
  const runtime = await createCloudToolAdapters();
  const bash = executable(runtime, "bash");
  const signal = AbortSignal.abort(new DOMException("Stopped", "AbortError"));
  await assert.rejects(async () => bash({ command: "echo ignored" }, { ...options, abortSignal: signal }), {
    name: "AbortError",
  });
});
