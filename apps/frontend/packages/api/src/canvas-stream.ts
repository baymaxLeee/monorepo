import type { CanvasPatchEvent } from "../generated/canvas-server/index";
import { authFetch } from "./auth-fetch";
import { API_BASE_URL, apiHttp, ApiError } from "./http";

export class CanvasResyncRequired extends Error {}

/** Mutation completion includes observation by the page's single Canvas stream. */
export function observeCanvasReceipts(projectId: string, canvasId: string, wait: (cursor: number) => Promise<void>) {
  const scope = `/projects/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}`;
  const id = apiHttp.interceptors.response.use(async (response) => {
    const url = response.config.url ?? "";
    const cursor = response.headers["x-canvas-cursor"];
    if ((url.endsWith(scope) || url.includes(`${scope}/`)) && cursor !== undefined) {
      const value = Number(cursor);
      if (!Number.isSafeInteger(value) || value <= 0) throw new CanvasResyncRequired("Invalid Canvas receipt");
      await wait(value);
    }
    return response;
  });
  return () => apiHttp.interceptors.response.eject(id);
}

export async function subscribeCanvasEvents(
  projectId: string,
  canvasId: string,
  cursor: number,
  signal: AbortSignal,
  apply: (event: CanvasPatchEvent) => void | Promise<void>,
) {
  const path = `/api/canvas-server/projects/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}/events`;
  const response = await authFetch(`${API_BASE_URL}${path}`, {
    signal,
    headers: { Accept: "text/event-stream", "Last-Event-ID": String(cursor) },
  });
  if (!response.ok) throw new ApiError("画布同步连接失败", { status: response.status });
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new CanvasResyncRequired("Invalid Canvas stream response");
  }
  await consumeCanvasEvents(response.body, signal, apply);
}

export async function consumeCanvasEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  apply: (event: CanvasPatchEvent) => void | Promise<void>,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  const abort = () => void reader.cancel(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      try {
        buffer += decoder.decode(value, { stream: !done });
      } catch {
        throw new CanvasResyncRequired("Invalid Canvas UTF-8");
      }
      let end: number;
      while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const separator = buffer.slice(end).match(/^\r?\n\r?\n/)![0];
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + separator.length);
        if (new TextEncoder().encode(frame).length > 16 * 1024 * 1024)
          throw new CanvasResyncRequired("Canvas frame too large");
        const fields = frame.split(/\r?\n/);
        const event = fields
          .find((line) => line.startsWith("event:"))
          ?.slice(6)
          .trim();
        const id = fields
          .find((line) => line.startsWith("id:"))
          ?.slice(3)
          .trim();
        const data = fields
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (event === "canvas.resync_required") throw new CanvasResyncRequired("Canvas replay expired");
        if (event === "canvas.patch") {
          let patch: CanvasPatchEvent;
          try {
            patch = JSON.parse(data) as CanvasPatchEvent;
          } catch {
            throw new CanvasResyncRequired("Malformed Canvas event");
          }
          if (!patch || String(patch.cursor) !== id) throw new CanvasResyncRequired("Canvas event ID mismatch");
          await apply(patch);
        } else if (event && event !== "heartbeat") throw new CanvasResyncRequired("Unknown Canvas event");
      }
      if (buffer.length > 16 * 1024 * 1024) throw new CanvasResyncRequired("Canvas frame too large");
      if (done) {
        if (buffer.trim()) throw new CanvasResyncRequired("Truncated Canvas frame");
        return;
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
