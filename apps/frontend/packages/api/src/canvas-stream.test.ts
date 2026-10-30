import { describe, expect, it, vi } from "vitest";

import { consumeCanvasEvents, CanvasResyncRequired } from "./canvas-stream";
function stream(chunks: string[], onCancel = () => {}) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
      controller.close();
    },
    cancel: onCancel,
  });
}
const event = {
  protocol_version: 3,
  base_cursor: 1,
  cursor: 2,
  occurred_at: "",
  request_id: "",
  action: "",
  operations: [],
};
describe("Canvas SSE transport", () => {
  it("handles split CRLF and waits for each complete frame", async () => {
    const received: number[] = [];
    await consumeCanvasEvents(
      stream([
        "event: heartbeat\r",
        "\ndata: {}\r\n\r",
        "\nid: 2\nevent: canvas.patch\ndata: ",
        JSON.stringify(event),
        "\n\n",
      ]),
      new AbortController().signal,
      async (e) => {
        await Promise.resolve();
        received.push(e.cursor);
      },
    );
    expect(received).toEqual([2]);
  });
  it("rejects truncated JSON, resync and inconsistent IDs", async () => {
    for (const frame of [
      "event: canvas.patch\nid: 2\ndata: {\n\n",
      "event: canvas.resync_required\ndata: {}\n\n",
      `event: canvas.patch\nid: 3\ndata: ${JSON.stringify(event)}\n\n`,
      "data: unfinished",
    ]) {
      await expect(consumeCanvasEvents(stream([frame]), new AbortController().signal, () => {})).rejects.toBeInstanceOf(
        CanvasResyncRequired,
      );
    }
  });
  it("cancels the reader when its page is disposed", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const pending = consumeCanvasEvents(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      controller.signal,
      () => {},
    );
    controller.abort();
    await pending.catch(() => undefined);
    expect(cancelled).toBe(true);
  });
});

it("waits for scoped mutation receipts and removes the interceptor on disposal", async () => {
  const { apiHttp } = await import("./http");
  const { observeCanvasReceipts } = await import("./canvas-stream");
  let release!: () => void;
  const seen: number[] = [];
  const stop = observeCanvasReceipts("p", "c", (cursor) => {
    seen.push(cursor);
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const send = (url: string) =>
    apiHttp.request({
      url,
      method: "patch",
      adapter: async (config) => ({
        data: {},
        status: 200,
        statusText: "OK",
        headers: { "x-canvas-cursor": "5" },
        config,
      }),
    });
  try {
    let finished = false;
    const pending = send("/api/canvas-server/projects/p/canvases/c").then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(seen).toEqual([5]));
    expect(finished).toBe(false);
    release();
    await pending;
    await send("/api/canvas-server/projects/p/canvases/other");
    expect(seen).toEqual([5]);
  } finally {
    stop();
  }
  await send("/api/canvas-server/projects/p/canvases/c/nodes");
  expect(seen).toEqual([5]);
});
