import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { coordinateCloudWorkspaceUserEdit, type CloudWorkspaceEditDependencies } from "./cloud-workspace-edit.js";
import type { ConversationFile } from "./conversation-files.js";
import { ConflictError } from "./errors.js";

const oldContent = new TextEncoder().encode("old\n");
const newContent = new TextEncoder().encode("new\n");
const sha = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");
const file: ConversationFile = {
  id: "file",
  conversation_id: "conversation",
  title: "notes",
  filename: "notes.txt",
  workspace_path: "/workspace/notes.txt",
  workspace_state: "live",
  path_generation: 1,
  mime_type: "text/plain",
  size: oldContent.byteLength,
  asset_id: "asset",
  revision_id: "revision",
  sha256: sha(oldContent),
  kind: "artifact",
  editable: true,
  edit_max_bytes: 1_000_000,
  etag: '"0123456789abcdef0123456789abcdef"',
  last_writer: { type: "agent", id: "run" },
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};
const workspace = {
  sandboxId: "sandbox",
  state: "active",
  scope: {
    tenant_id: "tenant",
    workspace_id: "workspace",
    user_id: "user",
    conversation_id: "conversation",
    run_id: "run",
  },
};
const input = {
  userId: "user",
  tenantId: "tenant",
  workspaceId: "workspace",
  conversationId: "conversation",
  fileId: "file",
  expectedEtag: file.etag,
  operationId: "save-1",
  content: newContent,
};

function stream(content: Uint8Array) {
  return new Blob([content]).stream();
}

function fixture(overrides: Partial<CloudWorkspaceEditDependencies> = {}) {
  const events: string[] = [];
  const uploads: Uint8Array[] = [];
  const deps: CloudWorkspaceEditDependencies = {
    active: async () => workspace,
    file: async () => file,
    acquire: async () => {
      events.push("acquire");
    },
    release: async () => {
      events.push("release");
    },
    download: async () => stream(oldContent),
    upload: async (_workspace, _path, content) => {
      events.push("upload");
      uploads.push(content);
    },
    ...overrides,
  };
  return { deps, events, uploads };
}

test("user edit updates the active workspace before committing Storage", async () => {
  const f = fixture();
  const result = await coordinateCloudWorkspaceUserEdit(
    input,
    async () => {
      f.events.push("commit");
      return "saved";
    },
    f.deps,
  );
  assert.equal(result, "saved");
  assert.deepEqual(f.events, ["acquire", "upload", "commit", "release"]);
  assert.deepEqual(f.uploads, [newContent]);
});

test("Storage-only save remains available before a sandbox exists", async () => {
  const f = fixture({ active: async () => null });
  assert.equal(await coordinateCloudWorkspaceUserEdit(input, async () => "saved", f.deps), "saved");
  assert.deepEqual(f.events, []);
});

test("a replay releases its prior fence after the same bytes were already committed", async () => {
  const committed = { ...file, etag: '"22222222222222222222222222222222"', sha256: sha(newContent) };
  const f = fixture({ file: async () => committed, download: async () => stream(newContent) });
  assert.equal(await coordinateCloudWorkspaceUserEdit(input, async () => "saved", f.deps), "saved");
  assert.deepEqual(f.events, ["acquire", "release"]);
});

test("an uncommitted Agent change is never overwritten by a user draft", async () => {
  const f = fixture({ download: async () => stream(new TextEncoder().encode("agent change\n")) });
  let committed = false;
  await assert.rejects(
    coordinateCloudWorkspaceUserEdit(
      input,
      async () => {
        committed = true;
      },
      f.deps,
    ),
    (error: unknown) => error instanceof ConflictError && error.code === "file_content_conflict",
  );
  assert.equal(committed, false);
  assert.deepEqual(f.events, ["acquire", "release"]);
});

test("a failed business commit restores the previous workspace bytes", async () => {
  const f = fixture();
  await assert.rejects(
    coordinateCloudWorkspaceUserEdit(
      input,
      async () => {
        f.events.push("commit");
        throw new Error("storage unavailable");
      },
      f.deps,
    ),
    /storage unavailable/,
  );
  assert.deepEqual(f.events, ["acquire", "upload", "commit", "upload", "release"]);
  assert.deepEqual(f.uploads, [newContent, oldContent]);
});

test("a failed rollback keeps the guest fenced for an idempotent retry", async () => {
  let uploads = 0;
  const f = fixture();
  f.deps.upload = async () => {
    f.events.push("upload");
    uploads++;
    if (uploads === 2) throw new Error("sandbox transport unavailable");
  };
  await assert.rejects(
    coordinateCloudWorkspaceUserEdit(
      input,
      async () => {
        f.events.push("commit");
        throw new Error("storage unavailable");
      },
      f.deps,
    ),
    /storage unavailable/,
  );
  assert.deepEqual(f.events, ["acquire", "upload", "commit", "upload"]);
});

test("restoring and finalizing workspaces preserve the draft for retry", async () => {
  for (const state of ["restoring", "finalizing"]) {
    const f = fixture({ active: async () => ({ ...workspace, state }) });
    await assert.rejects(
      coordinateCloudWorkspaceUserEdit(input, async () => "saved", f.deps),
      (error: unknown) => error instanceof ConflictError && error.code === "workspace_busy",
    );
    assert.deepEqual(f.events, []);
  }
});

test("an active guest process returns workspace_busy without touching bytes", async () => {
  const f = fixture({
    acquire: async () => {
      throw new ConflictError("workspace has an active process", "workspace_busy");
    },
  });
  await assert.rejects(
    coordinateCloudWorkspaceUserEdit(input, async () => "saved", f.deps),
    (error: unknown) => error instanceof ConflictError && error.code === "workspace_busy",
  );
  assert.deepEqual(f.uploads, []);
});
