import { getCanvasService } from "../generated/canvas-server/index";
export type {
  CanvasStoryboardDraft,
  CanvasStoryboardDraftInput,
  CanvasStoryboardShot,
  CanvasStoryboardConfirm,
  CanvasStoryboardDraftUpdate,
} from "../generated/canvas-server/index";
export const {
  canvasCreativeProviders,
  canvasGetStoryboard,
  canvasUpdateStoryboard,
  canvasStartStoryboard,
  canvasListStoryboards,
  canvasCancelStoryboard,
  canvasConfirmStoryboard,
} = getCanvasService();

import type { CanvasStoryboardDraft } from "../generated/canvas-server/index";
import { authFetch } from "./auth-fetch";
import { API_BASE_URL } from "./http";

/** The generated JSON client cannot consume a progressive SSE response. */
export async function observeCanvasStoryboard(
  canvasId: string,
  draftId: string,
  signal: AbortSignal,
  onSnapshot: (draft: CanvasStoryboardDraft) => void,
): Promise<void> {
  const response = await authFetch(
    `${API_BASE_URL}/api/canvas-server/canvases/${encodeURIComponent(canvasId)}/storyboards/${encodeURIComponent(draftId)}/stream`,
    { signal, headers: { Accept: "text/event-stream" } },
  );
  if (!response.ok || !response.body) throw new Error(`分镜进度连接失败（${response.status}）`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  let data: string[] = [];
  function line(value: string) {
    if (value === "") {
      if (data.length) {
        const snapshot: CanvasStoryboardDraft = JSON.parse(data.join("\n"));
        if (snapshot.id !== draftId || !Array.isArray(snapshot.shots)) throw new Error("分镜进度数据无效");
        onSnapshot(snapshot);
        data = [];
      }
    } else if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /, ""));
  }
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      pending += result.value;
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        line(pending.slice(0, end).replace(/\r$/, ""));
        pending = pending.slice(end + 1);
      }
    }
    if (pending) line(pending.replace(/\r$/, ""));
    line("");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
