import { expect, test } from "vitest";

import { parseGenerateImageOutput } from "./ChatImageCard";
import { parseGenerateVideoOutput } from "./ChatVideoCard";

test("parses terminal generated Session files", () => {
  const parsed = parseGenerateImageOutput({
    ok: true,
    status: "completed",
    data: {
      kind: "image",
      count: 1,
      failed: 0,
      images: [{ file_id: "file-id", filename: "image.png", media_type: "image/png" }],
    },
  });

  expect(parsed).toMatchObject({
    ok: true,
    status: "completed",
    count: 1,
    images: [{ fileId: "file-id", filename: "image.png", mediaType: "image/png" }],
  });
});

test("parses a terminal generated video Session file", () => {
  const parsed = parseGenerateVideoOutput({
    ok: true,
    status: "completed",
    data: {
      kind: "video",
      prompt: "a quiet ocean",
      file: { file_id: "video-file", filename: "ocean.mp4", media_type: "video/mp4" },
    },
  });

  expect(parsed).toMatchObject({
    ok: true,
    status: "completed",
    prompt: "a quiet ocean",
    fileId: "video-file",
  });
});
