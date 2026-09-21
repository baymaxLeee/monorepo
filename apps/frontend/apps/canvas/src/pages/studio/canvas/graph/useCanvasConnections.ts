import { type Connection, type Edge, type OnBeforeDelete } from "@xyflow/react";
import { useSetAtom } from "jotai";
import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { Message } from "@/components/ui";
import type { canvasnode } from "@/domain";
import { BatchDeleteCanvasNodes, ConnectCanvasNodes, DeleteCanvasEdge } from "@/pages/studio/domain/persistence";
import t from "@/utils/i18n";

import { canvasRequestErrorMessage } from "../../domain/actions";
import { removeCanvasNodeAtom, upsertCanvasNodesAtom, useStudioMutationCoordinator } from "../../store";
import type { CanvasFlowNode } from "./canvasNodeTypes";
import type { resolveCanvasConnection } from "./connectionPolicy";
import { canvasNodeInputWarning } from "./nodeProtocol";

export function useCanvasConnections({
  canvasId,
  projectId,
  byID,
  nodesRef,
  edgesRef,
  setNodes,
  setEdges,
  resolveConnection,
  onCanvasRevisionChange,
}: {
  canvasId: string;
  projectId: string;
  byID: Map<string, canvasnode.CanvasNode>;
  nodesRef: MutableRefObject<CanvasFlowNode[]>;
  edgesRef: MutableRefObject<Edge[]>;
  setNodes: Dispatch<SetStateAction<CanvasFlowNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  resolveConnection: (
    source: canvasnode.CanvasNode,
    target: canvasnode.CanvasNode,
  ) => ReturnType<typeof resolveCanvasConnection>;
  onCanvasRevisionChange: (revision: number) => void;
}) {
  const enqueueCanvasMutation = useStudioMutationCoordinator().enqueue;
  const upsertCanvasNodes = useSetAtom(upsertCanvasNodesAtom);
  const removeCanvasNode = useSetAtom(removeCanvasNodeAtom);
  const pendingConnectionKeysRef = useRef(new Set<string>());
  const deleteNodes = useCallback(
    async (items: canvasnode.CanvasNode[]) => {
      if (!items.length) return false;
      const nodeIDs = new Set(items.map((item) => item.NodeID));
      if (items.some((item) => item.ActiveTaskRunID)) {
        Message.warning(t("生成中的节点不可删除"));
        return false;
      }
      if (
        edgesRef.current.some(
          (edge) =>
            nodeIDs.has(edge.source) &&
            !nodeIDs.has(edge.target) &&
            Boolean(nodesRef.current.find((node) => node.id === edge.target)?.data.item.ActiveTaskRunID),
        )
      ) {
        Message.warning(t("生成中的节点不可修改连接"));
        return false;
      }
      try {
        await enqueueCanvasMutation(async () => {
          const result = await BatchDeleteCanvasNodes(
            {
              ProjectID: projectId,
              CanvasID: canvasId,
              NodeIDs: [...nodeIDs],
            },
            { skipErrorNotify: true },
          );
          onCanvasRevisionChange(result.CanvasRevision);
          return result;
        });
        setNodes((current) => current.filter((node) => !nodeIDs.has(node.id)));
        for (const nodeID of nodeIDs) removeCanvasNode(nodeID);
        setEdges((current) => current.filter((edge) => !nodeIDs.has(edge.source) && !nodeIDs.has(edge.target)));
        return true;
      } catch {
        Message.error(t("节点删除失败，请重试"));
        return false;
      }
    },
    [canvasId, enqueueCanvasMutation, onCanvasRevisionChange, projectId, removeCanvasNode, setEdges, setNodes],
  );

  const persistConnection = useCallback(
    async (source: canvasnode.CanvasNode, target: canvasnode.CanvasNode) => {
      const connectionKey = `${source.NodeID}\u0000${target.NodeID}`;
      if (
        edgesRef.current.some((edge) => edge.source === source.NodeID && edge.target === target.NodeID) ||
        target.IncomingEdges.some((edge) => edge.SourceNodeID === source.NodeID) ||
        pendingConnectionKeysRef.current.has(connectionKey)
      ) {
        return true;
      }
      const resolution = resolveConnection(source, target);
      if (!resolution.accepted) {
        Message.warning(canvasNodeInputWarning(resolution));
        return false;
      }
      const targetPort = resolution.targetPort;
      pendingConnectionKeysRef.current.add(connectionKey);
      try {
        const result = await enqueueCanvasMutation(async () => {
          const connected = await ConnectCanvasNodes(
            {
              ProjectID: projectId,
              CanvasID: canvasId,
              SourceNodeID: source.NodeID,
              TargetNodeID: target.NodeID,
              TargetPort: targetPort,
            },
            { skipErrorNotify: true },
          );
          onCanvasRevisionChange(connected.CanvasRevision);
          return connected;
        });
        upsertCanvasNodes([result.TargetNode]);
        return true;
      } catch (error) {
        Message.error(canvasRequestErrorMessage(error, t("节点连接失败，请重试")));
        return false;
      } finally {
        pendingConnectionKeysRef.current.delete(connectionKey);
      }
    },
    [canvasId, enqueueCanvasMutation, onCanvasRevisionChange, projectId, resolveConnection, upsertCanvasNodes],
  );

  const connect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      const source = byID.get(connection.source);
      const target = byID.get(connection.target);
      if (!source || !target) return;
      await persistConnection(source, target);
    },
    [byID, persistConnection],
  );

  const deleteCanvasEdge = useCallback(
    async (edge: Edge) => {
      const target = byID.get(edge.target);
      if (!target) return false;
      if (target.ActiveTaskRunID) {
        Message.warning(t("生成中的节点不可修改连接"));
        return false;
      }
      try {
        const deleted = await enqueueCanvasMutation(async () => {
          const deleted = await DeleteCanvasEdge(
            {
              ProjectID: projectId,
              CanvasID: canvasId,
              TargetNodeID: target.NodeID,
              EdgeID: edge.id,
            },
            { skipErrorNotify: true },
          );
          onCanvasRevisionChange(deleted.CanvasRevision);
          return deleted;
        });
        upsertCanvasNodes([deleted.TargetNode]);
        return true;
      } catch {
        Message.error(t("连接删除失败，请重试"));
        return false;
      }
    },
    [byID, canvasId, enqueueCanvasMutation, onCanvasRevisionChange, projectId, upsertCanvasNodes],
  );

  const deleteSelectedElements = useCallback<OnBeforeDelete<CanvasFlowNode, Edge>>(
    async ({ nodes: selectedNodes, edges: selectedEdges }) => {
      const deletingNodeIDs = new Set(selectedNodes.map((node) => node.id));
      if (
        selectedEdges.some(
          (edge) => !deletingNodeIDs.has(edge.target) && Boolean(byID.get(edge.target)?.ActiveTaskRunID),
        )
      ) {
        Message.warning(t("生成中的节点不可修改连接"));
        return false;
      }
      if (selectedNodes.length > 0 && !(await deleteNodes(selectedNodes.map((node) => node.data.item)))) {
        return false;
      }
      for (const edge of selectedEdges) {
        if (deletingNodeIDs.has(edge.source) || deletingNodeIDs.has(edge.target)) {
          continue;
        }
        if (!(await deleteCanvasEdge(edge))) return false;
      }
      return { nodes: selectedNodes, edges: selectedEdges };
    },
    [byID, deleteCanvasEdge, deleteNodes],
  );

  return { connect, persistConnection, deleteSelectedElements };
}
