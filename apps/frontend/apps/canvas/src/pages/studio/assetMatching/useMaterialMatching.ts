import { canvasCancelNodeAssetMatch, canvasStartNodeAssetMatch } from "@repo/api";
import { toast } from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { useAtomValue, useStore } from "jotai";
import { useState } from "react";

import { canvasnode } from "@/domain";

import { canvasAtom, canvasGraphAtom } from "../store";
import { useStudioMutationCoordinator } from "../store/mutations";

export function useMaterialMatching(nodeId: string, node?: canvasnode.CanvasNode) {
  const mutations = useStudioMutationCoordinator();
  const store = useStore();
  const canvas = useAtomValue(canvasAtom);
  const canvasId = canvas?.CanvasID ?? "";
  const runId = node?.ActiveTaskType === canvasnode.CanvasNodeTaskType.ASSETS_MATCH ? node.ActiveTaskRunID : undefined;
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  return {
    matching: starting || Boolean(runId),
    cancelling,
    error: "",
    async run(_projectId: string, _canvasId: string, prepare?: () => Promise<void>) {
      if (!canvasId || !nodeId || starting || runId) return false;
      setStarting(true);
      try {
        if (prepare) await prepare();
        await mutations.enqueue(async () => {
          const node = store.get(canvasGraphAtom).nodesById.get(nodeId);
          if (!node) throw new Error("节点已不存在，请刷新画布");
          if (!canvas?.ProjectID) throw new Error("缺少项目标识");
          return canvasStartNodeAssetMatch(canvas.ProjectID, canvasId, nodeId, { revision: node.Revision });
        });
        return true;
      } catch (cause) {
        toast.add({
          type: "error",
          title: getErrorMessage(cause, "素材匹配启动失败"),
        });
        return false;
      } finally {
        setStarting(false);
      }
    },
    async cancel(_projectId: string, _canvasId: string) {
      if (!canvasId || !nodeId || !runId || cancelling) return;
      setCancelling(true);
      try {
        if (!canvas?.ProjectID) throw new Error("缺少项目标识");
        await mutations.enqueue(() => canvasCancelNodeAssetMatch(canvas.ProjectID, canvasId, nodeId, runId));
      } catch (cause) {
        toast.add({
          type: "error",
          title: getErrorMessage(cause, "取消素材匹配失败"),
        });
      } finally {
        setCancelling(false);
      }
    },
  };
}
