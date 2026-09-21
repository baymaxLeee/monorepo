import { canvasGetView, canvasSaveView } from "@repo/api";
import { useReactFlow, useOnViewportChange } from "@xyflow/react";
import { useEffect, useRef } from "react";

export function CanvasViewport({ canvasId }: { canvasId: string }) {
  const flow = useReactFlow();
  const ready = useRef(false);
  const pending = useRef(Promise.resolve());
  useEffect(() => {
    const controller = new AbortController();
    ready.current = false;
    void canvasGetView(canvasId, { signal: controller.signal, skipErrorNotify: true })
      .then(async (view) => {
        if (controller.signal.aborted) return;
        await flow.setViewport(view);
        ready.current = true;
      })
      .catch(() => {});
    return () => {
      controller.abort();
      ready.current = false;
    };
  }, [canvasId, flow]);
  useOnViewportChange({
    onEnd: (view) => {
      if (!ready.current) return;
      pending.current = pending.current
        .then(async () => {
          await canvasSaveView(canvasId, view, { skipErrorNotify: true });
        })
        .catch(() => {});
    },
  });
  return null;
}
