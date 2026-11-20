import assert from "node:assert/strict";
import test from "node:test";

import { ExecPolicy } from "./exec-policy.js";
import { compilePermissionProfile, type PermissionProfile } from "./permissions.js";
import { ToolOrchestrator, type SandboxAttemptResult } from "./tool-orchestrator.js";

const workspace = compilePermissionProfile(":workspace", { workspaceRoot: "/workspace" }).profile;

function orchestrator(permissionProfile: PermissionProfile = workspace) {
  return new ToolOrchestrator({
    approvalPolicy: "on-request",
    permissionProfile,
    fileSystemPolicy: { workspaceRoot: "/workspace", workingDirectory: "/workspace/work" },
    execPolicy: new ExecPolicy(),
    retryId: () => "retry-1",
  });
}

test("toolCallId admission freezes and rechecks the canonical command before execution", async () => {
  const runtime = orchestrator();
  const input = { command: "pwd", timeout_ms: 10_000, sandbox_permissions: "use_default" as const };
  assert.equal(runtime.reviewBash("call-1", input).type, "skip");
  await assert.rejects(
    runtime.runBash("call-1", { ...input, command: "whoami" }, async () => ({
      type: "exit",
      exitCode: 0,
      stdout: "",
      stderr: "",
    })),
    /changed after admission/,
  );
  await assert.rejects(
    runtime.runBash("missing", input, async () => ({ type: "exit", exitCode: 0, stdout: "", stderr: "" })),
    /was not admitted/,
  );
});

test("Bash orchestration preserves transport output retention metadata", async () => {
  const runtime = orchestrator();
  const input = { command: "large-output", timeout_ms: 10_000, sandbox_permissions: "use_default" as const };
  assert.equal(runtime.reviewBash("output-metadata", input).type, "skip");

  const result = await runtime.runBash(
    "output-metadata",
    input,
    async () =>
      ({
        type: "exit",
        exitCode: 0,
        stdout: "tail",
        stderr: "",
        outputMetadata: {
          stdout: { totalBytes: 90_000, truncated: true },
          stderr: { totalBytes: 0, truncated: false },
        },
      }) as SandboxAttemptResult & {
        outputMetadata: {
          stdout: { totalBytes: number; truncated: boolean };
          stderr: { totalBytes: number; truncated: boolean };
        };
      },
  );

  assert.deepEqual((result as typeof result & { outputMetadata?: unknown }).outputMetadata, {
    stdout: { totalBytes: 90_000, truncated: true },
    stderr: { totalBytes: 0, truncated: false },
  });
});

test("a typed denial binds one fresh approved retry to the same command and violation", async () => {
  const runtime = orchestrator();
  const initial = {
    command: "curl https://api.example.com",
    timeout_ms: 10_000,
    sandbox_permissions: "use_default" as const,
  };
  runtime.reviewBash("first", initial);
  const denied = await runtime.runBash("first", initial, async (attempt): Promise<SandboxAttemptResult> => {
    assert.equal(attempt.sandboxed, true);
    return {
      type: "sandbox-violation",
      stdout: "",
      stderr: "network denied",
      violation: { type: "network", host: "api.example.com", port: 443, protocol: "https" },
    };
  });
  assert.equal(denied.termination.type, "sandbox-violation");
  if (denied.termination.type !== "sandbox-violation") throw new Error("expected denial");

  const retry = {
    ...initial,
    retry_of: denied.termination.retryId,
    sandbox_permissions: "with_additional_permissions" as const,
    additional_permissions: { network: { allowedHosts: ["api.example.com"] } },
  };
  assert.equal(runtime.reviewBash("retry", retry).type, "needs-approval");
  const completed = await runtime.runBash("retry", retry, async (attempt) => {
    assert.equal(attempt.attempt, 2);
    assert.equal(attempt.sandboxed, true);
    assert.deepEqual(attempt.permissionProfile.type === "managed" && attempt.permissionProfile.network, {
      type: "restricted",
      allowedHosts: ["api.example.com"],
    });
    return { type: "exit", exitCode: 0, stdout: "ok", stderr: "" };
  });
  assert.equal(completed.termination.type, "exit");
  runtime.reviewBash("replay", retry);
  await assert.rejects(
    runtime.runBash("replay", retry, async () => ({ type: "exit", exitCode: 0, stdout: "", stderr: "" })),
    /already consumed/,
  );
});

test("retry keeps the sandbox when the base profile contains denied reads", async () => {
  const base: PermissionProfile = {
    type: "managed",
    fileSystem: {
      type: "restricted",
      entries: [
        { path: "/", access: "read" },
        { path: "/workspace", access: "write" },
        { path: "/private", access: "deny" },
      ],
    },
    network: { type: "restricted", allowedHosts: [] },
  };
  const runtime = orchestrator(base);
  const first = { command: "tool", timeout_ms: 10_000, sandbox_permissions: "use_default" as const };
  runtime.reviewBash("first", first);
  const denied = await runtime.runBash("first", first, async () => ({
    type: "sandbox-violation",
    stdout: "",
    stderr: "write denied",
    violation: { type: "file-system", operation: "write", path: "/workspace/out" },
  }));
  if (denied.termination.type !== "sandbox-violation") throw new Error("expected denial");
  const retry = {
    ...first,
    retry_of: denied.termination.retryId,
    sandbox_permissions: "require_escalated" as const,
  };
  runtime.reviewBash("retry", retry);
  await runtime.runBash("retry", retry, async (attempt) => {
    assert.equal(attempt.sandboxed, true);
    assert.deepEqual(attempt.permissionProfile, {
      type: "managed",
      fileSystem: {
        type: "restricted",
        entries: [
          { path: "/", access: "write" },
          { path: "/private", access: "deny" },
        ],
      },
      network: { type: "enabled" },
    });
    return { type: "exit", exitCode: 0, stdout: "", stderr: "" };
  });
});

test("file admission derives exact workspace authority and freezes every patch path", async () => {
  const runtime = orchestrator();
  const input = {
    patch: "*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: src/b.ts\n@@\n-old\n+new\n*** End Patch",
  };
  assert.equal(runtime.reviewFileTool("patch-1", "apply_patch", input).type, "skip");
  await runtime.runFileTool("patch-1", "apply_patch", input, async (authority) => {
    assert.deepEqual(authority.accesses, [
      { path: "/workspace/work/src/a.ts", access: "write" },
      { path: "/workspace/work/src/b.ts", access: "write" },
    ]);
    assert.equal(authority.process.processId, 1);
    assert.equal(authority.abortSignal.aborted, false);
    return "ok";
  });
  await assert.rejects(
    runtime.runFileTool("patch-1", "apply_patch", input, async () => "replayed"),
    /was not admitted/,
  );
});

test("file approval can add one exact write without weakening a denied read", async () => {
  const readOnly = compilePermissionProfile(":read-only", { workspaceRoot: "/workspace" }).profile;
  const runtime = orchestrator(readOnly);
  const input = {
    path: "notes.txt",
    content: "new",
    mode: "create" as const,
  };
  assert.equal(runtime.reviewFileTool("write-1", "write_file", input).type, "needs-approval");
  await runtime.runFileTool("write-1", "write_file", input, async (authority) => {
    assert.deepEqual(authority.accesses, [{ path: "/workspace/work/notes.txt", access: "write" }]);
    assert.deepEqual(authority.permissionProfile.type === "managed" && authority.permissionProfile.fileSystem, {
      type: "restricted",
      entries: [
        { path: "/", access: "read" },
        { path: "/workspace/work/notes.txt", access: "write" },
      ],
    });
    return "ok";
  });

  const denied = orchestrator({
    type: "managed",
    fileSystem: {
      type: "restricted",
      entries: [
        { path: "/", access: "read" },
        { path: "/workspace", access: "write" },
        { path: "/workspace/private", access: "deny" },
      ],
    },
    network: { type: "restricted", allowedHosts: [] },
  });
  assert.deepEqual(denied.reviewFileTool("read-1", "read_file", { path: "/workspace/private/secret" }), {
    type: "forbidden",
    reason: "file access is denied by the active permission profile",
  });
});

test("file admission uses the most specific path rule like the platform sandboxes", () => {
  const runtime = orchestrator({
    type: "managed",
    fileSystem: {
      type: "restricted",
      entries: [
        { path: "/", access: "read" },
        { path: "/workspace/private", access: "deny" },
        { path: "/workspace/private/public", access: "write" },
      ],
    },
    network: { type: "restricted", allowedHosts: [] },
  });

  assert.equal(
    runtime.reviewFileTool("public", "write_file", {
      path: "/workspace/private/public/notes.txt",
      content: "visible",
      mode: "create",
    }).type,
    "skip",
  );
  assert.deepEqual(runtime.reviewFileTool("private", "read_file", { path: "/workspace/private/secret" }), {
    type: "forbidden",
    reason: "file access is denied by the active permission profile",
  });
});

test("file tools cannot request approval for immutable host paths or escape the workspace", () => {
  const runtime = new ToolOrchestrator({
    approvalPolicy: "on-request",
    permissionProfile: workspace,
    fileSystemPolicy: {
      workspaceRoot: "/workspace",
      workingDirectory: "/workspace/work",
      immutableWriteRoots: ["/workspace/sources"],
    },
  });
  assert.deepEqual(
    runtime.reviewFileTool("source", "write_file", {
      path: "/workspace/sources/input.txt",
      content: "no",
      mode: "create",
    }),
    { type: "forbidden", reason: "file mutations cannot target a host-protected path" },
  );
  assert.deepEqual(runtime.reviewFileTool("escape", "read_file", { path: "../../etc/passwd" }), {
    type: "forbidden",
    reason: "file tools are limited to the authorized workspace",
  });
});

test("closing the orchestrator aborts an admitted file operation and rejects its late result", async () => {
  const runtime = orchestrator();
  const input = { path: "notes.txt" };
  assert.equal(runtime.reviewFileTool("read-1", "read_file", input).type, "skip");
  let release!: () => void;
  let signal: AbortSignal | undefined;
  const running = runtime.runFileTool("read-1", "read_file", input, async (authority) => {
    signal = authority.abortSignal;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return "late";
  });
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  runtime.close();
  assert.equal(signal?.aborted, true);
  release();
  await assert.rejects(running, /process 1 closed/);
});

test("on-request approval does not interrupt public reads but still guards external writes", async () => {
  const runtime = orchestrator();
  const policy = {
    capability: "search",
    trust: "open-world",
    execution: "inline",
    source: "builtin",
  } as const;

  assert.equal(
    await runtime.toolApproval({
      toolCall: {
        toolCallId: "web-read",
        toolName: "web_fetch",
        input: { url: "https://example.com" },
        toolMetadata: { agent: { ...policy, effect: "read" } },
      },
      messages: [],
    } as never),
    "not-applicable",
  );
  assert.deepEqual(
    await runtime.toolApproval({
      toolCall: {
        toolCallId: "external-write",
        toolName: "external_write",
        input: {},
        toolMetadata: { agent: { ...policy, effect: "write" } },
      },
      messages: [],
    } as never),
    { type: "user-approval", reason: "tool acts on an open-world target" },
  );
});
