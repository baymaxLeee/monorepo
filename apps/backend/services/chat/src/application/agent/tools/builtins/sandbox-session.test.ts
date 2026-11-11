import assert from "node:assert/strict";
import test from "node:test";

import type { KnowledgeDocument, SandboxProcess } from "@backend/transport-ts";

import { RunSandbox, type SandboxDependencies } from "./sandbox-session.js";

const context = { tenantId: "t", workspaceId: "w", userId: "u", conversationId: "c", runId: "r" };
const bytes = Uint8Array.from([0, 255, 1, 128, 10]);
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
} as KnowledgeDocument;
function fixture() {
  const calls: string[] = [];
  const imported: Uint8Array[] = [];
  const importedPaths: string[] = [];
  const process: SandboxProcess = {
    session_id: "process",
    stdout: "first",
    stderr: "",
    exitCode: null,
    stdout_offset: 5,
    stderr_offset: 0,
    truncated: false,
    timed_out: false,
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
    upload: async (_id, _scope, path, body) => {
      importedPaths.push(path);
      imported.push(new Uint8Array(await new Response(body).arrayBuffer()));
    },
    download: async () => new Blob([bytes]).stream(),
    start: async () => {
      calls.push("start");
      return process;
    },
    write: async (_id, _session, input) => {
      assert.equal(input.stdout_offset, 5);
      return { ...process, stdout: "second", stdout_offset: 11, exitCode: 0 };
    },
    cancel: async () => ({ ...process, exitCode: 137 }),
  };
  const deps: SandboxDependencies = {
    sandbox: () => client,
    asset: () => ({
      content: async () => new Blob([bytes]).stream(),
      upload: async (input) => {
        assert.ok(input.body instanceof ReadableStream);
        assert.deepEqual(new Uint8Array(await new Response(input.body).arrayBuffer()), bytes);
        calls.push("upload");
        return {
          assetId: "saved",
          revisionId: "rev",
          filename: "output.bin",
          mediaType: "application/octet-stream",
          sizeBytes: 5,
          sha256: "sha",
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
        conversation_id: "c",
        filename: "output.bin",
        title: "Output",
        mime_type: "application/octet-stream",
        size: 5,
        asset_id: "saved",
        revision_id: "rev",
        sha256: "sha",
        kind: "artifact" as const,
        created_at: "now",
        updated_at: "now",
      };
    },
  };
  return { deps, client, calls, imported, importedPaths };
}

test("lazy run allocation is single-flight; original binary bytes survive import and explicit publication", async () => {
  const f = fixture();
  const run = new RunSandbox(context, f.deps);
  assert.equal(f.calls.length, 0);
  await Promise.all([run.run({ command: "one" }), run.run({ command: "two" })]);
  assert.equal(f.calls.filter((c) => c === "create").length, 1);
  assert.deepEqual(f.imported, [bytes]);
  assert.ok(!f.calls.includes("publish"));
  const saved = await run.save(
    {
      path: "/workspace/outputs/output.bin",
      filename: "output.bin",
      media_type: "application/octet-stream",
      title: "Output",
    },
    "save",
  );
  assert.equal(saved.file_id, "saved");
  assert.deepEqual(f.calls.slice(-2), ["upload", "publish"]);
  await Promise.all([run.dispose(), run.dispose()]);
  assert.equal(f.calls.filter((c) => c === "destroy").length, 1);
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
  const run = new RunSandbox(context, f.deps);
  const stop = new AbortController();
  const pending = run.run({ command: "never", abortSignal: stop.signal });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  stop.abort();
  release();
  await rejected;
  await run.dispose();
  assert.deepEqual(f.calls, ["create", "destroy"]);
});

test("attachment scope failures destroy partial initialization; foreign process sessions never execute", async () => {
  const f = fixture();
  f.deps.documents = async () => [{ ...document, workspace_id: "other" }];
  const run = new RunSandbox(context, f.deps);
  await assert.rejects(run.run({ command: "never" }), /scope mismatch/);
  assert.deepEqual(f.calls, ["create", "destroy"]);
});

test("command continuation consumes output offsets and preserves streamed output", async () => {
  const f = fixture();
  const run = new RunSandbox(context, f.deps);
  const result = await run.run({ command: "cat" });
  assert.equal(result.stdout, "firstsecond");
  await run.dispose();
});

test("official SDK file methods preserve bytes and keep source snapshots read-only", async () => {
  const f = fixture();
  const run = new RunSandbox(context, f.deps);
  await run.writeBinaryFile({ path: "/workspace/work/data.bin", content: bytes });
  assert.deepEqual(f.imported.at(-1), bytes);
  assert.deepEqual(await run.readBinaryFile({ path: "/workspace/work/data.bin" }), bytes);
  await assert.rejects(run.writeTextFile({ path: "/workspace/sources/data.txt", content: "blocked" }), /limited/);
  await run.dispose();
});

test("refresh imports and reports only conversation sources added or updated after initial Bash hydration", async () => {
  const f = fixture();
  let documents = [document];
  f.deps.documents = async () => documents;
  const run = new RunSandbox(context, f.deps);

  await run.run({ command: "true" });
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

test("official SDK spawn streams process output and rejects unsupported writable stdin", async () => {
  const f = fixture();
  const run = new RunSandbox(context, f.deps);
  const process = await run.spawn({ command: "printf output" });
  const [stdout, stderr, status] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.wait(),
  ]);
  assert.equal(stdout, "firstsecond");
  assert.equal(stderr, "");
  assert.deepEqual(status, { exitCode: 0 });
  await assert.rejects(run.spawn({ command: "cat", stdin: true }), /not supported/);
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
  await assert.rejects(
    run.save({ path: "/workspace/outputs/x", filename: "x", media_type: "application/octet-stream", title: "X" }, "a"),
    /truncated/,
  );
  assert.ok(!f.calls.includes("publish"));
  await run.dispose();
  const next = new RunSandbox({ ...context, runId: "next" }, f.deps);
  await next.run({ command: "cat" });
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

test("Chat-owned saved files import exact Storage bytes including trailing newlines", async () => {
  const f = fixture();
  f.deps.documents = async () => [];
  f.deps.files = async () => [
    {
      id: "file",
      conversation_id: "c",
      title: "Notes",
      filename: "notes.md",
      mime_type: "text/markdown",
      size: 11,
      asset_id: "asset",
      revision_id: "revision",
      sha256: "sha",
      kind: "artifact",
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
  assert.deepEqual(f.imported, [original]);
  await run.dispose();
});
