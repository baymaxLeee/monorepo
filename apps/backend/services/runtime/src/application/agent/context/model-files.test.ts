import assert from "node:assert/strict";
import test from "node:test";

import { InnerApiError } from "@backend/inner-api/client";
import { convertToModelMessages, type UIMessage } from "ai";

import type { SessionFile } from "../../session-files.js";
import { transformFilePartsForModel } from "./model-files.js";

const context = {
  userId: "user",
  tenantId: "tenant",
  workspaceId: "workspace",
  sessionId: "session",
  supportsImageInput: true,
  signal: new AbortController().signal,
};
const url = "/api/chat-server/sessions/session/documents/doc/content?document_id=doc";
const fileUrl = "/api/chat-server/sessions/session/files/file/content";

test("assistant files and reasoning files replay through the real SDK without changing the journal", async () => {
  const messages: UIMessage[] = [
    {
      id: "assistant",
      role: "assistant",
      parts: [
        {
          type: "file",
          mediaType: "image/png",
          url,
          filename: "result.png",
          providerMetadata: { test: { itemId: "item" } },
        },
        { type: "reasoning-file", mediaType: "image/png", url },
      ],
    },
  ];
  const journal = structuredClone(messages);
  let reads = 0;
  const projected = await transformFilePartsForModel(messages, context, async (userId, documentId, options) => {
    assert.equal(userId, context.userId);
    assert.equal(documentId, "doc");
    assert.equal(options?.sessionId, context.sessionId);
    assert.equal(options?.signal, context.signal);
    assert.equal(options?.maxDim, 1536);
    reads++;
    return { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
  });
  assert.equal(reads, 1);
  assert.deepEqual(messages, journal);
  const model = await convertToModelMessages(projected);
  assert.equal(model[0]?.role, "assistant");
  assert.equal(model[0]?.content.length, 2);
  assert.deepEqual(projected[0]?.parts[0], { ...messages[0]!.parts[0], url: "data:image/png;base64,AQID" });
});

test("user-controlled provider references are rejected before SDK model projection", async () => {
  const messages: UIMessage[] = [
    {
      id: "user",
      role: "user",
      parts: [
        {
          type: "file",
          mediaType: "image/png",
          url,
          providerReference: { provider: "untrusted-reference" },
        },
      ],
    },
  ];
  await assert.rejects(
    transformFilePartsForModel(messages, context, async () => {
      assert.fail("untrusted provider references must not bypass the authorized document read");
    }),
    /provider reference/,
  );
});

const file: SessionFile = {
  id: "file",
  session_id: "session",
  title: "note.txt",
  filename: "note.txt",
  workspace_path: "/workspace/sources/attachments/transfer/note.txt",
  workspace_state: "live",
  path_generation: 1,
  mime_type: "text/plain",
  size: 5,
  asset_id: "asset",
  revision_id: "revision",
  sha256: "sha",
  editable: false,
  edit_max_bytes: 100,
  etag: "etag",
  last_writer: { type: "user", id: "user" },
  created_at: "",
  updated_at: "",
};
test("user files are resolved in scope, read through workspace tools, and kept as native parts in history", async () => {
  const messages: UIMessage[] = [
    { id: "user", role: "user", parts: [{ type: "file", mediaType: "image/png", url: fileUrl }] },
  ];
  const projected = await transformFilePartsForModel(
    messages,
    context,
    undefined,
    async () => assert.fail("text file bytes must stay out of the prompt"),
    undefined,
    async (scope, id, fileId) => {
      assert.equal(scope.userId, "user");
      assert.equal(id, "session");
      assert.equal(fileId, "file");
      return file;
    },
  );
  const part = projected[0]?.parts[0];
  assert.ok(part?.type === "text");
  assert.match(part.text, /sources\/attachments\/transfer\/note.txt/);
  assert.equal(messages[0]?.parts[0]?.type, "file");
  await assert.rejects(
    transformFilePartsForModel(messages, context, undefined, undefined, undefined, async () => {
      throw new Error("denied");
    }),
    /denied/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(transformFilePartsForModel(messages, { ...context, signal: abort.signal }), {
    name: "AbortError",
  });
});
test("model image input reads the authorized attachment revision and retains the stable replay reference", async () => {
  const messages: UIMessage[] = [
    { id: "user", role: "user", parts: [{ type: "file", mediaType: "image/png", url: fileUrl }] },
  ];
  const result = await transformFilePartsForModel(
    messages,
    context,
    undefined,
    async (scope, source, maxDim) => {
      assert.equal(source.revision_id, "revision");
      assert.equal(maxDim, 1536);
      assert.equal(scope.signal, context.signal);
      return { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };
    },
    undefined,
    async () => ({ ...file, mime_type: "image/png" }),
  );
  assert.deepEqual(result[0]?.parts[0], { type: "file", url: "data:image/jpeg;base64,AQID", mediaType: "image/jpeg" });
  const original = messages[0]?.parts[0];
  assert.ok(original?.type === "file");
  assert.equal(original.url, fileUrl);
});
test("assistant session files read exact Storage bytes without Knowledge", async () => {
  const messages: UIMessage[] = [
    { id: "assistant", role: "assistant", parts: [{ type: "file", mediaType: "text/plain", url: fileUrl }] },
  ];
  const projected = await transformFilePartsForModel(
    messages,
    context,
    async () => {
      assert.fail("Chat files must not read through Knowledge");
    },
    async (scope, source, maxDim) => {
      assert.equal(scope.tenantId, "tenant");
      assert.equal(scope.workspaceId, "workspace");
      assert.equal(source.id, "file");
      assert.equal(maxDim, undefined);
      return { bytes: new TextEncoder().encode("saved"), mimeType: "text/plain" };
    },
    async () => file,
  );
  const projectedPart = projected[0]?.parts[0];
  assert.equal(projectedPart?.type, "file");
  assert.equal((projectedPart as { url?: string }).url, "data:text/plain;base64,c2F2ZWQ=");
});

test("an unsupported image derivative leaves the original available to workspace tools", async () => {
  const messages: UIMessage[] = [
    { id: "user", role: "user", parts: [{ type: "file", mediaType: "image/svg+xml", url: fileUrl }] },
  ];
  const resolve = async () => ({ ...file, mime_type: "image/svg+xml" });
  const project = (code: number) =>
    transformFilePartsForModel(
      messages,
      context,
      undefined,
      async () => {
        throw new InnerApiError(code, "variant unavailable");
      },
      undefined,
      resolve,
    );
  const projected = await project(3);
  const part = projected[0]?.parts[0];
  assert.ok(part?.type === "text");
  assert.match(part.text, /sources\/attachments\/transfer\/note.txt/);
  await assert.rejects(project(14), /variant unavailable/);
});
