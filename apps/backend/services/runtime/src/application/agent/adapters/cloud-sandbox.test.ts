import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { type SandboxAttempt, compilePermissionProfile } from "@repo/agent-runtime";

import type { SandboxProcess } from "#runtime/transport";

import type { KnowledgeDocument } from "../../../infrastructure/clients/knowledge.js";
import type { SessionFile } from "../../session-files.js";
import { RunSandbox, type SandboxDependencies } from "./cloud-sandbox.js";

const context = {
  tenantId: "t",
  workspaceId: "w",
  userId: "u",
  sessionId: "c",
  runId: "r",
  attemptEpoch: "1",
};
const bytes = Uint8Array.from([0, 255, 1, 128, 10]);
const permissionProfile = compilePermissionProfile(":workspace", { workspaceRoot: "/workspace" }).profile;
let processId = 0;
function attempt(): SandboxAttempt {
  processId++;
  return {
    attempt: 1,
    sandboxed: true,
    permissionProfile,
    process: { processId, entryId: `cloud-test-${processId}` },
    abortSignal: new AbortController().signal,
  };
}
const document = {
  id: "doc",
  tenant_id: "t",
  workspace_id: "w",
  user_id: "u",
  conversation_id: "c",
  filename: "测试.bin",
  title: "test",
  asset_id: "asset",
  source_revision_id: "revision",
  mime_type: "application/octet-stream",
  content_md: "",
} as unknown as KnowledgeDocument;
function fixture() {
  const calls: string[] = [];
  const executionStates: string[] = [];
  const imported: Uint8Array[] = [];
  const importedPaths: string[] = [];
  const conditionalUploads: Array<{
    path: string;
    content: Uint8Array;
    conditions: { mode?: "create" | "overwrite"; expectedSha256?: string } | undefined;
  }> = [];
  const conditionalDeletes: Array<{ path: string; expectedSha256: string }> = [];
  const process: SandboxProcess = {
    session_id: "process",
    stdout: "first",
    stderr: "",
    termination: null,
    stdout_offset: 5,
    stderr_offset: 0,
    truncated: false,
  };
  const client: ReturnType<SandboxDependencies["sandbox"]> = {
    create: async () => {
      calls.push("create");
      return { id: "sandbox", workdir: "/workspace/work", expires_at: "later" };
    },
    destroy: async () => {
      calls.push("destroy");
      return { destroyed: true };
    },
    snapshot: async () => ({ files: [] }),
    upload: async (_id, _scope, path, body, _signal, _workspaceEditToken, conditions) => {
      importedPaths.push(path);
      const content = new Uint8Array(await new Response(body).arrayBuffer());
      imported.push(content);
      if (conditions) conditionalUploads.push({ path, content, conditions });
    },
    deleteFile: async (_id, _scope, path, expectedSha256) => {
      conditionalDeletes.push({ path, expectedSha256 });
    },
    download: async () => new Blob([bytes]).stream(),
    start: async () => {
      calls.push("start");
      return process;
    },
    write: async (_id, _session, input) => {
      assert.equal(input.stdout_offset, 5);
      return { ...process, stdout: "second", stdout_offset: 11, termination: { type: "exit", exit_code: 0 } };
    },
    cancel: async () => ({ ...process, termination: { type: "exit", exit_code: 137 } }),
  };
  const checkout = new Map<
    string,
    Pick<SessionFile, "workspace_path" | "id" | "path_generation" | "etag" | "sha256" | "size">
  >();
  const deps: SandboxDependencies = {
    checkout: async () => [...checkout.values()],
    recordCheckout: async (_scope, file) => {
      checkout.set(file.workspace_path, file);
    },
    sandbox: () => client,
    asset: () => ({
      content: async () => new Blob([bytes]).stream(),
      appendRevision: async () => {
        throw new Error("appendRevision was not expected");
      },
      prepareClaim: async () => {},
      activateClaim: async () => {},
      upload: async (input) => {
        assert.ok(input.body instanceof ReadableStream);
        assert.deepEqual(new Uint8Array(await new Response(input.body).arrayBuffer()), bytes);
        calls.push("upload");
        return {
          assetId: "saved",
          revisionId: "rev",
          filename: "output.bin",
          mediaType: "application/octet-stream",
          sizeBytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      },
    }),
    documents: async () => [document],
    files: async () => [],
    publish: async (input) => {
      calls.push("publish");
      assert.equal(input.assetId, "saved");
      return {
        id: "saved",
        session_id: "c",
        filename: "output.bin",
        workspace_path: "/workspace/output.bin",
        workspace_state: "live" as const,
        path_generation: 1,
        title: "Output",
        mime_type: "application/octet-stream",
        size: 5,
        asset_id: "saved",
        revision_id: "rev",
        sha256: "sha",
        editable: false,
        edit_max_bytes: 2097152,
        etag: '"00000000000000000000000000000000"',
        last_writer: { type: "agent" as const, id: "r" },
        created_at: "now",
        updated_at: "now",
      };
    },
    update: async (input, upload) => {
      calls.push("update");
      assert.equal(input.fileId, "file");
      assert.equal(input.expectedEtag, '"11111111111111111111111111111111"');
      const candidate = await upload(
        "update-key",
        {
          id: "file",
          session_id: "c",
          filename: "notes.md",
          workspace_path: "/workspace/notes.md",
          workspace_state: "live",
          path_generation: 1,
          title: "Notes",
          mime_type: "text/markdown",
          size: 4,
          asset_id: "asset",
          revision_id: "revision",
          sha256: "old",
          editable: true,
          edit_max_bytes: 2097152,
          etag: input.expectedEtag,
          last_writer: { type: "agent", id: "old" },
          created_at: "now",
          updated_at: "now",
        },
        { ownerType: "session_file", ownerId: "file", slot: "source", generation: 1 },
      );
      assert.equal(candidate.filename, "notes.md");
      const saved: SessionFile = {
        id: "file",
        session_id: "c",
        filename: "notes.md",
        workspace_path: "/workspace/notes.md",
        workspace_state: "live" as const,
        path_generation: 1,
        title: "Notes",
        mime_type: "text/markdown",
        size: candidate.sizeBytes,
        asset_id: candidate.assetId,
        revision_id: candidate.revisionId,
        sha256: candidate.sha256,
        editable: true,
        edit_max_bytes: 2097152,
        etag: '"22222222222222222222222222222222"',
        last_writer: { type: "agent" as const, id: "r" },
        created_at: "now",
        updated_at: "later",
      };
      if (input.sandboxAttempt) await deps.recordCheckout(input.sandboxAttempt, saved);
      return saved;
    },
    delete: async () => {},
    execution: {
      restoring: async () => {
        executionStates.push("restoring");
      },
      active: async () => {
        executionStates.push("active");
      },
      finalizing: async () => {
        executionStates.push("finalizing");
      },
      finalizationFailed: async () => {
        executionStates.push("finalization-failed");
      },
      releasing: async (_scope, error) => {
        executionStates.push(error == null ? "releasing" : "release-failed");
      },
      released: async () => {
        executionStates.push("released");
      },
    },
  };
  return {
    deps,
    client,
    calls,
    executionStates,
    imported,
    importedPaths,
    conditionalUploads,
    conditionalDeletes,
  };
}

test("lazy run allocation is single-flight; original binary bytes survive import and explicit publication", async () => {
  const f = fixture();
  const run = new RunSandbox(context, f.deps);
  assert.equal(f.calls.length, 0);
  await Promise.all([run.runAttempt(attempt(), { command: "one" }), run.runAttempt(attempt(), { command: "two" })]);
  assert.equal(f.calls.filter((c) => c === "create").length, 1);
  assert.deepEqual(f.imported, []);
  await run.refresh();
  assert.deepEqual(f.imported, [bytes]);
  assert.ok(!f.calls.includes("publish"));
  const saved = await run.save("/workspace/outputs/output.bin", "save");
  assert.equal(saved.file_id, "saved");
  assert.deepEqual(f.calls.slice(-2), ["upload", "publish"]);
  await Promise.all([run.dispose(), run.dispose()]);
  assert.equal(f.calls.filter((c) => c === "destroy").length, 1);
  assert.deepEqual(f.executionStates, ["restoring", "active", "finalizing", "releasing", "released"]);
});

test("command timeout remains the primary result until finalization snapshots the workspace", async () => {
  const f = fixture();
  let requestedTimeout = 0;
  f.client.start = async (_id, input) => {
    requestedTimeout = input.timeout_ms;
    return {
      session_id: "timed-out",
      stdout: "partial evidence",
      stderr: "",
      termination: { type: "timeout", timeout_ms: 10_000 },
      stdout_offset: 16,
      stderr_offset: 0,
      truncated: false,
    };
  };
  const run = new RunSandbox(context, f.deps);

  const result = await run.runAttempt(attempt(), { command: "slow", timeoutMs: 10_000 });

  assert.equal(requestedTimeout, 10_000);
  assert.deepEqual(result, {
    type: "timeout",
    stdout: "partial evidence",
    stderr: "",
    timeoutMs: 10_000,
    outputMetadata: {
      stdout: { totalBytes: 16, truncated: false },
      stderr: { totalBytes: 0, truncated: false },
    },
  });
  assert.equal(f.calls.includes("destroy"), false);
  await run.dispose();
  assert.equal(f.calls.includes("destroy"), true);
  assert.deepEqual(f.executionStates.slice(-3), ["finalizing", "releasing", "released"]);
});

test("user saves are reported once at the next controlled model step", async () => {
  const f = fixture();
  const base: SessionFile = {
    id: "file",
    session_id: "c",
    filename: "notes.md",
    workspace_path: "/workspace/notes.md",
    workspace_state: "live" as const,
    path_generation: 1,
    title: "Notes",
    mime_type: "text/markdown",
    size: 4,
    asset_id: "asset",
    revision_id: "revision",
    sha256: "old",
    editable: true,
    edit_max_bytes: 2_097_152,
    etag: '"11111111111111111111111111111111"',
    last_writer: { type: "agent" as const, id: "old" },
    created_at: "now",
    updated_at: "now",
  };
  let files: SessionFile[] = [base];
  f.deps.files = async () => files;
  const run = new RunSandbox(context, f.deps);
  await run.observeWorkspaceBaseline();
  files = [
    {
      ...base,
      etag: '"22222222222222222222222222222222"',
      last_writer: { type: "user" as const, id: "u" },
      updated_at: "later",
    },
  ];
  assert.deepEqual(await run.consumeExternalFileChanges(), [{ path: "/workspace/notes.md", writer: "u" }]);
  assert.deepEqual(await run.consumeExternalFileChanges(), []);
});

test("Stop during provisioning waits for creation then deletes it without executing a command", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.client.create = async () => {
    f.calls.push("create");
    await gate;
    return { id: "sandbox", workdir: "/workspace/work", expires_at: "later" };
  };
  const stop = new AbortController();
  const run = new RunSandbox(context, f.deps, stop.signal);
  const pending = run.runAttempt(attempt(), { command: "never" });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  stop.abort();
  release();
  await rejected;
  await run.dispose();
  assert.deepEqual(f.calls, ["create", "destroy"]);
  assert.deepEqual(f.executionStates, ["restoring", "releasing", "released"]);
});

test("attachment scope failures destroy partial initialization; foreign process sessions never execute", async () => {
  const f = fixture();
  f.deps.documents = async () => [{ ...document, workspace_id: "other" }];
  const run = new RunSandbox(context, f.deps);
  await assert.rejects(run.refresh(), /scope mismatch/);
  assert.deepEqual(f.calls, ["create", "destroy"]);
});

test("command continuation consumes output offsets and preserves streamed output", async () => {
  const f = fixture();
  const run = new RunSandbox(context, f.deps);
  const result = await run.runAttempt(attempt(), { command: "cat" });
  assert.equal(result.stdout, "firstsecond");
  await run.dispose();
});

test("command results preserve absolute output cursors and per-stream retention loss", async () => {
  const f = fixture();
  f.client.start = async () => ({
    session_id: "truncated",
    stdout: "retained stdout tail",
    stderr: "stderr",
    termination: { type: "exit", exit_code: 0 },
    stdout_offset: 100_000,
    stderr_offset: 6,
    truncated: true,
    stdout_truncated: true,
    stderr_truncated: false,
  });
  const run = new RunSandbox(context, f.deps);

  const result = await run.runAttempt(attempt(), { command: "large-output" });

  assert.deepEqual(result.outputMetadata, {
    stdout: { totalBytes: 100_000, truncated: true },
    stderr: { totalBytes: 6, truncated: false },
  });
  await run.dispose();
});

test("official SDK file methods preserve bytes and keep source snapshots read-only", async () => {
  const f = fixture();
  const run = new RunSandbox(context, f.deps);
  await run.writeBinaryFile({ path: "/workspace/work/data.bin", content: bytes });
  assert.deepEqual(f.imported.at(-1), bytes);
  assert.deepEqual(await run.readBinaryFile({ path: "/workspace/work/data.bin" }), bytes);
  await assert.rejects(run.writeTextFile({ path: "/workspace/sources/data.txt", content: "blocked" }), /cannot target/);
  await run.dispose();
});

test("file existence checks use the portable test operand form", async () => {
  const f = fixture();
  f.client.start = async (_id, input) => ({
    session_id: "portable-test",
    stdout: "",
    stderr: input.command.includes("test -f --") ? "test: --: binary operator expected" : "",
    termination: { type: "exit", exit_code: input.command.includes("test -f --") ? 2 : 0 },
    stdout_offset: 0,
    stderr_offset: input.command.includes("test -f --") ? 32 : 0,
    truncated: false,
  });
  const run = new RunSandbox(context, f.deps);

  assert.deepEqual(await run.readBinaryFile({ path: "/workspace/work/data.bin" }), bytes);
  await run.dispose();
});

test("a failed helper operation does not dispose the run-scoped workspace", async () => {
  const f = fixture();
  let starts = 0;
  f.client.start = async () => {
    starts++;
    if (starts === 1) throw new Error("file inspection transport failed");
    return {
      session_id: "recovered",
      stdout: "ok",
      stderr: "",
      termination: { type: "exit", exit_code: 0 },
      stdout_offset: 2,
      stderr_offset: 0,
      truncated: false,
    };
  };
  const run = new RunSandbox(context, f.deps);

  await assert.rejects(run.readBinaryFile({ path: "/workspace/work/data.bin" }), /transport failed/);
  assert.equal(f.calls.includes("destroy"), false);
  assert.deepEqual(await run.runAttempt(attempt(), { command: "continue" }), {
    type: "exit",
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    outputMetadata: {
      stdout: { totalBytes: 2, truncated: false },
      stderr: { totalBytes: 0, truncated: false },
    },
  });
  await run.dispose();
});

test("direct text mutations preserve create, overwrite, delete, and CAS conditions through the cloud adapter", async () => {
  const f = fixture();
  f.deps.documents = async () => [];
  f.deps.files = async () => [];
  const run = new RunSandbox(context, f.deps);
  const firstHash = "a".repeat(64);

  const created = await run.writeTextFileConditional({
    path: "/workspace/work/notes.txt",
    content: "first",
    mode: "create",
  });
  const overwritten = await run.writeTextFileConditional({
    path: "/workspace/work/notes.txt",
    content: "second",
    mode: "overwrite",
    expectedSha256: firstHash,
  });
  await run.deleteTextFile({ path: "/workspace/work/notes.txt", expectedSha256: overwritten.sha256 });

  assert.equal(created.created, true);
  assert.equal(overwritten.created, false);
  assert.deepEqual(
    f.conditionalUploads.map(({ path, content, conditions }) => ({
      path,
      content: new TextDecoder().decode(content),
      conditions,
    })),
    [
      { path: "work/notes.txt", content: "first", conditions: { mode: "create" } },
      {
        path: "work/notes.txt",
        content: "second",
        conditions: { mode: "overwrite", expectedSha256: firstHash },
      },
    ],
  );
  assert.deepEqual(f.conditionalDeletes, [{ path: "work/notes.txt", expectedSha256: overwritten.sha256 }]);
  await run.dispose();
});

test("cloud direct text mutations surface stale-content conflicts instead of falling back to an unconditional write", async () => {
  const f = fixture();
  f.deps.documents = async () => [];
  f.deps.files = async () => [];
  const run = new RunSandbox(context, f.deps);
  await run.ensure();
  f.client.upload = async () => {
    throw Object.assign(new Error("sandbox file changed"), { status: 409 });
  };

  await assert.rejects(
    run.writeTextFileConditional({
      path: "/workspace/work/notes.txt",
      content: "stale",
      mode: "overwrite",
      expectedSha256: "b".repeat(64),
    }),
    /sandbox file changed/,
  );
  await run.dispose();
});

test("AI SDK 7 stat, directory listing, and deletion use the same sandbox boundary", async () => {
  const f = fixture();
  const responses = [
    { stdout: "file\n5\n", exitCode: 0 },
    { stdout: "entry.txt\0f\0folder\0d\0shortcut\0l\0", exitCode: 0 },
    { stdout: "", exitCode: 0 },
    { stdout: "", exitCode: 44 },
  ];
  f.client.start = async () => {
    const response = responses.shift();
    assert.ok(response);
    return {
      session_id: "process",
      stdout: response.stdout,
      stderr: "",
      termination: { type: "exit", exit_code: response.exitCode },
      stdout_offset: response.stdout.length,
      stderr_offset: 0,
      truncated: false,
    };
  };
  const run = new RunSandbox(context, f.deps);
  assert.deepEqual(await run.stat({ path: "/workspace/work/entry.txt" }), { type: "file", size: 5 });
  assert.deepEqual(await run.listDirectory({ path: "/workspace/work" }), [
    { name: "entry.txt", type: "file" },
    { name: "folder", type: "directory" },
    { name: "shortcut", type: "symlink" },
  ]);
  assert.equal(await run.deleteFile({ path: "/workspace/work/entry.txt" }), true);
  assert.equal(await run.stat({ path: "/workspace/work/missing.txt" }), null);
  await assert.rejects(run.deleteFile({ path: "/workspace/sources/entry.txt" }), /cannot target/);
  await run.dispose();
});

test("refresh imports and reports only session sources added or updated after initial Bash hydration", async () => {
  const f = fixture();
  let documents = [document];
  f.deps.documents = async () => documents;
  const run = new RunSandbox(context, f.deps);

  await run.refresh();
  documents = [
    document,
    {
      ...document,
      id: "generated-image",
      filename: "generated.png",
      asset_id: "generated-asset",
      source_revision_id: "generated-revision",
    },
  ];

  const refreshed = await run.refresh();
  assert.deepEqual(f.importedPaths, [
    "sources/documents/doc/测试.bin",
    "sources/documents/generated-image/generated.png",
  ]);
  assert.deepEqual(refreshed, {
    sources: [{ path: "/workspace/sources/documents/generated-image/generated.png", document_id: "generated-image" }],
  });

  documents = documents.map((entry) =>
    entry.id === "generated-image" ? { ...entry, source_revision_id: "generated-revision-2" } : entry,
  );
  const [firstRefresh, concurrentRefresh] = await Promise.all([run.refresh(), run.refresh()]);
  const updated = {
    sources: [{ path: "/workspace/sources/documents/generated-image/generated.png", document_id: "generated-image" }],
  };
  assert.deepEqual(firstRefresh, updated);
  assert.deepEqual(concurrentRefresh, updated);
  assert.deepEqual(f.importedPaths, [
    "sources/documents/doc/测试.bin",
    "sources/documents/generated-image/generated.png",
    "sources/documents/generated-image/generated.png",
  ]);
  await run.dispose();
});

test("an SDK helper timeout leaves its owning workspace available for the next command", async () => {
  const f = fixture();
  f.client.start = async () => ({
    session_id: "timed-out",
    termination: { type: "timeout", timeout_ms: 120_000 },
    stdout: "",
    stderr: "",
    stdout_offset: 0,
    stderr_offset: 0,
    truncated: false,
  });
  const run = new RunSandbox(context, f.deps);
  const child = await run.spawn({ command: "slow" });
  assert.deepEqual(await child.wait(), { exitCode: 124 });
  assert.equal((await run.ensure()).id, "sandbox");
  assert.ok(!f.calls.includes("destroy"));
  await run.dispose();
});

test("official SDK spawn streams raw bytes and writes ordered binary stdin through EOF", async () => {
  const f = fixture();
  let complete!: () => void;
  const eof = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let received = Buffer.alloc(0);
  const proc = {
    session_id: "child",
    stdout_offset: 0,
    stderr_offset: 0,
    stdout: "",
    stderr: "",
    termination: null,
    truncated: false,
  };
  f.client.start = async (_id, input) => {
    assert.ok(input.binary_io);
    return proc;
  };
  f.client.write = async (_id, _processId, input) => {
    if (input.stdin_base64) received = Buffer.concat([received, Buffer.from(input.stdin_base64, "base64")]);
    if (input.close_stdin) complete();
    if (input.close_stdin || input.stdin_base64) return proc;
    await eof;
    return {
      ...proc,
      stdout: received.toString("base64"),
      stdout_offset: received.length,
      termination: { type: "exit", exit_code: 0 },
    };
  };
  const run = new RunSandbox(context, f.deps);
  const process = await run.spawn({ command: "cat", stdin: true });
  const writer = process.stdin.getWriter();
  await writer.write(bytes);
  await writer.close();
  const [stdout, stderr, status] = await Promise.all([
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
    process.wait(),
  ]);
  assert.deepEqual(new Uint8Array(stdout), bytes);
  assert.equal(stderr, "");
  assert.deepEqual(status, { exitCode: 0 });
  await run.dispose();
});

test("failed exports are never registered as artifacts, and later runs import persisted sources afresh", async () => {
  const f = fixture();
  f.client.download = async () =>
    new ReadableStream({
      start(c) {
        c.enqueue(bytes);
        c.error(new Error("truncated"));
      },
    });
  const run = new RunSandbox(context, f.deps);
  await run.refresh();
  await assert.rejects(run.save("/workspace/outputs/x", "a"), /truncated/);
  assert.ok(!f.calls.includes("publish"));
  await run.dispose();
  const next = new RunSandbox({ ...context, runId: "next" }, f.deps);
  await next.refresh();
  await next.runAttempt(attempt(), { command: "cat" });
  assert.deepEqual(f.imported, [bytes, bytes]);
  await next.dispose();
});

test("attachments without a migrated Storage revision fail and clean up the sandbox", async () => {
  const f = fixture();
  f.deps.documents = async () => [{ ...document, asset_id: null, source_revision_id: null, content_md: "legacy body" }];
  const run = new RunSandbox(context, f.deps);
  await assert.rejects(run.refresh(), /no Storage revision/);
  assert.deepEqual(f.imported, []);
  assert.deepEqual(f.calls, ["create", "destroy"]);
});

test("Runtime-owned saved files import exact Storage bytes including trailing newlines", async () => {
  const f = fixture();
  f.deps.documents = async () => [];
  f.deps.files = async () => [
    {
      id: "file",
      session_id: "c",
      title: "Notes",
      filename: "notes.md",
      workspace_path: "/workspace/notes.md",
      workspace_state: "live" as const,
      path_generation: 1,
      mime_type: "text/markdown",
      size: 11,
      asset_id: "asset",
      revision_id: "revision",
      sha256: "sha",
      editable: true,
      edit_max_bytes: 2097152,
      etag: '"11111111111111111111111111111111"',
      last_writer: { type: "agent" as const, id: "old" },
      created_at: "now",
      updated_at: "now",
    },
  ];
  const original = new TextEncoder().encode("# Notes\r\n\n");
  const storage = f.deps.asset();
  storage.content = async () => new Blob([original]).stream();
  f.deps.asset = () => storage;
  const run = new RunSandbox(context, f.deps);
  await run.refresh();
  assert.deepEqual(f.imported[0], original);
  assert.match(new TextDecoder().decode(f.imported[1]), /11111111111111111111111111111111/);
  await run.dispose();
});

test("session input bytes are available on the first tool call and survive an empty output snapshot", async () => {
  const f = fixture();
  const path = "/workspace/sources/attachments/upload/report.bin";
  f.deps.documents = async () => assert.fail("ordinary uploads are independent of Knowledge");
  f.deps.recordCheckout = async () => assert.fail("read-only inputs must stay out of the output checkout");
  f.deps.files = async () => [
    {
      id: "input",
      session_id: "c",
      title: "report.bin",
      filename: "report.bin",
      workspace_path: path,
      workspace_state: "live",
      path_generation: 1,
      mime_type: "application/octet-stream",
      size: bytes.length,
      asset_id: "asset",
      revision_id: "revision",
      sha256: "sha",
      editable: false,
      edit_max_bytes: 0,
      etag: "etag",
      last_writer: { type: "user", id: "u" },
      created_at: "now",
      updated_at: "now",
    },
  ];
  const run = new RunSandbox(context, f.deps);
  await run.runAttempt(attempt(), { command: "cat" });
  assert.equal(f.importedPaths[0], "sources/attachments/upload/report.bin");
  assert.deepEqual(f.imported[0], bytes);
  await assert.rejects(run.save(path, "save"), /imported sources/);
  await run.dispose();
  assert.ok(!f.calls.includes("publish"));
});

test("agent updates preserve file identity, use the imported revision and advance only that work copy baseline", async () => {
  const f = fixture();
  const original = new TextEncoder().encode("old\n");
  const updated = new TextEncoder().encode("new\n");
  f.deps.documents = async () => [];
  f.deps.files = async () => [
    {
      id: "file",
      session_id: "c",
      title: "Notes",
      filename: "notes.md",
      workspace_path: "/workspace/notes.md",
      workspace_state: "live" as const,
      path_generation: 1,
      mime_type: "text/markdown",
      size: original.byteLength,
      asset_id: "asset",
      revision_id: "revision",
      sha256: "old",
      editable: true,
      edit_max_bytes: 2097152,
      etag: '"11111111111111111111111111111111"',
      last_writer: { type: "agent", id: "old" },
      created_at: "now",
      updated_at: "now",
    },
  ];
  const storage = f.deps.asset();
  storage.content = async () => new Blob([original]).stream();
  storage.appendRevision = async (input) => {
    assert.deepEqual(new Uint8Array(await new Response(input.body).arrayBuffer()), updated);
    assert.equal(input.assetId, "asset");
    assert.equal(input.baseRevisionId, "revision");
    assert.equal(input.ownerId, "file");
    assert.equal(input.generation, 1);
    return {
      assetId: "asset",
      revisionId: "new-revision",
      filename: "notes.md",
      mediaType: "text/markdown",
      sizeBytes: updated.byteLength,
      sha256: "7aa7a5359173d05b63cfd682e3c38487f3cb4f7f1d60659fe59fab1505977d4c",
    };
  };
  f.deps.asset = () => storage;
  f.client.download = async () => new Blob([updated]).stream();
  const run = new RunSandbox(context, f.deps);
  await run.refresh();
  const saved = await run.save("/workspace/notes.md", "save-update");
  assert.equal(saved.file_id, "file");
  assert.equal(saved.etag, '"22222222222222222222222222222222"');
  f.deps.update = async (input) => {
    assert.equal(input.expectedEtag, saved.etag);
    assert.equal(input.expectedPathGeneration, 1);
    throw new Error("concurrent workspace edit");
  };
  await assert.rejects(run.save("/workspace/notes.md", "stale-update"), /concurrent workspace edit/);
  await assert.rejects(run.save("/workspace/sources/x", "source"), /imported sources/);
  await run.dispose();
});

test("finalization retains the guest if Storage returns bytes different from the frozen snapshot", async () => {
  const f = fixture();
  f.deps.documents = async () => [];
  f.client.snapshot = async () => ({
    files: [{ path: "draft.txt", size: bytes.length, sha256: "a".repeat(64) }],
  });
  const run = new RunSandbox(context, f.deps);
  await run.runAttempt(attempt(), { command: "create draft" });
  await assert.rejects(run.dispose(), /snapshot/i);
  assert.equal(f.calls.includes("publish"), false);
  assert.equal(f.calls.includes("destroy"), false);
  assert.equal(f.executionStates.at(-1), "finalization-failed");
});

test("run finalization automatically persists new workspace files before destroying compute", async () => {
  const f = fixture();
  f.deps.documents = async () => [];
  f.client.snapshot = async () => ({
    files: [{ path: "draft.txt", size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }],
  });
  const run = new RunSandbox(context, f.deps);
  await run.runAttempt(attempt(), { command: "create draft" });
  await run.dispose();
  assert.ok(f.calls.indexOf("upload") < f.calls.indexOf("publish"));
  assert.ok(f.calls.indexOf("publish") < f.calls.indexOf("destroy"));
  assert.deepEqual(f.executionStates, ["restoring", "active", "finalizing", "releasing", "released"]);
});

test("run finalization records deletion tombstones before destroying compute", async () => {
  const f = fixture();
  f.deps.documents = async () => [];
  f.deps.files = async () => [
    {
      id: "file",
      session_id: "c",
      title: "Notes",
      filename: "notes.md",
      workspace_path: "/workspace/notes.md",
      workspace_state: "live",
      path_generation: 1,
      mime_type: "text/markdown",
      size: 4,
      asset_id: "asset",
      revision_id: "revision",
      sha256: "old",
      editable: true,
      edit_max_bytes: 2097152,
      etag: '"11111111111111111111111111111111"',
      last_writer: { type: "agent", id: "old" },
      created_at: "now",
      updated_at: "now",
    },
  ];
  f.client.snapshot = async () => ({ files: [] });
  f.deps.delete = async () => {
    f.calls.push("delete");
  };
  const run = new RunSandbox(context, f.deps);
  await run.runAttempt(attempt(), { command: "delete notes" });
  await run.dispose();
  assert.ok(f.calls.indexOf("delete") < f.calls.indexOf("destroy"));
});

test("failed workspace persistence retains compute for durable finalization retry", async () => {
  const f = fixture();
  f.deps.documents = async () => [];
  f.client.snapshot = async () => {
    throw new Error("Storage unavailable");
  };
  const run = new RunSandbox(context, f.deps);
  await run.runAttempt(attempt(), { command: "write draft" });
  await assert.rejects(run.dispose(), /Storage unavailable/);
  assert.ok(!f.calls.includes("destroy"));
  assert.deepEqual(f.executionStates, ["restoring", "active", "finalizing", "finalization-failed"]);
});

test("missing sandbox cleanup is terminal instead of retrying an impossible snapshot", async () => {
  const f = fixture();
  f.deps.documents = async () => [];
  f.client.snapshot = async () => {
    throw Object.assign(new Error("runtime-sandbox snapshot failed: 404"), {
      service: "runtime-sandbox",
      status: 404,
      body: { code: "sandbox_not_found", message: "sandbox-run no longer exists" },
    });
  };
  f.client.destroy = async () => {
    f.calls.push("destroy");
    throw Object.assign(new Error("runtime-sandbox destroy failed: 404"), {
      service: "runtime-sandbox",
      status: 404,
      body: { code: "sandbox_not_found", message: "sandbox-run no longer exists" },
    });
  };
  const run = new RunSandbox(context, f.deps);
  await run.runAttempt(attempt(), { command: "write draft" });

  await assert.rejects(run.dispose(), /snapshot failed/);
  assert.ok(f.calls.includes("destroy"));
  assert.deepEqual(f.executionStates, ["restoring", "active", "finalizing", "release-failed", "released"]);
});

test("a rejected reservation cannot release a guest belonging to an existing lease", async () => {
  const f = fixture();
  f.deps.execution.restoring = async () => {
    throw new Error("reservation exists");
  };
  const run = new RunSandbox(context, f.deps);
  await assert.rejects(run.ensure(), /reservation exists/);
  await run.dispose();
  assert.ok(!f.calls.includes("destroy"));
});

test("a closing guest cannot tombstone files it never checked out", async () => {
  const f = fixture();
  f.deps.documents = async () => [];
  const run = new RunSandbox(context, f.deps);
  await run.ensure();
  f.deps.files = async () => [
    {
      id: "file",
      session_id: "c",
      title: "Notes",
      filename: "notes.md",
      workspace_path: "/workspace/notes.md",
      workspace_state: "live",
      path_generation: 1,
      mime_type: "text/markdown",
      size: 4,
      asset_id: "asset",
      revision_id: "revision",
      sha256: "old",
      editable: true,
      edit_max_bytes: 2097152,
      etag: '"11111111111111111111111111111111"',
      last_writer: { type: "agent", id: "old" },
      created_at: "now",
      updated_at: "now",
    },
  ];
  f.deps.delete = async () => assert.fail("attempt did not observe this file");
  await run.dispose();
});

test("finalization recovers a native output staged before the checkout write failed", async () => {
  const f = fixture();
  const run = new RunSandbox(context, f.deps);
  await run.ensure();
  const file: SessionFile = {
    id: "published",
    session_id: "c",
    title: "image",
    filename: "image.bin",
    workspace_path: "/workspace/outputs/r/1/image.bin",
    workspace_state: "live",
    path_generation: 1,
    mime_type: "application/octet-stream",
    size: bytes.length,
    asset_id: "a",
    revision_id: "rev",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    editable: false,
    edit_max_bytes: 0,
    etag: "e",
    last_writer: { type: "agent", id: "r" },
    created_at: "now",
    updated_at: "now",
  };
  f.deps.files = async () => [file];
  f.deps.recordCheckout = async () => {
    throw new Error("checkout write interrupted");
  };
  await assert.rejects(run.stagePublishedFile(file, bytes), /checkout write interrupted/);
  f.client.snapshot = async () => ({
    files: [{ path: "outputs/r/1/image.bin", size: file.size, sha256: file.sha256 }],
  });
  await run.dispose();
  assert.equal(f.calls.includes("publish"), false);
  assert.equal(f.calls.includes("upload"), false);
  assert.equal(f.calls.includes("destroy"), true);
});
