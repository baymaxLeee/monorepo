import { canvasGenerationStatus } from "@repo/api";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

import { generationStatusAtom } from "../store/generations";

export function useCanvasGenerations(canvasId: string, refreshGraph: () => Promise<void>) {
  const setStatus = useSetAtom(generationStatusAtom);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let previous = "";
    async function refresh() {
      try {
        const result = await canvasGenerationStatus(canvasId, { signal: controller.signal, skipErrorNotify: true });
        if (disposed) return;
        const signature = JSON.stringify(result.items);
        if (signature !== previous) {
          previous = signature;
          setStatus(new Map(result.items.map((item) => [item.node_id, item])));
          await refreshGraph();
        }
      } catch {
        /* Reconnect without replacing the last authoritative snapshot. */
      }
      if (!disposed) timer = setTimeout(refresh, 3000);
    }
    void refresh();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [canvasId, refreshGraph, setStatus]);
}
