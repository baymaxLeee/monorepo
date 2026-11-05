import { AssetDownloadError, createStorageDownloadUrl, fetchAssetText } from "@repo/api";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useStorageResource } from "./useStorageResource";

vi.mock("@repo/api", () => ({
  createStorageDownloadUrl: vi.fn(),
  fetchAssetText: vi.fn(),
  AssetDownloadError: class extends Error {
    constructor(readonly status: number) {
      super(String(status));
    }
  },
}));
const ref = {
  assetId: "asset",
  revisionId: "revision",
  owner: { kind: "conversation-document" as const, conversationId: "c", documentId: "d" },
};
const capability = () => ({
  asset_id: "asset",
  revision_id: "revision",
  url: "/signed",
  expires_at: new Date(Date.now() + 21600000).toISOString(),
  filename: "page.html",
  media_type: "text/html",
  size_bytes: 10,
});
beforeEach(() => {
  vi.mocked(createStorageDownloadUrl).mockReset().mockResolvedValue(capability());
  vi.mocked(fetchAssetText).mockReset();
});
afterEach(() => vi.useRealTimers());

it("gives native renderers the URL without downloading a body", async () => {
  const { result } = renderHook(() => useStorageResource(ref, false));
  await waitFor(() => expect(result.current.capability?.url).toBe("/signed"));
  expect(fetchAssetText).not.toHaveBeenCalled();
});

it("loads original text and retries an expired capability only once", async () => {
  vi.mocked(fetchAssetText).mockRejectedValueOnce(new AssetDownloadError(403)).mockResolvedValueOnce('{"x":1}');
  const { result } = renderHook(() => useStorageResource(ref, true));
  await waitFor(() => expect(result.current.content).toBe('{"x":1}'));
  expect(createStorageDownloadUrl).toHaveBeenCalledTimes(2);
  expect(fetchAssetText).toHaveBeenCalledTimes(2);
});

it("surfaces repeated denial without a signing loop", async () => {
  vi.mocked(fetchAssetText).mockRejectedValue(new AssetDownloadError(403));
  const { result } = renderHook(() => useStorageResource(ref, true));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(createStorageDownloadUrl).toHaveBeenCalledTimes(2);
});

it("cancels obsolete reads and never displays their late response", async () => {
  let finish!: (value: string) => void;
  vi.mocked(fetchAssetText)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce("new file");
  const { result, rerender, unmount } = renderHook(
    ({ revisionId }) =>
      useStorageResource(
        {
          assetId: "asset",
          revisionId,
          owner: { kind: "conversation-document", conversationId: "conversation", documentId: "document" },
        },
        true,
      ),
    { initialProps: { revisionId: "old" } },
  );
  await waitFor(() => expect(fetchAssetText).toHaveBeenCalledTimes(1));
  const oldSignal = vi.mocked(fetchAssetText).mock.calls[0][1]!;
  rerender({ revisionId: "new" });
  await waitFor(() => expect(result.current.content).toBe("new file"));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => finish("stale file"));
  expect(result.current.content).toBe("new file");
  const currentSignal = vi.mocked(createStorageDownloadUrl).mock.calls.at(-1)![1]!;
  unmount();
  expect(currentSignal.aborted).toBe(true);
});

it("renews native URLs before expiry without unmounting the preview", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useStorageResource(ref, false));
  await act(async () => {});
  expect(result.current.loading).toBe(false);
  vi.mocked(createStorageDownloadUrl).mockResolvedValue({ ...capability(), url: "/renewed" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(21600000 - 30000);
  });
  expect(result.current.capability?.url).toBe("/renewed");
  expect(result.current.loading).toBe(false);
});

it("does not retry a native decode error automatically", async () => {
  const { result } = renderHook(() => useStorageResource(ref, false));
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.onResourceError());
  expect(result.current.error).toBeTruthy();
  expect(createStorageDownloadUrl).toHaveBeenCalledTimes(1);
});
