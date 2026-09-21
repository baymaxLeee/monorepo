import { canvasCancelAssetMatch, canvasGenerationStatus, canvasGetGraph, canvasStartAssetMatch } from "@repo/api";
import { getErrorMessage } from "@repo/shared";
import { useAtomValue, useStore } from "jotai";
import { useCallback, useRef, useState } from "react";

import { Message } from "@/components/ui";
import { canvasnode } from "@/domain";

import { presentGraph } from "../domain/persistence";
import {
  canvasAtom,
  canvasGraphAtom,
  patchCanvasNodeAtom,
  replaceCanvasNodesAtom,
  updateCanvasRevisionAtom,
} from "../store";
import { useStudioMutationCoordinator } from "../store/mutations";

export function useMaterialMatching(nodeId: string) {
  const mutations = useStudioMutationCoordinator();
  const store = useStore();
  const canvas = useAtomValue(canvasAtom);
  const canvasId = canvas?.CanvasID ?? "";
  const node = useAtomValue(canvasGraphAtom).nodesById.get(nodeId);
  const runId = node?.ActiveTaskType === canvasnode.CanvasNodeTaskType.ASSETS_MATCH ? node.ActiveTaskRunID : undefined;
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const operationId = useRef("");
  const refresh = useCallback(async () => {
    const [graph, status] = await Promise.all([canvasGetGraph(canvasId), canvasGenerationStatus(canvasId)]);
    store.set(replaceCanvasNodesAtom, await presentGraph(graph, status.items));
    store.set(updateCanvasRevisionAtom, graph.canvas.revision);
  }, [canvasId, store]);
  return {
    matching: starting || Boolean(runId),
    cancelling,
    error: "",
    async run(_projectId: string, _canvasId: string, prepare?: () => Promise<void>) {
      if (!canvasId || !nodeId || starting || runId) return false;
      setStarting(true);
      try {
        if (prepare) await prepare();
        const result = await mutations.enqueue(async () => {
          const node = store.get(canvasGraphAtom).nodesById.get(nodeId);
          if (!node) throw new Error("节点已不存在，请刷新画布");
          operationId.current ||= crypto.randomUUID();
          return canvasStartAssetMatch(canvasId, nodeId, {
            operation_id: operationId.current,
            expected_revision: node.Revision,
          });
        });
        operationId.current = "";
        store.set(patchCanvasNodeAtom, {
          nodeId,
          patch: {
            ActiveTaskRunID: result.id,
            ActiveTaskType: canvasnode.CanvasNodeTaskType.ASSETS_MATCH,
          },
        });
        return true;
      } catch (cause) {
        Message.error(getErrorMessage(cause, "素材匹配启动失败"));
        return false;
      } finally {
        setStarting(false);
      }
    },
    async cancel(_projectId: string, _canvasId: string) {
      if (!canvasId || !nodeId || !runId || cancelling) return;
      setCancelling(true);
      try {
        const result = await mutations.enqueue(() => canvasCancelAssetMatch(canvasId, nodeId, runId));
        if (result.applied) {
          await refresh();
          return;
        }
        const current = store.get(canvasGraphAtom).nodesById.get(nodeId);
        if (current?.ActiveTaskRunID === runId) {
          store.set(patchCanvasNodeAtom, {
            nodeId,
            patch: { ActiveTaskRunID: undefined, ActiveTaskType: undefined },
          });
        }
      } catch (cause) {
        Message.error(getErrorMessage(cause, "取消素材匹配失败"));
      } finally {
        setCancelling(false);
      }
    },
  };
}
