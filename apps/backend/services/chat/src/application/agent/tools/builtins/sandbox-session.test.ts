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
    upload: async (_id, _scope, _path, body) => {
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
          url: "",
        };
      },
    }),
    documents: async () => [document],
    files: async () => [],
    publish: async () => {
      calls.push("publish");
      return { ...document, id: "saved", filename: "output.bin" };
    },
  };
  return { deps, client, calls, imported };
}

test("lazy run allocation is single-flight; original binary bytes survive import and explicit publication", async () => {
  const f = fixture();
  const run = new RunSandbox(f.deps);
  assert.equal(f.calls.length, 0);
  await Promise.all([run.start({ command: "one" }, context, "a"), run.start({ command: "two" }, context, "b")]);
  assert.equal(f.calls.filter((c) => c === "create").length, 1);
  assert.deepEqual(f.imported, [bytes]);
  assert.ok(!f.calls.includes("publish"));
  const saved = await run.save(
    { path: "outputs/output.bin", filename: "output.bin", media_type: "application/octet-stream", title: "Output" },
    context,
    "save",
  );
  assert.equal(saved.document_id, "saved");
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
  const run = new RunSandbox(f.deps);
  const stop = new AbortController();
  const pending = run.start({ command: "never" }, context, "a", stop.signal);
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
  const run = new RunSandbox(f.deps);
  await assert.rejects(run.start({ command: "never" }, context, "a"), /scope mismatch/);
  assert.deepEqual(f.calls, ["create", "destroy"]);
  const g = fixture();
  const fresh = new RunSandbox(g.deps);
  await assert.rejects(fresh.write({ session_id: "foreign" }, context, "b"), /does not belong/);
  assert.deepEqual(g.calls, []);
  await fresh.dispose();
});

test("continuations consume output offsets and context identity cannot change within a run", async () => {
  const f = fixture();
  const run = new RunSandbox(f.deps);
  await run.start({ command: "cat" }, context, "a");
  const result = await run.write({ session_id: "process", chars: "hello\n" }, context, "b");
  assert.equal(result.stdout, "second");
  await assert.rejects(run.start({ command: "x" }, { ...context, runId: "other" }, "c"), /context mismatch/);
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
  const run = new RunSandbox(f.deps);
  await assert.rejects(
    run.save({ path: "outputs/x", filename: "x", media_type: "application/octet-stream", title: "X" }, context, "a"),
    /truncated/,
  );
  assert.ok(!f.calls.includes("publish"));
  await run.dispose();
  const next = new RunSandbox(f.deps);
  await next.start({ command: "cat" }, { ...context, runId: "next" }, "b");
  assert.deepEqual(f.imported, [bytes, bytes]);
  await next.dispose();
});

test("attachments without a migrated Storage revision fail and clean up the sandbox", async () => {
  const f = fixture();
  f.deps.documents = async () => [{ ...document, asset_id: null, source_revision_id: null, content_md: "legacy body" }];
  const run = new RunSandbox(f.deps);
  await assert.rejects(run.load(context), /no Storage revision/);
  assert.deepEqual(f.imported, []);
  assert.deepEqual(f.calls, ["create", "destroy"]);
});

test("virtual file imports preserve exact stored bytes including trailing newlines", async () => {
  const f = fixture();
  f.deps.documents = async () => [];
  f.deps.files = async () => [
    { path: "notes.md", asset_id: "asset", revision_id: "revision", writable: true } as Awaited<
      ReturnType<SandboxDependencies["files"]>
    >[number],
  ];
  const original = new TextEncoder().encode("# Notes\r\n\n");
  const storage = f.deps.asset();
  storage.content = async () => new Blob([original]).stream();
  f.deps.asset = () => storage;
  const run = new RunSandbox(f.deps);
  await run.load(context);
  assert.deepEqual(f.imported, [original]);
  await run.dispose();
});
