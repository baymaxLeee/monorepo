import type { DesktopBridge, DesktopEvent, LocalStream } from "@repo/runtime/desktop";
import { describe, expect, it, vi } from "vitest";

import { attachLocalStream, LocalChatTransport } from "./transport";

function fixture(snapshot: LocalStream) {
  const listeners = new Set<(event: DesktopEvent) => void>();
  const bridge = {
    subscribe: (listener: (event: DesktopEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    openStream: vi.fn(async () => snapshot),
    send: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  } as unknown as DesktopBridge;
  return {
    bridge,
    listeners,
    emit: (event: DesktopEvent) => {
      for (const listener of listeners) listener(event);
    },
  };
}
function snapshot(): LocalStream {
  return {
    thread: {
      id: "t",
      mode: "local",
      title: "test",
      agentId: null,
      workspace: "/test",
      status: "running",
      turnId: "turn",
      error: null,
      updatedAt: "",
      messages: [],
    },
    segment: { id: "s", messages: [], chunks: [{ type: "start", messageId: "assistant" }], done: false },
  };
}
describe("native UIMessage IPC transport", () => {
  it("deduplicates events racing with replay and preserves exact native chunk order", async () => {
    const s = snapshot(),
      f = fixture(s);
    vi.mocked(f.bridge.openStream).mockImplementation(async () => {
      f.emit({ type: "stream", threadId: "t", segmentId: "s", index: 0, chunk: s.segment!.chunks[0]! });
      f.emit({ type: "stream", threadId: "t", segmentId: "s", index: 1, chunk: { type: "text-start", id: "text" } });
      return s;
    });
    const connection = await attachLocalStream(f.bridge, "t");
    f.emit({
      type: "stream",
      threadId: "t",
      segmentId: "s",
      index: 2,
      chunk: { type: "text-delta", id: "text", delta: "你好" },
    });
    f.emit({ type: "stream", threadId: "t", segmentId: "s", index: 3, chunk: null });
    const reader = connection.stream!.getReader(),
      chunks = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
    expect(chunks.map((chunk) => chunk.type)).toEqual(["start", "text-start", "text-delta"]);
    expect(f.listeners.size).toBe(0);
  });
  it("renderer detachment closes only its subscriber, not the Agent", async () => {
    const f = fixture(snapshot()),
      connection = await attachLocalStream(f.bridge, "t");
    connection.dispose();
    expect(f.listeners.size).toBe(0);
    expect(f.bridge.stop).not.toHaveBeenCalled();
    const reader = connection.stream!.getReader();
    await reader.read();
    expect((await reader.read()).done).toBe(true);
  });
  it("refuses missing chunks and surfaces runtime death", async () => {
    const f = fixture(snapshot()),
      connection = await attachLocalStream(f.bridge, "t");
    const reader = connection.stream!.getReader();
    await reader.read();
    f.emit({ type: "stream", threadId: "t", segmentId: "s", index: 4, chunk: null });
    await expect(reader.read()).rejects.toThrow("缺失");
    expect(f.listeners.size).toBe(0);
  });
  it("loads completed native history without replaying a finished turn", async () => {
    const s = snapshot();
    s.segment!.done = true;
    const f = fixture(s),
      transport = new LocalChatTransport(f.bridge, "t");
    expect(await transport.load()).toEqual(s.thread);
    expect(await transport.reconnectToStream()).toBe(null);
    expect(f.listeners.size).toBe(0);
  });
});
