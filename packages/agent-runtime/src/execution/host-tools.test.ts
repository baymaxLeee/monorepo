import assert from "node:assert/strict";
import test from "node:test";

import type { Tool, ToolExecutionOptions } from "ai";

import type { ExecutionEnvironment } from "../context/environment.js";
import { isToolOutcome } from "../tools/core/outcome.js";
import { ExecPolicy } from "./exec-policy.js";
import { createExecutionHostManifests } from "./host-tools.js";
import { ToolOrchestrator } from "./orchestrator.js";
import { compilePermissionProfile } from "./permissions.js";

const environment = {
  location: "local",
  workspace: {
    root: "/project",
    access: "read-write",
    isolation: "direct",
    persistence: "host",
    externalSources: "unavailable",
  },
  network: { access: "public", protocols: ["http", "https"] },
  process: { shell: true, lifetime: "command", backgroundServices: "unsupported" },
  deliverables: "workspace-reference",
  permissions: { profileId: ":workspace", enforcement: "managed", approvalPolicy: "on-request" },
} as const satisfies ExecutionEnvironment;

function orchestrator() {
  return new ToolOrchestrator({
    approvalPolicy: "on-request",
    permissionProfile: compilePermissionProfile(":workspace", { workspaceRoot: "/project" }).profile,
    fileSystemPolicy: { workspaceRoot: "/project", workingDirectory: "/project" },
    execPolicy: new ExecPolicy(),
  });
}

function files() {
  return {
    readText: async () => ({ content: "hello\n", sha256: "a".repeat(64), bytes: 6 }),
    writeText: async (input: { path: string; content: string; mode: "create" | "overwrite" }) => ({
      path: input.path,
      sha256: "b".repeat(64),
      bytes: Buffer.byteLength(input.content),
      created: input.mode === "create",
    }),
    deleteFile: async () => undefined,
  };
}

function executable(manifests: ReturnType<typeof createExecutionHostManifests>, name: string) {
  const definition = manifests.find((manifest) => manifest.name === name)?.tool as Tool<unknown, unknown> | undefined;
  assert.ok(definition?.execute);
  return (input: unknown, options: ToolExecutionOptions<unknown>) => definition.execute!(input, options);
}

test("execution hosts expose only sandbox-backed shell and file manifests", () => {
  const manifests = createExecutionHostManifests({
    environment,
    orchestrator: orchestrator(),
    run: async () => ({ type: "exit", exitCode: 0, stdout: "", stderr: "" }),
    files: files(),
  });
  assert.deepEqual(
    manifests.map((manifest) => manifest.name),
    ["bash", "read_file", "apply_patch", "write_file"],
  );
  assert.equal(manifests.find((manifest) => manifest.name === "read_file")?.planning.parallelizable, true);
  assert.equal(manifests.find((manifest) => manifest.name === "apply_patch")?.planning.parallelizable, undefined);
});

test("source refresh is an optional host capability", () => {
  const manifests = createExecutionHostManifests({
    environment: {
      ...environment,
      location: "cloud",
      workspace: {
        ...environment.workspace,
        root: "/workspace",
        isolation: "ephemeral",
        persistence: "session",
        externalSources: "read-only",
      },
    },
    orchestrator: orchestrator(),
    run: async () => ({ type: "exit", exitCode: 0, stdout: "", stderr: "" }),
    files: files(),
    refreshSources: async () => ({ sources: [] }),
  });
  assert.deepEqual(
    manifests.map((manifest) => manifest.name),
    ["bash", "read_file", "apply_patch", "write_file", "refresh_session_sources"],
  );
});

test("bash starts and resumes one retained terminal without a second model tool", async () => {
  const runtime = orchestrator();
  const manifests = createExecutionHostManifests({
    environment,
    orchestrator: runtime,
    run: async (_input, _attempt, _options, io) => {
      const stdin = new Promise<string>((resolve) => {
        io.stdin(async (value) => resolve(value));
      });
      io.output("ready\n");
      io.output(await stdin);
      return { type: "exit", exitCode: 0, stdout: "", stderr: "" };
    },
    files: files(),
  });
  const bash = executable(manifests, "bash");
  const command = { command: "cat", tty: true, yield_time_ms: 250 };
  await runtime.toolApproval({
    toolCall: { toolCallId: "start", toolName: "bash", input: command },
    messages: [],
  } as never);
  const started = await bash(command, { toolCallId: "start", messages: [], context: undefined });
  assert.ok(isToolOutcome(started) && started.status === "completed");
  const sessionId = (started.data as { session_id?: number }).session_id;
  assert.equal(typeof sessionId, "number");
  const continuation = { session_id: sessionId!, stdin: "done\n", yield_time_ms: 250 };
  await runtime.toolApproval({
    toolCall: { toolCallId: "continue", toolName: "bash", input: continuation },
    messages: [],
  } as never);
  const completed = await bash(continuation, { toolCallId: "continue", messages: [], context: undefined });
  assert.ok(isToolOutcome(completed) && completed.status === "completed");
  assert.match(JSON.stringify(completed.data), /done/u);
  await runtime.close();
});

test("host callbacks cannot contradict the advertised environment", () => {
  assert.throws(
    () =>
      createExecutionHostManifests({
        environment,
        orchestrator: orchestrator(),
        run: async () => ({ type: "exit", exitCode: 0, stdout: "", stderr: "" }),
        files: files(),
        refreshSources: async () => ({ sources: [] }),
      }),
    /must match the advertised external source capability/,
  );
});

test("apply_patch reports exact committed changes when a later file mutation fails", async () => {
  const runtime = orchestrator();
  const writes: string[] = [];
  const manifests = createExecutionHostManifests({
    environment,
    orchestrator: runtime,
    run: async () => ({ type: "exit", exitCode: 0, stdout: "", stderr: "" }),
    files: {
      readText: async () => null,
      writeText: async (input) => {
        writes.push(input.path);
        if (input.path.endsWith("/second.txt")) throw new Error("second write failed");
        return {
          path: input.path,
          sha256: "c".repeat(64),
          bytes: Buffer.byteLength(input.content),
          created: true,
        };
      },
      deleteFile: async () => undefined,
    },
  });
  const input = "*** Begin Patch\n*** Add File: first.txt\n+first\n*** Add File: second.txt\n+second\n*** End Patch";
  assert.equal(runtime.reviewFileTool("partial-patch", "apply_patch", input).type, "skip");

  const result = await executable(manifests, "apply_patch")(input, {
    toolCallId: "partial-patch",
    messages: [],
    context: undefined,
  });

  assert.ok(isToolOutcome(result) && result.status === "partial");
  assert.deepEqual(result.data, {
    changes: [{ type: "add", path: "/project/first.txt", sha256: "c".repeat(64) }],
  });
  assert.deepEqual(writes, ["/project/first.txt", "/project/second.txt"]);
});

test("apply_patch preserves committed changes when cancellation fences the returned result", async () => {
  const runtime = orchestrator();
  let committed = false;
  const manifests = createExecutionHostManifests({
    environment,
    orchestrator: runtime,
    run: async () => ({ type: "exit", exitCode: 0, stdout: "", stderr: "" }),
    files: {
      readText: async () => null,
      writeText: async (input) => {
        committed = true;
        runtime.close();
        return {
          path: input.path,
          sha256: "d".repeat(64),
          bytes: Buffer.byteLength(input.content),
          created: true,
        };
      },
      deleteFile: async () => undefined,
    },
  });
  const input = "*** Begin Patch\n*** Add File: committed.txt\n+saved\n*** End Patch";
  assert.equal(runtime.reviewFileTool("cancelled-patch", "apply_patch", input).type, "skip");

  const result = await executable(manifests, "apply_patch")(input, {
    toolCallId: "cancelled-patch",
    messages: [],
    context: undefined,
  });

  assert.equal(committed, true);
  assert.ok(isToolOutcome(result) && result.status === "partial");
  assert.deepEqual(result.data, {
    changes: [{ type: "add", path: "/project/committed.txt", sha256: "d".repeat(64) }],
  });
  assert.match(result.error.message, /process 1 closed/u);
});
