import assert from "node:assert/strict";
import test from "node:test";

import { getConversationFile } from "./conversations.js";

const auth = {
  userId: "user",
  username: "user",
  email: "",
  tenantId: "tenant",
  workspaceId: "workspace",
  workspaceRole: "member",
  roles: [],
};

for (const [mime, content] of [
  ["text/html", "<!doctype html><h1>Hi</h1>"],
  ["application/json", '{"value": 1}'],
  ["text/markdown", "# Heading"],
]) {
  test(`file details return the original ${mime} string`, async () => {
    const entry = {
      path: "file",
      asset_id: "asset",
      revision_id: "revision",
      type: "file" as const,
      mime_type: mime,
      size: content.length,
      sha256: "sha",
      writable: true,
      derived: false,
    };
    const result = await getConversationFile(auth, "conversation", "file", {
      getConversationRow: async (input, id) => {
        assert.equal(input, auth);
        assert.equal(id, "conversation");
        return { userId: "user" };
      },
      listVirtualFiles: async () => [entry],
      readVirtualFile: async () => ({ ...entry, content, offset: 1, total_lines: 1, next_offset: null }),
    });
    assert.equal(result.content, content);
    assert.equal(typeof result.content, "string");
  });
}

test("metadata-only file lookup does not read bytes", async () => {
  const result = await getConversationFile(
    auth,
    "conversation",
    "page.html",
    {
      getConversationRow: async () => ({ userId: "user" }),
      listVirtualFiles: async () => [
        {
          path: "page.html",
          type: "file",
          asset_id: "asset",
          revision_id: "revision",
          mime_type: "text/html",
          size: 10000000,
          sha256: "sha",
          writable: true,
          derived: false,
        },
      ],
      readVirtualFile: async () => {
        throw new Error("metadata request must not load content");
      },
    },
    false,
  );
  assert.equal(result.asset_id, "asset");
  assert.equal(result.revision_id, "revision");
  assert.equal(result.content, "");
});
