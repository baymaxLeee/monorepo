import { MessageScrollerItem } from "@repo/design-system/shadcn/message-scroller";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  type ConversationScrollHandle,
} from "./conversation";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./reasoning";

vi.mock("./message", () => ({ MessageResponse: ({ children }: { children: string }) => <div>{children}</div> }));

const observers = new Map<Element, ResizeObserverCallback>();
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      if (options.top !== undefined) this.scrollTop = options.top;
    },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private elements = new Set<Element>();
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        this.elements.add(element);
        observers.set(element, this.callback);
      }
      disconnect() {
        for (const element of this.elements) observers.delete(element);
        this.elements.clear();
      }
    },
  );
});

afterEach(async () => {
  cleanup();
  await vi.advanceTimersByTimeAsync(100);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  observers.clear();
});

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(64);
  });
}

async function setupConversation() {
  const scrollRef = createRef<ConversationScrollHandle>();
  let height = 600;
  const content = () => (
    <Conversation scrollRef={scrollRef}>
      <ConversationContent>
        <MessageScrollerItem messageId="question" scrollAnchor>
          问题
        </MessageScrollerItem>
        <MessageScrollerItem messageId="reply">
          <Reasoning isStreaming>
            <ReasoningTrigger />
            <ReasoningContent>{`推理 ${height}`}</ReasoningContent>
          </Reasoning>
          <div>正文 {height}</div>
        </MessageScrollerItem>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
  const view = render(content());
  const transcript = screen.getByRole("log");
  const viewport = transcript.parentElement!;
  let top = 0;
  // Supply browser layout and asynchronous scroll events; keep the upstream hook real.
  viewport.style.overflow = "auto";
  Object.defineProperties(viewport, {
    clientHeight: { get: () => 200 },
    scrollHeight: { get: () => height },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        const next = Math.max(0, Math.min(height - 200, value));
        if (next !== top) {
          top = next;
          setTimeout(() => fireEvent.scroll(viewport), 0);
        }
      },
    },
  });
  const rect = (y: number, h: number) => new DOMRect(0, y, 300, h);
  vi.spyOn(viewport, "getBoundingClientRect").mockImplementation(() => rect(0, 200));
  vi.spyOn(transcript, "getBoundingClientRect").mockImplementation(() => rect(-top, height));
  const rows = transcript.querySelectorAll<HTMLElement>("[data-message-id]");
  vi.spyOn(rows[0]!, "getBoundingClientRect").mockImplementation(() => rect(-top, 80));
  vi.spyOn(rows[1]!, "getBoundingClientRect").mockImplementation(() => rect(80 - top, height - 80));
  async function resize() {
    act(() => {
      const callback = observers.get(transcript)!;
      callback(
        [
          {
            target: transcript,
            contentRect: new DOMRect(0, 0, 300, height),
            borderBoxSize: [{ inlineSize: 300, blockSize: height }],
            contentBoxSize: [{ inlineSize: 300, blockSize: height }],
            devicePixelContentBoxSize: [{ inlineSize: 300, blockSize: height }],
          },
        ],
        {} as ResizeObserver,
      );
    });
    await settle();
  }
  function grow() {
    height += 100;
    view.rerender(content());
  }
  async function append() {
    grow();
    await resize();
  }
  async function scrollTo(top: number) {
    act(() => {
      viewport.scrollTop = top;
    });
    await settle();
  }
  await resize();
  act(() => {
    scrollRef.current?.scrollToEnd();
  });
  await settle();
  return { ...view, viewport, transcript, append, grow, resize, scrollTo, scrollRef };
}

function expectAtBottom(viewport: HTMLElement) {
  expect(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
}

test("reasoning and body share one viewport and follow streamed output", async () => {
  const { viewport, transcript, append } = await setupConversation();
  expect(viewport.querySelectorAll(".overflow-auto, .overflow-y-auto").length).toBe(0);
  expect(transcript.textContent).toContain("推理");
  expect(transcript.textContent).toContain("正文");
  expect(screen.queryByRole("button", { name: "滚动到最新思考内容" })).toBeNull();
  for (let i = 0; i < 5; i++) {
    await append();
    expectAtBottom(viewport);
  }
});

test("manual return to the bottom resumes continuous output without the button", async () => {
  const { viewport, append, scrollTo } = await setupConversation();
  fireEvent.wheel(viewport, { deltaY: -100 });
  await scrollTo(100);
  for (let i = 0; i < 3; i++) {
    await append();
    expect(viewport.scrollTop).toBe(100);
  }
  expect(screen.getByRole("button", { name: "回到底部" }).getAttribute("data-active")).toBe("true");

  fireEvent.wheel(viewport, { deltaY: 100 });
  await scrollTo(viewport.scrollHeight - viewport.clientHeight);
  for (let i = 0; i < 5; i++) {
    await append();
    expectAtBottom(viewport);
  }
  expect(screen.getByRole("button", { name: "回到底部" }).getAttribute("data-active")).toBe("false");
});

test("a trailing downward wheel at the bottom keeps following the next streamed chunk", async () => {
  const { viewport, append, scrollTo } = await setupConversation();
  fireEvent.wheel(viewport, { deltaY: -100 });
  await scrollTo(100);
  await scrollTo(viewport.scrollHeight - viewport.clientHeight);
  fireEvent.wheel(viewport, { deltaY: 12 });
  await append();
  expectAtBottom(viewport);
});

test("downward keyboard and touch intent at the bottom keep following", async () => {
  const { viewport, append } = await setupConversation();
  for (const key of ["End", "PageDown", "ArrowDown", " "]) {
    fireEvent.keyDown(viewport, { key });
    await append();
    expectAtBottom(viewport);
  }
  fireEvent.touchStart(viewport, { touches: [{ clientY: 200 }] });
  fireEvent.touchMove(viewport, { touches: [{ clientY: 180 }] });
  await append();
  expectAtBottom(viewport);
  fireEvent.touchEnd(viewport, { touches: [] });
});

test("upward intent pauses following and downward intent away from the bottom does not jump", async () => {
  const { viewport, append } = await setupConversation();
  fireEvent.wheel(viewport, { deltaY: -12 });
  const top = viewport.scrollTop;
  await append();
  expect(viewport.scrollTop).toBe(top);
  fireEvent.wheel(viewport, { deltaY: 12 });
  await append();
  expect(viewport.scrollTop).toBe(top);
});

test("a trackpad's horizontal or zero-delta tail preserves following at the bottom", async () => {
  const { viewport, append, scrollTo } = await setupConversation();
  fireEvent.wheel(viewport, { deltaY: -100 });
  await scrollTo(100);
  await append();
  fireEvent.wheel(viewport, { deltaY: 100 });
  await scrollTo(viewport.scrollHeight - viewport.clientHeight);
  for (const deltaX of [2, 0]) {
    fireEvent.wheel(viewport, { deltaX, deltaY: 0 });
    await append();
    expectAtBottom(viewport);
  }
});

test.each([0, 3])("trackpad deltaY=%i preserves following while a streamed resize is pending", async (deltaY) => {
  const { viewport, grow, resize, append } = await setupConversation();
  grow();
  fireEvent.wheel(viewport, { deltaX: 2, deltaY });
  await resize();
  expectAtBottom(viewport);
  await append();
  expectAtBottom(viewport);
});

test("horizontal trackpad input while reading history does not return to the bottom", async () => {
  const { viewport, append, scrollTo } = await setupConversation();
  fireEvent.wheel(viewport, { deltaY: -100 });
  await scrollTo(100);
  fireEvent.wheel(viewport, { deltaX: 2, deltaY: 0 });
  await append();
  expect(viewport.scrollTop).toBe(100);
});

test("upward input cancels following even while a streamed resize is pending", async () => {
  const { viewport, grow, resize, append } = await setupConversation();
  const top = viewport.scrollTop;
  grow();
  fireEvent.wheel(viewport, { deltaY: -3 });
  await resize();
  await append();
  expect(viewport.scrollTop).toBe(top);
});

test("End explicitly returns to the live edge before the next chunk arrives", async () => {
  const { viewport, append, scrollTo } = await setupConversation();
  fireEvent.wheel(viewport, { deltaY: -100 });
  await scrollTo(100);
  fireEvent.keyDown(viewport, { key: "End" });
  await append();
  expectAtBottom(viewport);
});

test("button and send-message handle restore following; unmount disconnects observation", async () => {
  const { viewport, append, scrollTo, scrollRef, unmount } = await setupConversation();
  fireEvent.wheel(viewport, { deltaY: -100 });
  await scrollTo(100);
  fireEvent.click(screen.getByRole("button", { name: "回到底部" }));
  await settle();
  expectAtBottom(viewport);
  fireEvent.wheel(viewport, { deltaY: -100 });
  await scrollTo(100);
  act(() => {
    scrollRef.current?.scrollToEnd();
  });
  await settle();
  await append();
  expectAtBottom(viewport);
  unmount();
  expect(observers.size).toBe(0);
});
