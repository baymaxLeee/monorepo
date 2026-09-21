import { canvasListStoryboards, observeCanvasStoryboard, type CanvasStoryboardDraft } from "@repo/api";
import { useEffect, useState } from "react";

export function useStoryboardDrafts(canvasId: string, open: boolean, selectedId: string | null) {
  const [items, setItems] = useState<CanvasStoryboardDraft[]>([]);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [streamFailed, setStreamFailed] = useState(false);
  const selected = items.find((item) => item.id === selectedId);
  const activeId = selected && ["queued", "running"].includes(selected.status) ? selected.id : null;
  useEffect(() => {
    if (!open || !canvasId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await canvasListStoryboards(canvasId, { signal: controller.signal, skipErrorNotify: true });
        if (!controller.signal.aborted) {
          setItems((current) =>
            result.items.map((item) => {
              const previous = current.find((value) => value.id === item.id);
              return previous && previous.revision > item.revision ? previous : item;
            }),
          );
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 5000);
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [canvasId, open, version]);
  useEffect(() => {
    if (!open || !activeId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function connect() {
      try {
        await observeCanvasStoryboard(canvasId, activeId!, controller.signal, (draft) => {
          if (controller.signal.aborted) return;
          setStreamFailed(false);
          setItems((current) =>
            current.map((item) => (item.id === draft.id && item.revision <= draft.revision ? draft : item)),
          );
        });
      } catch {
        if (!controller.signal.aborted) setStreamFailed(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(connect, 2000);
    }
    void connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [canvasId, activeId, open]);
  return { items, failed, streamFailed, refresh: () => setVersion((value) => value + 1) };
}
