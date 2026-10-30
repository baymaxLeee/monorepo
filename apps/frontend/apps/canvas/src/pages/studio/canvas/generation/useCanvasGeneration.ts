import { toast } from "@repo/design-system";
import { useCallback, useState } from "react";

import type { canvasnode } from "@/domain";

import { CancelCanvasNodeGeneration, StartCanvasNodeGeneration } from "../../domain/generations";
import { useStudioMutationCoordinator } from "../../store";
import { isDeletedReferenceNode } from "../graph/canvasNodeHelpers";

export function useCanvasGeneration({ canvasId, projectId }: { canvasId: string; projectId: string }) {
  const mutations = useStudioMutationCoordinator();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const generateNode = useCallback(
    async (item: canvasnode.CanvasNode) => {
      if (isDeletedReferenceNode(item) || item.ActiveTaskRunID || pending.has(item.NodeID)) return;
      setPending((current) => new Set(current).add(item.NodeID));
      try {
        await mutations.enqueue(() =>
          StartCanvasNodeGeneration({ ProjectID: projectId, CanvasID: canvasId, NodeID: item.NodeID }),
        );
      } catch {
        // The API already reports command errors; a rejected command is not a task failure.
      } finally {
        setPending((current) => {
          const next = new Set(current);
          next.delete(item.NodeID);
          return next;
        });
      }
    },
    [canvasId, projectId, mutations, pending],
  );
  const cancelNodeGeneration = useCallback(
    async (item: canvasnode.CanvasNode) => {
      if (isDeletedReferenceNode(item) || !item.ActiveTaskRunID) return;
      try {
        await mutations.enqueue(() =>
          CancelCanvasNodeGeneration({
            ProjectID: projectId,
            CanvasID: canvasId,
            NodeID: item.NodeID,
            TaskRunID: item.ActiveTaskRunID!,
          }),
        );
        toast.add({ type: "success", title: "已取消生成" });
      } catch {
        // Keep the SSE task state when the cancellation command is rejected.
      }
    },
    [canvasId, projectId, mutations],
  );
  return { generateNode, cancelNodeGeneration, textGenerationWaitingNodeIDs: pending };
}
