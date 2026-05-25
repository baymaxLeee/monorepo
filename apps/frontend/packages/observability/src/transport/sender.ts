import { getObservabilityContext } from "../context";
import { getDeviceId, getSessionId } from "../session";
import type { ObservabilityApp, ObservabilityEvent, RumBatch } from "../types";

export async function sendEvents(app: ObservabilityApp, events: ObservabilityEvent[]): Promise<void> {
  if (events.length === 0) return;
  const context = getObservabilityContext();
  const body = JSON.stringify(createBatch(app, events));
  await fetch(context.endpoint, {
    body,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    keepalive: body.length <= 60_000,
    method: "POST",
  });
}

export function sendEventsWithBeacon(app: ObservabilityApp, events: ObservabilityEvent[]): boolean {
  if (events.length === 0 || !navigator.sendBeacon) return false;
  const context = getObservabilityContext();
  const body = JSON.stringify(createBatch(app, events));
  if (body.length > 60_000) return false;
  return navigator.sendBeacon(context.endpoint, new Blob([body], { type: "application/json" }));
}

function createBatch(app: ObservabilityApp, events: ObservabilityEvent[]): RumBatch {
  const context = getObservabilityContext();
  return {
    app,
    release: context.release,
    device_id: getDeviceId(),
    session_id: getSessionId(),
    user_agent: navigator.userAgent,
    events,
  };
}
