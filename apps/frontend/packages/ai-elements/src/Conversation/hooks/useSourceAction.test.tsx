import { renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import { useSourceAction } from "./useSourceAction";

const delivery = vi.hoisted(() => vi.fn());
vi.mock("@repo/api/chat", () => ({ authorizeConversationSourceDelivery: delivery }));
const source = {
  type: "source-document" as const,
  sourceId: "doc",
  mediaType: "application/pdf",
  title: "Evidence",
  providerMetadata: { chat: { resolver: "knowledge-document" } },
};
beforeEach(() => {
  delivery.mockReset();
});

test("document source navigation authorizes on click and only opens the returned capability", async () => {
  const tab = { opener: {}, location: { replace: vi.fn() }, close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  let resolve!: (value: { url: string }) => void;
  delivery.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result } = renderHook(() => useSourceAction("conversation"));
  const open = result.current(source)!;
  expect(delivery).not.toHaveBeenCalled();
  const pending = open();
  expect(delivery).toHaveBeenCalledWith("conversation", "doc");
  expect(tab.opener).toBeNull();
  expect(tab.location.replace).not.toHaveBeenCalled();
  resolve({ url: "https://storage.example/signed" });
  await pending;
  expect(tab.location.replace).toHaveBeenCalledWith("https://storage.example/signed");
});

test("denied source access closes the reserved tab and remains retryable", async () => {
  const tab = { opener: null, location: { replace: vi.fn() }, close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  delivery.mockRejectedValue(new Error("not authorized"));
  const { result } = renderHook(() => useSourceAction("conversation"));
  await expect(result.current(source)!()).rejects.toThrow("not authorized");
  expect(tab.close).toHaveBeenCalledOnce();
  expect(tab.location.replace).not.toHaveBeenCalled();
  expect(result.current({ ...source, providerMetadata: undefined })).toBeUndefined();
});
