import { expect, test } from "vitest";

import { buildUserFilePart, conversationFileIdFromFilePart } from "./file-parts";
test("a composed attachment renders using its stable file ID", () => {
  const part = buildUserFilePart({
    conversationId: "chat",
    fileId: "upload",
    filename: "photo.png",
    mimeType: "image/png",
  });
  expect(part.url).toBe("/api/chat-server/conversations/chat/files/upload/content");
  expect(conversationFileIdFromFilePart(part)).toBe("upload");
  expect(conversationFileIdFromFilePart({ ...part, url: "/arbitrary?file_id=upload" })).toBeNull();
});
