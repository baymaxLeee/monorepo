import { canvasGetGraph, canvasMutateGraph, type CanvasGraph, type CanvasNode } from "@repo/api";
import { useAtomValue, useStore } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { applyGraphAtom, canvasGraphAtom, graphFailedAtom, graphRequestAtom } from "../store/graph";
import { canvasBusyAtom, useStudioMutationCoordinator } from "../store/mutations";

export function useCanvasGraph(canvasId: string) {
  const store = useStore();
  const graph = useAtomValue(canvasGraphAtom);
  const busy = useAtomValue(canvasBusyAtom);
  const failed = useAtomValue(graphFailedAtom);
  const coordinator = useStudioMutationCoordinator();
  const reader = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const request = store.get(graphRequestAtom) + 1;
    store.set(graphRequestAtom, request);
    reader.current?.abort();
    const controller = new AbortController();
    reader.current = controller;
    for (;;) {
      await coordinator.waitForIdle();
      if (controller.signal.aborted || store.get(graphRequestAtom) !== request) return;
      const epoch = coordinator.snapshotEpoch();
      try {
        const next = await canvasGetGraph(canvasId, { signal: controller.signal });
        if (controller.signal.aborted || store.get(graphRequestAtom) !== request) return;
        if (!coordinator.isSnapshotCurrent(epoch)) continue;
        store.set(applyGraphAtom, next);
        return;
      } catch {
        if (!controller.signal.aborted && store.get(graphRequestAtom) === request) store.set(graphFailedAtom, true);
        return;
      }
    }
  }, [canvasId, coordinator, store]);
  useEffect(() => {
    void refresh();
    return () => {
      reader.current?.abort();
    };
  }, [refresh]);

  function mutate(upsert: CanvasNode[] | ((current: CanvasGraph) => CanvasNode[]), deleteIds: string[] = []) {
    const operationId = crypto.randomUUID();
    return coordinator.enqueue(async () => {
      const current = store.get(canvasGraphAtom);
      if (!current) throw new Error("画布尚未就绪");
      try {
        const next = await canvasMutateGraph(canvasId, {
          operation_id: operationId,
          expected_revision: current.canvas.revision,
          upsert: typeof upsert === "function" ? upsert(current) : upsert,
          delete_ids: deleteIds,
        });
        store.set(applyGraphAtom, next);
      } catch (error) {
        // A queue item must not call refresh(), which waits for that same item.
        try {
          store.set(applyGraphAtom, await canvasGetGraph(canvasId));
        } catch {
          store.set(graphFailedAtom, true);
        }
        throw error;
      }
    });
  }
  return { graph, busy, failed, refresh, mutate };
}
