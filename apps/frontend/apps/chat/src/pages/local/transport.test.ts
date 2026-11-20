import type { DesktopBridge, DesktopEvent, LocalStream, LocalThread } from "@repo/runtime/desktop";
import { describe, expect, test, vi } from "vitest";

import { attachLocalStream, LocalChatTransport } from "./transport";

const thread = {
  id: "local",
  mode: "local",
  title: "Local",
  workspace: "/projects/monorepo",
  providerId: "provider",
  reasoningEffort: "medium",
  approvalPolicy: "on-request",
  permissionProfile: ":workspace",
  pluginActivations: [],
  status: "running",
  turnId: "turn",
  error: null,
  updatedAt: "2026-11-20T00:00:00Z",
  pendingInputs: [],
  contextUsage: null,
  messages: [],
} satisfies LocalThread;

function snapshot(): LocalStream {
  return {
    thread,
    segment: { id: "segment", messages: [], chunks: [{ type: "start", messageId: "assistant" }], done: false },
  };
}

function fixture(value: LocalStream) {
  const listeners = new Set<(event: DesktopEvent) => void>();
  const bridge = {
    subscribe: (listener: (event: DesktopEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openStream: vi.fn(async () => value),
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

describe("native UIMessage IPC transport", () => {
  test("sends native text and file parts through the Desktop bridge", async () => {
    const value = snapshot();
    value.segment = null;
    const f = fixture(value);
    const transport = new LocalChatTransport(f.bridge, thread.id);

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: thread.id,
      messageId: "message",
      messages: [
        {
          id: "message",
          role: "user",
          parts: [
            { type: "text", text: "检查附件" },
            { type: "file", mediaType: "text/plain", filename: "brief.txt", url: "data:text/plain;base64,aGVsbG8=" },
          ],
        },
      ],
      abortSignal: undefined,
    });

    expect(f.bridge.send).toHaveBeenCalledWith(
      thread.id,
      [
        { type: "text", text: "检查附件" },
        { type: "file", mediaType: "text/plain", filename: "brief.txt", url: "data:text/plain;base64,aGVsbG8=" },
      ],
      "message",
    );
    expect(await stream.getReader().read()).toEqual({ done: true, value: undefined });
  });

  test("deduplicates events racing with replay and preserves native chunk order", async () => {
    const value = snapshot();
    const f = fixture(value);
    vi.mocked(f.bridge.openStream).mockImplementation(async () => {
      f.emit({ type: "stream", threadId: thread.id, segmentId: "segment", index: 0, chunk: value.segment!.chunks[0]! });
      f.emit({
        type: "stream",
        threadId: thread.id,
        segmentId: "segment",
        index: 1,
        chunk: { type: "text-start", id: "text" },
      });
      return value;
    });
    const connection = await attachLocalStream(f.bridge, thread.id);
    f.emit({
      type: "stream",
      threadId: thread.id,
      segmentId: "segment",
      index: 2,
      chunk: { type: "text-delta", id: "text", delta: "你好" },
    });
    f.emit({ type: "stream", threadId: thread.id, segmentId: "segment", index: 3, chunk: null });
    const reader = connection.stream!.getReader();
    const chunks = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
    expect(chunks.map((chunk) => chunk.type)).toEqual(["start", "text-start", "text-delta"]);
    expect(f.listeners.size).toBe(0);
  });

  test("renderer detachment closes only its subscriber", async () => {
    const f = fixture(snapshot());
    const connection = await attachLocalStream(f.bridge, thread.id);
    connection.dispose();
    expect(f.listeners.size).toBe(0);
    expect(f.bridge.stop).not.toHaveBeenCalled();
    const reader = connection.stream!.getReader();
    await reader.read();
    expect((await reader.read()).done).toBe(true);
  });

  test("disposing the transport detaches a replay already handed to the renderer", async () => {
    const f = fixture(snapshot());
    const transport = new LocalChatTransport(f.bridge, thread.id);
    await transport.load();
    const stream = await transport.reconnectToStream();
    const reader = stream!.getReader();
    await reader.read();
    transport.dispose();
    expect(f.listeners.size).toBe(0);
    expect((await reader.read()).done).toBe(true);
    expect(f.bridge.stop).not.toHaveBeenCalled();
  });

  test("refuses missing chunks", async () => {
    const f = fixture(snapshot());
    const connection = await attachLocalStream(f.bridge, thread.id);
    const reader = connection.stream!.getReader();
    await reader.read();
    f.emit({ type: "stream", threadId: thread.id, segmentId: "segment", index: 4, chunk: null });
    await expect(reader.read()).rejects.toThrow("缺失");
    expect(f.listeners.size).toBe(0);
  });

  test("loads completed native history without replaying a finished turn", async () => {
    const value = snapshot();
    value.segment!.done = true;
    const f = fixture(value);
    const transport = new LocalChatTransport(f.bridge, thread.id);
    expect(await transport.load()).toEqual(thread);
    expect(await transport.reconnectToStream()).toBe(null);
    expect(f.listeners.size).toBe(0);
  });
});
