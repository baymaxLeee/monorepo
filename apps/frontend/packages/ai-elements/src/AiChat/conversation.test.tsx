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

beforeEach(() => {
  vi.useFakeTimers();
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
        <Reasoning isStreaming>
          <ReasoningTrigger />
          <ReasoningContent>{`推理 ${height}`}</ReasoningContent>
        </Reasoning>
        <div>正文 {height}</div>
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
  async function append() {
    height += 100;
    view.rerender(content());
    await resize();
  }
  async function scrollTo(top: number) {
    act(() => {
      viewport.scrollTop = top;
    });
    await settle();
  }
  await resize();
  return { ...view, viewport, transcript, append, scrollTo, scrollRef };
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
  expect(screen.getByRole("button", { name: "回到底部" })).toBeTruthy();

  fireEvent.wheel(viewport, { deltaY: 100 });
  await scrollTo(viewport.scrollHeight - viewport.clientHeight);
  fireEvent.wheel(viewport, { deltaY: 12 });
  for (let i = 0; i < 5; i++) {
    await append();
    expectAtBottom(viewport);
  }
  expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull();
});

test("button and send-message handle restore following; unmount disconnects observation", async () => {
  const { viewport, append, scrollTo, scrollRef, unmount } = await setupConversation();
  await scrollTo(100);
  fireEvent.click(screen.getByRole("button", { name: "回到底部" }));
  await settle();
  expectAtBottom(viewport);
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
