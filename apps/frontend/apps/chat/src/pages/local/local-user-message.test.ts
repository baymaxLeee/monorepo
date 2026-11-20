import { expect, test } from "vitest";

import { localPromptMessageParts } from "./local-user-message";

test("local prompt keeps text and selected files as native message parts", async () => {
  const file = new File(["hello"], "brief.txt", { type: "text/plain" });
  const token = { id: "brief", kind: "file", label: file.name, mime: file.type };
  await expect(
    localPromptMessageParts({
      text: "检查 [[brief]]",
      segments: [
        { type: "text", text: "检查 " },
        { type: "token", token },
      ],
      tokens: [token],
      files: { brief: file },
    }),
  ).resolves.toEqual([
    { type: "text", text: "检查 " },
    expect.objectContaining({
      type: "file",
      mediaType: "text/plain",
      filename: "brief.txt",
      url: "data:text/plain;base64,aGVsbG8=",
    }),
  ]);
});

test("attachment-only local prompts include an explicit instruction", async () => {
  const file = new File(["hello"], "brief.txt", { type: "text/plain" });
  const token = { id: "brief", kind: "file", label: file.name, mime: file.type };
  const parts = await localPromptMessageParts({
    text: "[[brief]]",
    segments: [{ type: "token", token }],
    tokens: [token],
    files: { brief: file },
  });
  expect(parts.at(-1)).toEqual({ type: "text", text: "请阅读并处理我附加的文件。" });
});
