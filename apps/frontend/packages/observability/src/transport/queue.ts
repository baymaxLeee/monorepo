import { getObservabilityContext } from "../context";
import type { ObservabilityApp, ObservabilityEvent } from "../types";
import { sendEvents, sendEventsWithBeacon } from "./sender";

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_SIZE = 50;

type QueueEntry = {
  app: ObservabilityApp;
  event: ObservabilityEvent;
};

const queue: QueueEntry[] = [];
let timer: number | null = null;

export function enqueue(app: ObservabilityApp, event: ObservabilityEvent): void {
  const { sampleRate } = getObservabilityContext();
  if (sampleRate < 1 && Math.random() > sampleRate) return;
  queue.push({ app, event });
  if (queue.length >= FLUSH_SIZE) {
    void flush();
    return;
  }
  scheduleFlush();
}

export async function flush(): Promise<void> {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  const byApp = drainByApp();
  await Promise.all(
    [...byApp.entries()].map(([app, events]) =>
      sendEvents(app, events).catch(() => {
        events.forEach((event) => queue.unshift({ app, event }));
      }),
    ),
  );
}

export function flushWithBeacon(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  const byApp = drainByApp();
  for (const [app, events] of byApp) {
    if (!sendEventsWithBeacon(app, events)) {
      events.forEach((event) => queue.unshift({ app, event }));
    }
  }
}

function scheduleFlush(): void {
  if (timer !== null) return;
  timer = window.setTimeout(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
}

function drainByApp(): Map<ObservabilityApp, ObservabilityEvent[]> {
  const entries = queue.splice(0, queue.length);
  const byApp = new Map<ObservabilityApp, ObservabilityEvent[]>();
  for (const entry of entries) {
    const events = byApp.get(entry.app) ?? [];
    events.push(entry.event);
    byApp.set(entry.app, events);
  }
  return byApp;
}
