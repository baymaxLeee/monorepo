import assert from "node:assert/strict";
import test from "node:test";

import type { Tool, ToolExecutionOptions } from "ai";

import { isToolOutcome } from "../tools/outcome.js";
import type { ExecutionEnvironment } from "./environment.js";
import { ExecPolicy } from "./exec-policy.js";
import { createExecutionHostManifests } from "./execution-host.js";
import { compilePermissionProfile } from "./permissions.js";
import { ToolOrchestrator } from "./tool-orchestrator.js";

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

const published = {
  file_id: "a".repeat(32),
  filename: "result.txt",
  title: "result.txt",
  media_type: "text/plain",
  kind: "artifact",
  etag: `"${"b".repeat(32)}"`,
  updated: false,
};

test("execution hosts share one shell and deliverable manifest set", () => {
  const manifests = createExecutionHostManifests({
    environment,
    orchestrator: orchestrator(),
    run: async () => ({ type: "exit", exitCode: 0, stdout: "", stderr: "" }),
    files: files(),
    deliver: async () => published,
  });
  assert.deepEqual(
    manifests.map((manifest) => manifest.name),
    ["bash", "read_file", "apply_patch", "write_file", "upload_artifacts"],
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
    deliver: async () => published,
    refreshSources: async () => ({ sources: [] }),
  });
  assert.deepEqual(
    manifests.map((manifest) => manifest.name),
    ["bash", "read_file", "apply_patch", "write_file", "refresh_session_sources", "upload_artifacts"],
  );
});

test("host callbacks cannot contradict the advertised environment", () => {
  assert.throws(
    () =>
      createExecutionHostManifests({
        environment,
        orchestrator: orchestrator(),
        run: async () => ({ type: "exit", exitCode: 0, stdout: "", stderr: "" }),
        files: files(),
        deliver: async () => published,
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
    deliver: async () => published,
  });
  const input = {
    patch: "*** Begin Patch\n*** Add File: first.txt\n+first\n*** Add File: second.txt\n+second\n*** End Patch",
  };
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
