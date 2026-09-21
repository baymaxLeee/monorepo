import {
  canvasCopyResourceToCanvas,
  canvasCopyAsset,
  canvasNodeFrames,
  canvasSearchCreativeAssets,
  type CanvasCreativeAsset,
  type CanvasNode,
} from "@repo/api";
import { useStore } from "jotai";
import { useCallback } from "react";

import { applyGraphAtom, canvasGraphAtom } from "../store/graph";
import { useStudioMutationCoordinator } from "../store/mutations";

export interface CreativeAssetItem {
  id: string;
  name: string;
  type: number;
  source: "canvas" | "library";
  node?: CanvasNode;
  asset?: CanvasCreativeAsset;
}

function assetNodeType(mediaType: number) {
  if (mediaType === 1) return 1;
  if (mediaType === 2) return 2;
  return 3;
}

export function useCreativeAssets(projectId: string, canvasId: string) {
  const store = useStore();
  const coordinator = useStudioMutationCoordinator();
  const search = useCallback(
    async (query: string, accepts: (type: number) => boolean): Promise<CreativeAssetItem[]> => {
      const graph = store.get(canvasGraphAtom);
      const normalized = query.trim().toLocaleLowerCase();
      const local =
        graph?.nodes
          .filter((node) => accepts(node.type) && node.name.toLocaleLowerCase().includes(normalized))
          .map((node) => ({ id: node.id, name: node.name, type: node.type, source: "canvas" as const, node })) ?? [];
      const remote = await canvasSearchCreativeAssets(projectId, {
        params: { query: query.trim(), limit: 40 },
        skipErrorNotify: true,
      });
      const localAssetIds = new Set(graph?.nodes.map((node) => node.asset_id).filter(Boolean));
      return [
        ...local,
        ...remote.items
          .filter((asset) => accepts(assetNodeType(asset.media_type)) && !localAssetIds.has(asset.current_asset_id))
          .map((asset) => ({
            id: asset.resource_asset_id ? `resource:${asset.resource_asset_id}` : `node:${asset.node_id}`,
            name: asset.name,
            type: assetNodeType(asset.media_type),
            source: asset.resource_asset_id ? ("library" as const) : ("canvas" as const),
            asset,
          })),
      ];
    },
    [projectId, store],
  );
  const materialize = useCallback(
    async (item: CreativeAssetItem): Promise<CanvasNode> => {
      if (item.node) return item.node;
      if (!item.asset) throw new Error("素材信息已失效，请重新搜索");
      const existing = store.get(canvasGraphAtom)?.nodes.find((node) => node.asset_id === item.asset?.current_asset_id);
      if (existing) return existing;
      return coordinator.enqueue(async () => {
        const nodeId = crypto.randomUUID();
        const current = store.get(canvasGraphAtom);
        if (!current) throw new Error("画布已关闭");
        const graph = item.asset!.resource_asset_id
          ? await canvasCopyResourceToCanvas(canvasId, {
              node_id: nodeId,
              resource_asset_id: item.asset!.resource_asset_id,
            })
          : await canvasCopyAsset(canvasId, {
              asset_id: item.asset!.current_asset_id,
              node_id: nodeId,
              expected_revision: current.canvas.revision,
              x: 0,
              y: 0,
            });
        store.set(applyGraphAtom, graph);
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) throw new Error("素材已复制，但画布未返回对应节点");
        return node;
      });
    },
    [canvasId, coordinator, store],
  );
  const materializeFrame = useCallback(
    async (item: CreativeAssetItem, side: "first" | "last") => {
      if (!item.asset?.node_id || !item.asset.canvas_id) throw new Error("该视频没有可读取的帧信息");
      const frames = await canvasNodeFrames(item.asset.canvas_id, item.asset.node_id, { skipErrorNotify: true });
      const assetId = side === "first" ? frames.first_asset_id : frames.last_asset_id;
      if (frames.status !== "completed" || !assetId) throw new Error("视频首尾帧仍在处理中，请稍后重试");
      const current = store.get(canvasGraphAtom);
      const existing = current?.nodes.find((node) => node.asset_id === assetId);
      if (existing) return existing;
      return coordinator.enqueue(async () => {
        const graph = store.get(canvasGraphAtom);
        if (!graph) throw new Error("画布已关闭");
        const nodeId = crypto.randomUUID();
        const result = await canvasCopyAsset(canvasId, {
          asset_id: assetId,
          node_id: nodeId,
          expected_revision: graph.canvas.revision,
          x: 0,
          y: 0,
        });
        store.set(applyGraphAtom, result);
        const node = result.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) throw new Error("视频帧已复制，但画布未返回对应节点");
        return node;
      });
    },
    [canvasId, coordinator, store],
  );
  return { search, materialize, materializeFrame };
}
