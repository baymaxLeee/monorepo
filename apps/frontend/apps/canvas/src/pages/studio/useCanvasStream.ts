import { canvasGetGraph, observeCanvasReceipts, subscribeCanvasEvents } from "@repo/api";
import { toast } from "@repo/design-system";
import { useStore } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { installCanvasProjectionAtom } from "./store/canvasGraph";
import { CanvasReplica } from "./store/canvasReplica";

export function useCanvasStream(projectId: string, canvasId: string) {
  const store = useStore();
  const replicaRef = useRef<CanvasReplica>(undefined);
  useEffect(() => {
    const replica = new CanvasReplica({
      snapshot: (signal) => canvasGetGraph(projectId, canvasId, { signal, skipErrorNotify: true }),
      events: (cursor, signal, apply) => subscribeCanvasEvents(projectId, canvasId, cursor, signal, apply),
      install: (projection) => store.set(installCanvasProjectionAtom, projection),
      unavailable: () => toast.add({ type: "error", title: "画布同步权限已失效或画布已删除，请重新进入画布" }),
    });
    replicaRef.current = replica;
    const stopReceipts = observeCanvasReceipts(projectId, canvasId, replica.waitForCursor);
    void replica.run();
    return () => {
      stopReceipts();
      replica.close();
      replicaRef.current = undefined;
    };
  }, [projectId, canvasId, store]);
  return useCallback(async () => {
    await replicaRef.current?.refresh();
  }, []);
}
