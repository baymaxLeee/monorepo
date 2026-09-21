import { useSetAtom } from "jotai";
import { useCallback, type RefObject } from "react";

import { agentframeService } from "@/api";
import { type AssetMentionItem, mentionReferenceIdentity } from "@/components/promptEditor";
import { Message } from "@/components/ui";
import type { canvasnode } from "@/domain";
import { ConnectCanvasNodes } from "@/pages/studio/domain/persistence";
import t from "@/utils/i18n";

import { canvasRequestErrorMessage, queryMentionTree } from "../../domain/actions";
import { assetFromCanvasNode, materializedCanvasNodeAssetId } from "../../domain/model";
import type { StoryboardAsset } from "../../domain/types";
import { upsertCanvasNodesAtom, useStudioMutationCoordinator } from "../../store";
import { useStudioAssetStore } from "../../store/assets";
import { isDeletedReferenceNode, MATERIALIZED_NODE_HORIZONTAL_GAP } from "../graph/canvasNodeHelpers";
import type { CanvasFlowNode } from "../graph/canvasNodeTypes";
import type { resolveCanvasConnection } from "../graph/connectionPolicy";
import { canvasNodeInputMediaTypes, canvasNodeInputWarning, resolveCanvasNodeInput } from "../graph/nodeProtocol";

type CompatibleMaterializeResourceReferenceRequest = Omit<
  canvasnode.MaterializeCanvasResourceAssetReferenceRequest,
  "ResourceAssetID"
> & {
  ReferenceType: number;
  ResourceID?: string;
  ResourceAssetID?: string;
};
type CompatibleMaterializeAssetReferenceRequest = canvasnode.MaterializeCanvasStandaloneAssetReferenceRequest & {
  ReferenceType: number;
};

export function useCanvasNodeAssets({
  canvasId,
  projectId,
  nodesRef,
  resolveConnection,
  onCanvasRevisionChange,
}: {
  canvasId: string;
  projectId: string;
  nodesRef: RefObject<CanvasFlowNode[]>;
  resolveConnection: (
    source: canvasnode.CanvasNode,
    target: canvasnode.CanvasNode,
  ) => ReturnType<typeof resolveCanvasConnection>;
  onCanvasRevisionChange: (revision: number) => void;
}) {
  const assetStore = useStudioAssetStore();
  const enqueueCanvasMutation = useStudioMutationCoordinator().enqueue;
  const upsertCanvasNodes = useSetAtom(upsertCanvasNodesAtom);
  const queryNodeAssets = useCallback(
    (nodeID: string, query: string, cursor: string | undefined, limit: number, signal: AbortSignal) => {
      signal.throwIfAborted();
      const target = nodesRef.current?.find((node) => node.id === nodeID)?.data.item;
      if (!target) {
        return Promise.resolve({ items: [] });
      }
      return queryMentionTree(
        agentframeService,
        projectId,
        canvasId,
        nodeID,
        query,
        cursor,
        limit,
        canvasNodeInputMediaTypes(target, "material"),
      );
    },
    [canvasId, nodesRef, projectId],
  );

  const selectNodeAsset = useCallback(
    async (target: canvasnode.CanvasNode, candidate: AssetMentionItem) => {
      const liveTargetNode = nodesRef.current?.find((node) => node.id === target.NodeID);
      const liveTarget = liveTargetNode?.data.item;
      if (!liveTarget) throw new Error("canvas node is not available");
      if (isDeletedReferenceNode(liveTarget)) {
        throw new Error("deleted reference node cannot accept assets");
      }
      const reference = mentionReferenceIdentity(candidate);
      if (!reference) throw new Error("asset reference is not available");
      if (reference.kind === "canvasNode") {
        const sourceNode = nodesRef.current?.find((node) => node.id === reference.CanvasNodeID);
        const source = sourceNode?.data.item;
        if (!source) throw new Error("source canvas node is not available");
        const resolution = resolveConnection(source, liveTarget);
        if (!resolution.accepted) {
          Message.warning(canvasNodeInputWarning(resolution));
          throw new Error("canvas node input rejected");
        }
        const targetPort = resolution.targetPort;
        if (!liveTarget.IncomingEdges.some((edge) => edge.SourceNodeID === source.NodeID)) {
          const result = await enqueueCanvasMutation(async () => {
            const connected = await ConnectCanvasNodes(
              {
                ProjectID: projectId,
                CanvasID: canvasId,
                SourceNodeID: source.NodeID,
                TargetNodeID: liveTarget.NodeID,
                TargetPort: targetPort,
              },
              { skipErrorNotify: true },
            );
            onCanvasRevisionChange(connected.CanvasRevision);
            return connected;
          });
          upsertCanvasNodes([result.TargetNode]);
        }
        const selected: StoryboardAsset = {
          ...assetFromCanvasNode(source, undefined, targetPort),
          ...candidate,
          id: source.NodeID,
          referenceType: "canvasNode",
          canvasNodeId: source.NodeID,
          description: candidate.description ?? source.Text ?? source.Prompt,
          resourceAssetId: candidate.resourceAssetId ?? source.ResourceAssetID,
          syncStatus: "ready",
        };
        assetStore.cacheDetails([selected]);
        return selected;
      }
      const targetWidth = liveTargetNode.measured?.width;
      if (!targetWidth) throw new Error("canvas node has not been measured");
      const resolution = resolveCanvasNodeInput(candidate.category, liveTarget, {
        kind: "material",
      });
      if (!resolution.accepted) {
        Message.warning(canvasNodeInputWarning(resolution));
        throw new Error("canvas node input rejected");
      }
      const targetPort = resolution.targetPort;
      const materializedPosition = {
        PositionX: liveTargetNode.position.x - targetWidth - MATERIALIZED_NODE_HORIZONTAL_GAP,
        PositionY: liveTargetNode.position.y,
      };
      const response = await enqueueCanvasMutation(async () => {
        if (reference.kind === "asset") {
          const request: CompatibleMaterializeAssetReferenceRequest = {
            ProjectID: projectId,
            CanvasID: canvasId,
            TargetNodeID: target.NodeID,
            ReferenceType: reference.ReferenceType,
            AssetID: reference.AssetID,
            TargetPort: targetPort,
            AssetNodePosition: materializedPosition,
          };
          const materialized = await agentframeService.MaterializeCanvasStandaloneAssetReference(request, {
            skipErrorNotify: true,
          });
          onCanvasRevisionChange(materialized.CanvasRevision);
          return {
            assetNode: materialized.AssetNode,
            targetNode: materialized.TargetNode,
          };
        }
        const request: CompatibleMaterializeResourceReferenceRequest = {
          ProjectID: projectId,
          CanvasID: canvasId,
          TargetNodeID: target.NodeID,
          ReferenceType: reference.ReferenceType,
          ...(reference.kind === "resource"
            ? { ResourceID: reference.ResourceID }
            : { ResourceAssetID: reference.ResourceAssetID }),
          TargetPort: targetPort,
          ResourceAssetNodePosition: materializedPosition,
        };
        const materialized = await agentframeService.MaterializeCanvasResourceAssetReference(request, {
          skipErrorNotify: true,
        });
        onCanvasRevisionChange(materialized.CanvasRevision);
        return {
          assetNode: materialized.ResourceAssetNode,
          targetNode: materialized.TargetNode,
        };
      });
      const selected: AssetMentionItem = {
        ...candidate,
        id: response.assetNode.NodeID,
        referenceType: "canvasNode",
        assetId: materializedCanvasNodeAssetId(response.assetNode, candidate.assetId),
        canvasNodeId: response.assetNode.NodeID,
        previewUrl: response.assetNode.PreviewURL || candidate.previewUrl,
        thumbnail: candidate.thumbnail || (candidate.category === "image" ? response.assetNode.PreviewURL : undefined),
        resourceId: response.assetNode.ResourceID ?? candidate.resourceId,
        resourceAssetId: response.assetNode.ResourceAssetID ?? candidate.resourceAssetId,
      };
      assetStore.cacheDetails([
        {
          ...selected,
          description: selected.description ?? "",
          syncStatus: "ready",
        },
      ]);
      upsertCanvasNodes([response.assetNode, response.targetNode]);
      return selected;
    },
    [
      assetStore,
      canvasId,
      enqueueCanvasMutation,
      onCanvasRevisionChange,
      projectId,
      resolveConnection,
      upsertCanvasNodes,
    ],
  );

  const selectNodeAssetWithFeedback = useCallback(
    async (target: canvasnode.CanvasNode, candidate: AssetMentionItem) => {
      try {
        return await selectNodeAsset(target, candidate);
      } catch (error) {
        Message.error(canvasRequestErrorMessage(error, t("添加素材失败，请重试")));
        throw error;
      }
    },
    [selectNodeAsset],
  );

  return { queryNodeAssets, selectNodeAssetWithFeedback };
}
