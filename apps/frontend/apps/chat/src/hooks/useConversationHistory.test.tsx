import type { Conversation } from "@repo/api";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";

import { useConversationHistory } from "./useConversationHistory";

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), remove: vi.fn(), detail: vi.fn() }));
vi.mock("@repo/api", () => ({
  fetchConversations: api.list,
  createConversation: api.create,
  deleteConversation: api.remove,
  fetchConversation: api.detail,
}));
vi.mock("@repo/ai-elements", () => ({ downloadConversationMarkdown: vi.fn() }));
vi.mock("@repo/ai-elements/conversation/store/useChatStore", () => ({
  useChatStore: Object.assign(() => null, { getState: () => ({ conversationTitleUpdate: null }) }),
}));

const item = (id: string) => ({ id, title: id }) as Conversation;
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
beforeEach(() => {
  api.list.mockResolvedValue([]);
  api.remove.mockResolvedValue(undefined);
});

test("a newly published branch refreshes history on navigation", async () => {
  api.list.mockResolvedValueOnce([item("source")]).mockResolvedValueOnce([item("branch"), item("source")]);
  const view = renderHook(() => ({ history: useConversationHistory(), navigate: useNavigate() }), { wrapper });
  await waitFor(() => expect(view.result.current.history.conversations?.[0]?.id).toBe("source"));
  act(() =>
    view.result.current.navigate("/platform/chat/conversations/branch", {
      state: { refreshConversationHistory: true },
    }),
  );
  await waitFor(() =>
    expect(view.result.current.history.conversations?.map((row) => row.id)).toEqual(["branch", "source"]),
  );
});

test("a stale initial list cannot erase a conversation created while loading", async () => {
  let resolve!: (list: Conversation[]) => void;
  api.list.mockReturnValue(
    new Promise<Conversation[]>((done) => {
      resolve = done;
    }),
  );
  api.create.mockResolvedValue(item("new"));
  const view = renderHook(useConversationHistory, { wrapper });
  await act(async () => {
    await view.result.current.create();
  });
  expect(view.result.current.conversations?.map((row) => row.id)).toEqual(["new"]);
  await act(async () => {
    resolve([]);
  });
  expect(view.result.current.conversations?.map((row) => row.id)).toContain("new");
});

test("failed creation can be retried and duplicate pending creation is ignored", async () => {
  let reject!: (error: Error) => void;
  api.create
    .mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    )
    .mockResolvedValueOnce(item("retry"));
  const view = renderHook(useConversationHistory, { wrapper });
  await waitFor(() => expect(view.result.current.conversations).toEqual([]));
  let first: Promise<void>;
  act(() => {
    first = view.result.current.create();
  });
  await act(async () => {
    await view.result.current.create();
  });
  expect(api.create).toHaveBeenCalledOnce();
  await act(async () => {
    reject(new Error("offline"));
    await expect(first!).rejects.toThrow("offline");
  });
  expect(view.result.current.creating).toBe(false);
  await act(async () => {
    await view.result.current.create();
  });
  expect(view.result.current.conversations?.[0].id).toBe("retry");
});

test("deletion failure keeps the row and loading errors have a retry path", async () => {
  api.list.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([item("saved")]);
  const view = renderHook(useConversationHistory, { wrapper });
  await waitFor(() => expect(view.result.current.error).toBe("offline"));
  await act(async () => {
    await view.result.current.load();
  });
  api.remove.mockRejectedValueOnce(new Error("denied"));
  await act(async () => {
    await expect(view.result.current.remove("saved")).rejects.toThrow("denied");
  });
  expect(view.result.current.conversations?.[0].id).toBe("saved");
});
