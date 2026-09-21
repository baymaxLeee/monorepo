import { canvasGetGraph } from "@repo/api";
import { useAtomValue, useStore } from "jotai";
import { useCallback } from "react";

import { useAssetMatching } from "@/hooks/useAssetMatching";

import { presentGraph } from "../domain/persistence";
import { canvasAtom, canvasGraphAtom, replaceCanvasNodesAtom, updateCanvasRevisionAtom } from "../store";
import { useStudioMutationCoordinator } from "../store/mutations";

export function useMaterialMatching(nodeId: string) {
  const mutations = useStudioMutationCoordinator();
  const store = useStore();
  const canvas = useAtomValue(canvasAtom);
  const canvasId = canvas?.CanvasID ?? "";
  const refresh = useCallback(async () => {
    if (!canvasId) return;
    for (;;) {
      await mutations.waitForIdle();
      const epoch = mutations.snapshotEpoch();
      const graph = await canvasGetGraph(canvasId);
      const nodes = await presentGraph(graph);
      if (!mutations.isSnapshotCurrent(epoch)) continue;
      store.set(replaceCanvasNodesAtom, nodes);
      store.set(updateCanvasRevisionAtom, graph.canvas.revision);
      return;
    }
  }, [canvasId, mutations, store]);
  const matching = useAssetMatching({ canvasId, nodeId, onApplied: refresh });
  return {
    matching: matching.matching,
    cancelling: matching.cancelling,
    error: matching.error,
    async run(_projectId: string, _canvasId: string, prepare?: () => Promise<void>) {
      return matching.start(async () => {
        if (prepare) await prepare();
        return mutations.enqueue(async () => {
          const node = store.get(canvasGraphAtom).nodesById.get(nodeId);
          if (!node) throw new Error("节点已不存在，请刷新画布");
          return node.Revision;
        });
      });
    },
    cancel: (_projectId: string, _canvasId: string) => matching.cancel(),
  };
}
