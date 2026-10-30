import { ApiError, CanvasResyncRequired, type CanvasGetCanvasGraphResponse, type CanvasPatchEvent } from "@repo/api";

import { applyCanvasPatch, projectionFromSnapshot, type CanvasProjection } from "./streamProjection";

type Transport = {
  snapshot: (signal: AbortSignal) => Promise<CanvasGetCanvasGraphResponse>;
  events: (cursor: number, signal: AbortSignal, apply: (event: CanvasPatchEvent) => void) => Promise<void>;
  install: (projection: CanvasProjection) => void;
  unavailable: (error: unknown) => void;
};
/** One owner for snapshot recovery, replay and causal command receipts. */
export class CanvasReplica {
  private controller = new AbortController();
  private projection?: CanvasProjection;
  private recovery?: Promise<void>;
  private waiters = new Set<{ cursor: number; resolve: () => void; reject: (error: unknown) => void }>();
  constructor(private transport: Transport) {}
  private install(next: CanvasProjection) {
    this.transport.install(next);
    this.projection = next;
    for (const waiter of this.waiters)
      if (next.cursor >= waiter.cursor) {
        this.waiters.delete(waiter);
        waiter.resolve();
      }
  }
  refresh = () => {
    const signal = this.controller.signal;
    if (signal.aborted) return Promise.reject(signal.reason);
    if (this.recovery) return this.recovery;
    this.recovery = this.transport
      .snapshot(signal)
      .then((value) => {
        if (!signal.aborted && (!this.projection || value.cursor >= this.projection.cursor))
          this.install(projectionFromSnapshot(value));
      })
      .finally(() => {
        this.recovery = undefined;
      });
    return this.recovery;
  };
  waitForCursor = (cursor: number) => {
    if (this.controller.signal.aborted) return Promise.reject(this.controller.signal.reason);
    if (this.projection && this.projection.cursor >= cursor) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.waiters.add({ cursor, resolve, reject });
    });
  };
  close = (reason: unknown = new DOMException("Canvas closed", "AbortError")) => {
    this.controller.abort(reason);
    for (const waiter of this.waiters) waiter.reject(reason);
    this.waiters.clear();
  };
  async run() {
    const signal = this.controller.signal;
    let needsSnapshot = true;
    while (!signal.aborted) {
      try {
        if (needsSnapshot) {
          await this.refresh();
          needsSnapshot = false;
        }
        if (signal.aborted) return;
        await this.transport.events(this.projection!.cursor, signal, (event) => {
          if (signal.aborted || event.cursor <= this.projection!.cursor) return;
          this.install(applyCanvasPatch(this.projection!, event));
        });
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ApiError && [401, 403, 404].includes(error.status ?? 0)) {
          this.close(error);
          this.transport.unavailable(error);
          return;
        }
        if (error instanceof CanvasResyncRequired) needsSnapshot = true;
      }
      if (signal.aborted) return;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, 1000);
        signal.addEventListener("abort", done, { once: true });
      });
    }
  }
}
