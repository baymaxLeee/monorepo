import { expect, test, vi } from "vitest";

import { localPromptMessageParts } from "./local-user-message";

test("local prompt preserves text order and gives ordinary files to the sandbox by path", async () => {
  const file = new File(["hello"], "brief.txt", { type: "text/plain" });
  const token = { id: "brief", kind: "file", label: file.name, mime: file.type };
  const referenceFile = vi.fn().mockResolvedValue("design/brief.txt");
  await expect(
    localPromptMessageParts(
      {
        text: "检查 [[brief]]",
        segments: [
          { type: "text", text: "检查 " },
          { type: "token", token },
        ],
        tokens: [token],
        files: { brief: file },
      },
      referenceFile,
    ),
  ).resolves.toEqual([
    { type: "text", text: "检查 " },
    { type: "text", text: '"design/brief.txt"' },
  ]);
  expect(referenceFile).toHaveBeenCalledWith(file);
});

test("attachment-only local prompts include an explicit instruction", async () => {
  const file = new File(["hello"], "brief.txt", { type: "text/plain" });
  const token = { id: "brief", kind: "file", label: file.name, mime: file.type };
  const parts = await localPromptMessageParts(
    {
      text: "[[brief]]",
      segments: [{ type: "token", token }],
      tokens: [token],
      files: { brief: file },
    },
    async () => "brief.txt",
  );
  expect(parts.at(-1)).toEqual({ type: "text", text: "请阅读并处理我附加的文件。" });
});

test("an image stays inline for vision without requesting a workspace path", async () => {
  const image = new File(["png"], "photo.png", { type: "image/png" });
  const token = { id: "p", kind: "image", label: image.name };
  const referenceFile = vi.fn();
  const parts = await localPromptMessageParts(
    { text: "[[p]]", segments: [{ type: "token", token }], tokens: [token], files: { p: image } },
    referenceFile,
  );
  expect(parts[0]).toEqual({
    type: "file",
    filename: "photo.png",
    mediaType: "image/png",
    url: "data:image/png;base64,cG5n",
  });
  expect(referenceFile).not.toHaveBeenCalled();
});
