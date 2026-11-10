import assert from "node:assert/strict";
import test from "node:test";

import { convertToModelMessages, type UIMessage } from "ai";

import { transformFilePartsForModel } from "./model-files.js";

const context = {
  userId: "user",
  conversationId: "conversation",
  supportsImageInput: true,
  signal: new AbortController().signal,
};
const url = "/api/chat-server/conversations/conversation/documents/doc/content?document_id=doc";

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
    assert.equal(options?.conversationId, context.conversationId);
    assert.equal(options?.signal, context.signal);
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

test("file projection propagates access and cancellation failures instead of silently dropping evidence", async () => {
  const messages: UIMessage[] = [{ id: "user", role: "user", parts: [{ type: "file", mediaType: "image/png", url }] }];
  await assert.rejects(
    transformFilePartsForModel(messages, context, async () => {
      throw new Error("not authorized");
    }),
    /not authorized/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    transformFilePartsForModel(messages, { ...context, signal: abort.signal }, async () => {
      assert.fail("aborted projection must not read bytes");
    }),
    { name: "AbortError" },
  );
});

test("text document attachments are model references while the journal keeps native files", async () => {
  const messages: UIMessage[] = [
    { id: "user", role: "user", parts: [{ type: "file", mediaType: "text/plain", filename: "note.txt", url }] },
  ];
  const projected = await transformFilePartsForModel(messages, context, async () => {
    assert.fail("text documents are read through tools");
  });
  assert.equal(projected[0]?.parts[0]?.type, "text");
  assert.equal(messages[0]?.parts[0]?.type, "file");
});
