import { Buffer } from "node:buffer";

import { describe, expect, test } from "vitest";

import type { LocalUserMessagePart } from "../contracts/bridge.generated";
import { localUserMessagePreview, parseLocalUserMessageParts } from "../electron/local-user-message";

describe("local user message admission", () => {
  test("accepts native text and inline file parts", () => {
    const parts: LocalUserMessagePart[] = [
      { type: "text", text: "检查附件" },
      {
        type: "file",
        mediaType: "text/plain",
        filename: "brief.txt",
        url: `data:text/plain;base64,${Buffer.from("hello").toString("base64")}`,
      },
    ];
    expect(parseLocalUserMessageParts(parts)).toEqual(parts);
    expect(localUserMessagePreview(parts)).toBe("检查附件");
  });

  test("accepts the interleaved parts produced by eight inline attachments", () => {
    const parts: LocalUserMessagePart[] = [{ type: "text", text: "开始" }];
    for (let index = 0; index < 8; index++) {
      parts.push({
        type: "file",
        mediaType: "text/plain",
        filename: `${index}.txt`,
        url: "data:text/plain;base64,aA==",
      });
      parts.push({ type: "text", text: `继续 ${index}` });
    }
    expect(parseLocalUserMessageParts(parts)).toEqual(parts);
  });

  test("rejects remote, mismatched and malformed file data", () => {
    expect(() =>
      parseLocalUserMessageParts([
        { type: "file", mediaType: "text/plain", filename: "brief.txt", url: "https://example.com/brief.txt" },
      ]),
    ).toThrow("data URL");
    expect(() =>
      parseLocalUserMessageParts([
        { type: "file", mediaType: "image/png", filename: "brief.txt", url: "data:text/plain;base64,aGVsbG8=" },
      ]),
    ).toThrow("媒体类型");
    expect(() =>
      parseLocalUserMessageParts([
        { type: "file", mediaType: "text/plain", filename: "brief.txt", url: "data:text/plain;base64,%%%%" },
      ]),
    ).toThrow("data URL");
  });
});
