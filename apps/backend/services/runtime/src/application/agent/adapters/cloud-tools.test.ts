import assert from "node:assert/strict";
import test from "node:test";

import { asSchema } from "@ai-sdk/provider-utils";
import type { Tool, ToolExecutionOptions } from "ai";

import { CLOUD_EXECUTION_ENVIRONMENT, createCloudToolAdapters } from "./cloud-tools.js";

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
    ["bash", "read_file", "apply_patch", "write_file", "refresh_session_sources", "upload_artifacts"],
  );
  for (const name of ["bash", "read_file", "apply_patch", "write_file", "upload_artifacts"]) {
    assert.notEqual(runtime.manifests.find((manifest) => manifest.name === name)?.tool?.deferLoading, true);
  }
  assert.equal(
    runtime.manifests.find((manifest) => manifest.name === "refresh_session_sources")?.tool?.deferLoading,
    true,
  );
});

test("session source refresh remains a Runtime-only incremental import adapter", async () => {
  const runtime = await createCloudToolAdapters();
  const refresh = runtime.manifests.find((manifest) => manifest.name === "refresh_session_sources");
  assert.equal("modes" in (refresh?.policy ?? {}), false);
  assert.match(staticDescription(refresh?.tool), /after another tool adds or updates/i);
  assert.match(staticDescription(refresh?.tool), /workspace files are preserved/i);
});

test("cloud Bash adapter propagates cancellation", async () => {
  const runtime = await createCloudToolAdapters();
  const bash = executable(runtime, "bash");
  const signal = AbortSignal.abort(new DOMException("Stopped", "AbortError"));
  const input = { command: "echo ignored", timeout_ms: 10_000, sandbox_permissions: "use_default" };
  await runtime.toolApproval({
    toolCall: { toolCallId: "runtime-test", toolName: "bash", input },
    messages: [],
  } as never);
  await assert.rejects(async () => bash(input, { ...options, abortSignal: signal }), {
    name: "AbortError",
  });
});

test("cloud execution environment describes behavior without exposing transport details", () => {
  assert.equal(CLOUD_EXECUTION_ENVIRONMENT.network.access, "restricted");
  assert.equal(CLOUD_EXECUTION_ENVIRONMENT.workspace.persistence, "session");
  assert.doesNotMatch(JSON.stringify(CLOUD_EXECUTION_ENVIRONMENT), /proxy|squid|socket/i);
});

test("cloud adapters compile the session execution policy instead of using fixed defaults", async () => {
  const readOnly = await createCloudToolAdapters({
    approvalPolicy: "never",
    permissionProfile: ":read-only",
  });
  try {
    assert.deepEqual(readOnly.environment.permissions, {
      profileId: ":read-only",
      enforcement: "managed",
      approvalPolicy: "never",
    });
    assert.equal(readOnly.permissionProfile.type, "managed");
    assert.equal(
      readOnly.permissionProfile.type === "managed" &&
        readOnly.permissionProfile.fileSystem.type === "restricted" &&
        readOnly.permissionProfile.fileSystem.entries.some((entry) => entry.access === "write"),
      false,
    );
  } finally {
    await readOnly.dispose();
  }

  const unrestricted = await createCloudToolAdapters({
    approvalPolicy: "granular",
    permissionProfile: ":danger-full-access",
  });
  try {
    assert.deepEqual(unrestricted.environment.permissions, {
      profileId: ":danger-full-access",
      enforcement: "disabled",
      approvalPolicy: "granular",
    });
    assert.deepEqual(unrestricted.permissionProfile, { type: "disabled" });
  } finally {
    await unrestricted.dispose();
  }
});

test("a replacement cloud execution resumes only the approved retry in its assistant journal", async () => {
  const input = { command: "echo ok", sandbox_permissions: "use_default", timeout_ms: 10_000 };
  const retry = {
    ...input,
    retry_of: "denial",
    sandbox_permissions: "with_additional_permissions",
    additional_permissions: { network: { allowedHosts: ["test.invalid"] } },
  };
  const continuation = {
    id: "assistant",
    role: "assistant" as const,
    parts: [
      {
        type: "tool-bash" as const,
        toolCallId: "original",
        state: "output-available" as const,
        input,
        output: {
          ok: false,
          status: "partial",
          error: { code: "SANDBOX_DENIED", message: "denied", retryable: true },
          data: {
            termination: {
              type: "sandbox-violation",
              retryId: "denial",
              violation: { type: "network", host: "test.invalid", protocol: "https", port: 443 },
            },
          },
        },
      },
      {
        type: "tool-bash" as const,
        toolCallId: "retry",
        state: "approval-responded" as const,
        input: retry,
        approval: { id: "approval", approved: true },
      },
    ],
  };
  const runtime = await createCloudToolAdapters(undefined, continuation);
  const review = (toolCallId: string, candidate = retry) =>
    runtime.toolApproval({
      toolCall: { toolCallId, toolName: "bash", input: candidate },
      messages: [],
    } as never);
  try {
    assert.equal(((await review("different")) as { type: string }).type, "denied");
    assert.equal(((await review("retry")) as { type: string }).type, "user-approval");
  } finally {
    await runtime.dispose();
  }
  const consumed = await createCloudToolAdapters(undefined, {
    ...continuation,
    parts: [
      ...continuation.parts,
      {
        type: "tool-bash",
        state: "output-available",
        toolCallId: "executed",
        input: retry,
        output: {},
      },
    ],
  });
  assert.equal(
    (
      (await consumed.toolApproval({
        toolCall: { toolCallId: "retry", toolName: "bash", input: retry },
        messages: [],
      } as never)) as { type: string }
    ).type,
    "denied",
  );
  await consumed.dispose();
});
