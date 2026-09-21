import { type Edge, type ReactFlowInstance } from "@xyflow/react";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { Message } from "@/components/ui";
import { BatchUpdateCanvasNodePositions } from "@/pages/studio/domain/persistence";
import t from "@/utils/i18n";

import { canvasLayoutRequestAtom, upsertCanvasNodesAtom, useStudioMutationCoordinator } from "../../store";
import type { CanvasFlowNode } from "./canvasNodeTypes";
import { connectedNodeIDs, hasCanvasLayoutSeedNodes, hasMeasuredCanvasNodes, layoutCanvasNodes } from "./layout";
import { canvasNodePositionUpdates } from "./nodePositionPersistence";

export function useCanvasLayout({
  canvasId,
  projectId,
  nodes,
  edges,
  nodesRef,
  edgesRef,
  setNodes,
  instance,
  graphLoaded,
  onRefreshGraph,
}: {
  canvasId: string;
  projectId: string;
  nodes: CanvasFlowNode[];
  edges: Edge[];
  nodesRef: MutableRefObject<CanvasFlowNode[]>;
  edgesRef: MutableRefObject<Edge[]>;
  setNodes: Dispatch<SetStateAction<CanvasFlowNode[]>>;
  instance?: ReactFlowInstance<CanvasFlowNode, Edge>;
  graphLoaded: boolean;
  onRefreshGraph: () => Promise<void>;
}) {
  const enqueueCanvasMutation = useStudioMutationCoordinator().enqueue;
  const upsertCanvasNodes = useSetAtom(upsertCanvasNodesAtom);
  const layoutRequest = useAtomValue(canvasLayoutRequestAtom);
  const loadedLayoutRequestRef = useRef(0);
  const handledLayoutRequestRef = useRef(0);
  const initialFitDoneRef = useRef(false);
  useEffect(() => {
    initialFitDoneRef.current = false;
  }, [canvasId]);

  const arrangeNodes = useCallback(
    async (targetNodeIDs?: Set<string>) => {
      const currentNodes = nodesRef.current;
      const targets = targetNodeIDs ?? new Set(currentNodes.map((node) => node.id));
      const positions = layoutCanvasNodes(currentNodes, edgesRef.current, targets);
      if (!positions) return false;

      setNodes((current) =>
        current.map((node) => {
          const position = positions.get(node.id);
          return position ? { ...node, position } : node;
        }),
      );
      try {
        const response = await enqueueCanvasMutation(async () => {
          const updated = await BatchUpdateCanvasNodePositions(
            {
              ProjectID: projectId,
              CanvasID: canvasId,
              Items: currentNodes
                .filter((node) => targets.has(node.id))
                .map((node) => ({
                  NodeID: node.id,
                  Position: {
                    PositionX: positions.get(node.id)!.x,
                    PositionY: positions.get(node.id)!.y,
                  },
                })),
            },
            { skipErrorNotify: true },
          );
          return updated;
        });
        const updatedByID = new Map(response.Items.map((item) => [item.NodeID, item]));
        upsertCanvasNodes(response.Items);
        setNodes((current) =>
          current.map((node) => {
            const item = updatedByID.get(node.id);
            const position = positions.get(node.id);
            return item && position ? { ...node, position, data: { ...node.data, item } } : node;
          }),
        );
        window.requestAnimationFrame(() => {
          void instance?.fitView({
            duration: 300,
            nodes: nodesRef.current.filter((node) => targets.has(node.id)),
            padding: 0.15,
          });
        });
        return true;
      } catch {
        await onRefreshGraph();
        return false;
      }
    },
    [canvasId, enqueueCanvasMutation, instance, onRefreshGraph, projectId, setNodes, upsertCanvasNodes],
  );

  useEffect(() => {
    if (!layoutRequest || layoutRequest.requestId <= handledLayoutRequestRef.current) {
      return;
    }
    if (loadedLayoutRequestRef.current !== layoutRequest.requestId) {
      loadedLayoutRequestRef.current = layoutRequest.requestId;
    }
    if (!hasCanvasLayoutSeedNodes(layoutRequest.seedNodeIds, nodes)) return;
    if (!hasMeasuredCanvasNodes(nodes)) return;
    const targets = connectedNodeIDs(layoutRequest.seedNodeIds, nodes, edges);
    handledLayoutRequestRef.current = layoutRequest.requestId;
    void arrangeNodes(targets).then((success) => {
      if (success) Message.success(t("新分镜已整理到画布空白区域"));
    });
  }, [arrangeNodes, edges, layoutRequest, nodes]);

  useEffect(() => {
    if (!instance || !graphLoaded || initialFitDoneRef.current || nodes.length === 0) {
      return;
    }
    initialFitDoneRef.current = true;
    const animationFrame = window.requestAnimationFrame(() => {
      void instance.fitView({
        duration: 0,
        maxZoom: 1,
        padding: 0.15,
      });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [graphLoaded, instance, nodes.length]);

  const persistPosition = useCallback(
    async (_: unknown, node: CanvasFlowNode, draggedNodes: CanvasFlowNode[]) => {
      const positionUpdates = canvasNodePositionUpdates(node, draggedNodes);
      try {
        const response = await enqueueCanvasMutation(async () => {
          const updated = await BatchUpdateCanvasNodePositions(
            {
              ProjectID: projectId,
              CanvasID: canvasId,
              Items: positionUpdates,
            },
            { skipErrorNotify: true },
          );
          return updated;
        });
        const updatedByID = new Map(response.Items.map((item) => [item.NodeID, item]));
        setNodes((current) =>
          current.map((currentNode) => {
            const item = updatedByID.get(currentNode.id);
            return item
              ? {
                  ...currentNode,
                  data: { ...currentNode.data, item },
                }
              : currentNode;
          }),
        );
        upsertCanvasNodes(response.Items);
      } catch {
        Message.error(t("节点位置保存失败"));
        void onRefreshGraph();
      }
    },
    [canvasId, enqueueCanvasMutation, onRefreshGraph, projectId, setNodes, upsertCanvasNodes],
  );

  return { arrangeNodes, persistPosition };
}
