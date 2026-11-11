import { afterEach, expect, it, vi } from "vitest";

import { request } from "./http";
import { createStorageDownloadUrl, fetchAssetText } from "./storage-server";

vi.mock("./http", () => ({ API_BASE_URL: "https://files.example", request: vi.fn() }));
vi.mock("./auth-fetch", () => ({ authFetch: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("binds conversation file delivery to the revision paired with the editor ETag", async () => {
  vi.mocked(request).mockResolvedValue({ url: "/signed", revision_id: "revision" });
  await createStorageDownloadUrl({
    assetId: "asset",
    revisionId: "revision",
    owner: { kind: "conversation-file", conversationId: "c", fileId: "f" },
  });
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ params: { revision_id: "revision" } }));
});

it("signs through the authorizing business owner and resolves the gateway URL", async () => {
  vi.mocked(request).mockResolvedValue({
    url: "/api/storage-server/media/file?signature=capability",
    expires_at: "2030-01-01T00:00:00Z",
  });
  const signal = new AbortController().signal;
  const result = await createStorageDownloadUrl(
    {
      assetId: "asset",
      revisionId: "revision",
      owner: { kind: "conversation-document", conversationId: "c", documentId: "d" },
    },
    signal,
    512,
  );
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "POST",
      url: "/api/chat-server/conversations/c/documents/d/delivery",
      params: { max_dim: 512 },
      signal,
    }),
  );
  expect(result.url).toBe("https://files.example/api/storage-server/media/file?signature=capability");
});

it("reads original text without forwarding cookies or app credentials", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"x": "原文"}'));
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  expect(await fetchAssetText("https://cdn.example/signed", signal)).toBe('{"x": "原文"}');
  expect(fetcher).toHaveBeenCalledWith("https://cdn.example/signed", {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal,
  });
});

it("preserves denial status for the bounded renewal policy", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 403 })));
  await expect(fetchAssetText("/signed")).rejects.toMatchObject({ status: 403 });
});

it("rejects binary content instead of silently rendering replacement characters", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([255, 254]))));
  await expect(fetchAssetText("/binary")).rejects.toThrow();
});

it("bounds streamed editing bytes and preserves a UTF-8 BOM", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response("12345"))
      .mockResolvedValueOnce(new Response(new Uint8Array([239, 187, 191, 65]))),
  );
  await expect(fetchAssetText("/large", undefined, 4)).rejects.toThrow("大小限制");
  expect(await fetchAssetText("/bom", undefined, 4)).toBe("\uFEFFA");
});
