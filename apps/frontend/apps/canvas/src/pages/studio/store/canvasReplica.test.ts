import { ApiError, CanvasResyncRequired, type CanvasGetCanvasGraphResponse, type CanvasPatchEvent } from "@repo/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasReplica } from "./canvasReplica";
const snapshot = (cursor = 1): CanvasGetCanvasGraphResponse => ({
  cursor,
  canvas: {
    canvas_id: "c",
    project_id: "p",
    name: "test",
    created_by: "u",
    created_at: "",
    updated_at: "",
    default_view: 1,
    revision: cursor,
    stats: { canvas_node_count: 0, selected_video_duration_millis: 0 },
  },
  archives: [],
  nodes: [],
  tasks: [],
  texts: [],
  protected_node_ids: [],
});
const event = (cursor: number): CanvasPatchEvent => ({
  protocol_version: 3,
  base_cursor: cursor - 1,
  cursor,
  occurred_at: "",
  request_id: "",
  action: "",
  operations: [],
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
afterEach(() => vi.useRealTimers());
describe("Canvas replica lifecycle", () => {
  it("waits for SSE receipts, ignores older recovery snapshots and rejects waiters on close", async () => {
    const read = deferred<CanvasGetCanvasGraphResponse>();
    let apply!: (event: CanvasPatchEvent) => void;
    const install = vi.fn();
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(read.promise);
    const replica = new CanvasReplica({
      snapshot: fetch,
      install,
      unavailable: vi.fn(),
      events: async (_cursor, signal, receive) => {
        apply = receive;
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    });
    const run = replica.run();
    await tick();
    let acknowledged = false;
    const receipt = replica.waitForCursor(2).then(() => {
      acknowledged = true;
    });
    await tick();
    expect(acknowledged).toBe(false);
    const recovery = replica.refresh();
    apply(event(2));
    await receipt;
    expect(acknowledged).toBe(true);
    read.resolve(snapshot(1));
    await recovery;
    expect(install.mock.calls.map((call) => call[0].cursor)).toEqual([1, 2]);
    const abandoned = expect(replica.waitForCursor(3)).rejects.toMatchObject({ name: "AbortError" });
    replica.close();
    await abandoned;
    await run;
    apply(event(3));
    expect(install).toHaveBeenCalledTimes(2);
  });
  it("reconnects from the last installed cursor and uses HTTP only when replay needs recovery", async () => {
    vi.useFakeTimers();
    const streams = [deferred<void>(), deferred<void>(), deferred<void>()];
    let apply!: (event: CanvasPatchEvent) => void;
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot(7));
    const cursors: number[] = [];
    const replica = new CanvasReplica({
      snapshot: fetch,
      install: vi.fn(),
      unavailable: vi.fn(),
      events: async (cursor, signal, receive) => {
        const index = cursors.length;
        cursors.push(cursor);
        apply = receive;
        signal.addEventListener("abort", () => streams[index]!.resolve(), { once: true });
        await streams[index]!.promise;
      },
    });
    const run = replica.run();
    await tick();
    apply(event(2));
    streams[0]!.reject(new Error("network disconnected"));
    await tick();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cursors).toEqual([1, 2]);
    expect(fetch).toHaveBeenCalledTimes(1);
    streams[1]!.reject(new CanvasResyncRequired());
    await tick();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cursors).toEqual([1, 2, 7]);
    expect(fetch).toHaveBeenCalledTimes(2);
    replica.close();
    await run;
  });
  it("revoked access rejects existing and later receipts and stops reconnecting", async () => {
    const denied = new ApiError("forbidden", { status: 403 });
    const unavailable = vi.fn();
    const replica = new CanvasReplica({
      snapshot: async () => snapshot(),
      install: vi.fn(),
      unavailable,
      events: async () => {
        throw denied;
      },
    });
    const receipt = expect(replica.waitForCursor(2)).rejects.toBe(denied);
    await replica.run();
    await receipt;
    await expect(replica.waitForCursor(3)).rejects.toBe(denied);
    expect(unavailable).toHaveBeenCalledOnce();
  });
  it("does not install an in-flight snapshot after unmount", async () => {
    const read = deferred<CanvasGetCanvasGraphResponse>();
    const install = vi.fn();
    const events = vi.fn();
    const replica = new CanvasReplica({ snapshot: () => read.promise, install, events, unavailable: vi.fn() });
    const run = replica.run();
    replica.close();
    read.resolve(snapshot());
    await run;
    expect(install).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
  });
});
