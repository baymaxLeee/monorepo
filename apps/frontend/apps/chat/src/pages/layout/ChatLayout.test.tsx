import { useChatStore } from "@repo/ai-elements/conversation/store/useChatStore";
import type * as ApiModule from "@repo/api";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ChatLayout } from "./ChatLayout";

let viewportWidth = 1280;
const mediaListeners = new Set<() => void>();

const renders = vi.hoisted(() => ({ sidebar: vi.fn(), content: vi.fn(), preview: vi.fn() }));
vi.mock("@repo/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  fetchConversations: async () => [],
}));
vi.mock("../../components/ChatConversationSidebar", () => ({
  ChatConversationSidebar: () => {
    renders.sidebar();
    return <nav aria-label="会话记录" />;
  },
}));
vi.mock("@repo/ai-elements/conversation/components/ChatArtifactPanel", () => ({
  ChatArtifactPanel: () => {
    renders.preview();
    return <div>预览内容</div>;
  },
}));
vi.mock("../../components/ChatAuxiliaryPanels", () => ({ ChatAuxiliaryPanels: () => null }));

beforeEach(() => {
  viewportWidth = 1280;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  mediaListeners.clear();
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const target = new EventTarget();
    const media = Object.assign(target, {
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
    });
    Object.defineProperty(media, "matches", {
      get() {
        const min = query.match(/min-width:\s*(\d+)/)?.[1];
        const max = query.match(/max-width:\s*(\d+)/)?.[1];
        return min ? viewportWidth >= Number(min) : max ? viewportWidth <= Number(max) : false;
      },
    });
    mediaListeners.add(() => target.dispatchEvent(new Event("change")));
    return media as MediaQueryList;
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: new DOMRect(0, 0, 1280, 800),
              borderBoxSize: [{ inlineSize: 1280, blockSize: 800 }],
              contentBoxSize: [{ inlineSize: 1280, blockSize: 800 }],
              devicePixelContentBoxSize: [{ inlineSize: 1280, blockSize: 800 }],
            },
          ],
          this,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  document.documentElement.style.fontSize = "16px";
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1280);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1280, 800));
  useChatStore.setState({ loadAgents: async () => {}, tracePanelOpen: false, memoryPanelOpen: false });
  useChatStore.getState().closeArtifactPreview();
  useChatStore.getState().closeVideoProductionWorkspace();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.fontSize = "";
});

function Content() {
  renders.content();
  return (
    <div>
      会话正文
      <input aria-label="下一条输入" />
      <Outlet />
    </div>
  );
}
async function mount() {
  const view = render(
    <MemoryRouter initialEntries={["/conversations/one"]}>
      <Routes>
        <Route element={<ChatLayout />}>
          <Route path="/conversations/:id" element={<Content />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText("会话正文")).toBeTruthy());
  await act(async () => {});
  renders.sidebar.mockClear();
  renders.content.mockClear();
  renders.preview.mockClear();
  return view;
}

test("changing the artifact within an open inspector does not render the list or conversation", async () => {
  useChatStore.getState().openFilePreview("one", "a.md");
  await mount();
  await act(async () => useChatStore.getState().openFilePreview("one", "b.md"));
  expect(renders.sidebar).not.toHaveBeenCalled();
  expect(renders.content).not.toHaveBeenCalled();
});

test("trace refreshes do not render the three-column shell", async () => {
  await mount();
  await act(async () => useChatStore.getState().bumpTraceRefresh());
  expect(renders.sidebar).not.toHaveBeenCalled();
  expect(renders.content).not.toHaveBeenCalled();
});

test("opening and closing the inspector keeps the conversation mounted and its draft intact", async () => {
  await mount();
  expect(renders.preview).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft" } });
  await act(async () => useChatStore.getState().openFilePreview("one", "new.md"));
  await screen.findByText("预览内容");
  expect(screen.getByRole("complementary", { name: "Artifact 预览" })).toBeTruthy();
  expect(renders.content).not.toHaveBeenCalled();
  await act(async () => useChatStore.getState().closeArtifactPreview());
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("draft");
});

test("the sidebar toggle uses the standard control without resetting the content", async () => {
  await mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft" } });
  fireEvent.click(screen.getByRole("button", { name: "切换会话记录" }));
  fireEvent.click(screen.getByRole("button", { name: "切换会话记录" }));
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("draft");
  expect(renders.content).not.toHaveBeenCalled();
});

test("narrow layouts use a modal inspector without remounting the conversation", async () => {
  await mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft" } });
  await act(async () => {
    viewportWidth = 600;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    mediaListeners.forEach((notify) => notify());
  });
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("draft");
  await act(async () => useChatStore.getState().openFilePreview("one", "new.md"));
  expect(await screen.findByRole("dialog", { name: "Artifact 预览" })).toBeTruthy();
  expect(screen.queryByRole("complementary", { name: "Artifact 预览" })).toBeNull();
  await act(async () => useChatStore.getState().closeArtifactPreview());
});

test("keyboard resizing updates the separator without rendering the conversation", async () => {
  await mount();
  const separator = screen.getByRole("separator", { name: "调整会话记录宽度" });
  const previous = separator.getAttribute("aria-valuenow");
  fireEvent.keyDown(separator, { key: "ArrowRight" });
  expect(separator.getAttribute("aria-valuenow")).not.toBe(previous);
  expect(renders.content).not.toHaveBeenCalled();
});
