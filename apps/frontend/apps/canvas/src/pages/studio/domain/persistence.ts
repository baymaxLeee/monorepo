import {
  canvasGetGraph,
  canvasMutateGraph,
  canvasGenerationStatus,
  canvasCopyNode,
  canvasUploadNode,
  canvasCopyResourceToCanvas,
  canvasListResources,
  type ApiRequestConfig,
  type CanvasGraph,
  type CanvasNode,
  type CanvasGenerationState,
} from "@repo/api";

import { canvasnode as view } from "@/domain";

import { selectedUpload, completeUpload } from "../../../hooks/uploads";
import { nodeMediaURL } from "../../../utils/media";

export const ratios: Record<number, string> = {
  1: "21:9",
  2: "16:9",
  3: "4:3",
  4: "1:1",
  5: "3:4",
  6: "9:16",
  7: "3:2",
  8: "adaptive",
  9: "2:3",
};
export const resolutions: Record<number, string> = { 1: "480P", 2: "720P", 3: "1080P", 4: "2K", 5: "4K" };
const ports: Record<number, string> = {
  1: "OUTPUT",
  2: "REFERENCE_IMAGE",
  3: "REFERENCE_VIDEO",
  4: "REFERENCE_AUDIO",
  5: "REFERENCE_TEXT",
  6: "FIRST_FRAME",
  7: "LAST_FRAME",
};
const enumKey = (values: Record<number, string>, value: string, fallback: number) =>
  Number(Object.keys(values).find((key) => values[Number(key)]?.toLowerCase() === value?.toLowerCase()) ?? fallback);
export function generationConfig(
  config: view.CanvasNodeGenerationConfigPatch,
  current?: CanvasNode["generation_config"],
): CanvasNode["generation_config"] {
  return {
    provider_id: config.ModelServiceID ?? current?.provider_id ?? "",
    aspect_ratio:
      config.AspectRatio === undefined ? (current?.aspect_ratio ?? "16:9") : (ratios[config.AspectRatio] ?? "16:9"),
    resolution:
      config.Resolution === undefined ? (current?.resolution ?? "720P") : (resolutions[config.Resolution] ?? "720P"),
    duration_seconds: config.DurationSeconds ?? current?.duration_seconds ?? 5,
    generate_audio: config.GenerateAudio ?? current?.generate_audio ?? false,
    watermark: config.Watermark ?? current?.watermark ?? false,
  };
}
export function presentNode(graph: CanvasGraph, node: CanvasNode, state?: CanvasGenerationState): view.CanvasNode {
  const config = node.generation_config;
  const active = state && ["pending", "queued", "running", "cancelling"].includes(state.status);
  return {
    NodeID: node.id,
    CanvasID: graph.canvas.id,
    CanvasNodeNo:
      graph.nodes
        .filter((item) => item.type === view.CanvasNodeType.VIDEO_GENERATION)
        .sort((a, b) => a.storyboard_rank - b.storyboard_rank)
        .findIndex((item) => item.id === node.id) + 1,
    Prompt: node.prompt,
    Type: node.type,
    Name: node.name,
    Position: { PositionX: node.x, PositionY: node.y },
    Revision: node.revision,
    StoryboardRank: node.storyboard_rank,
    Text: node.text,
    SelectedOutputText: node.type === view.CanvasNodeType.TEXT_GENERATION ? node.text : undefined,
    AssetID: node.asset_id || undefined,
    CurrentAssetID: node.asset_id || undefined,
    SelectedAssetID: node.type >= 5 ? node.asset_id || undefined : undefined,
    Status: active
      ? view.CanvasNodeStatus.GENERATING
      : node.asset_id || node.text
        ? view.CanvasNodeStatus.READY
        : view.CanvasNodeStatus.EMPTY,
    ReferenceStatus: view.CanvasNodeReferenceStatus.ACTIVE,
    VideoInputMode: node.video_input_mode || 1,
    CreatedAt: graph.canvas.created_at,
    UpdatedAt: graph.canvas.updated_at,
    CreatedBy: "",
    UpdatedBy: "",
    ActiveTaskRunID: active ? state.id : undefined,
    GenerationConfig: {
      ModelServiceID: config.provider_id,
      Resolution: enumKey(resolutions, config.resolution, 2),
      AspectRatio: enumKey(ratios, config.aspect_ratio, 2),
      DurationSeconds: config.duration_seconds,
      GenerateAudio: config.generate_audio,
      Watermark: config.watermark,
    },
    IncomingEdges: node.incoming_edges.map((edge) => ({
      EdgeID: edge.id,
      SourceNodeID: edge.source_node_id,
      SourcePort: enumKey(ports, edge.source_port, 1),
      TargetPort: enumKey(ports, edge.target_port, 2),
      TargetOrder: edge.target_order,
    })),
  };
}
export async function presentGraph(graph: CanvasGraph, states: CanvasGenerationState[] = []) {
  return Promise.all(
    graph.nodes.map(async (node) => {
      const result = presentNode(
        graph,
        node,
        states.find((state) => state.node_id === node.id),
      );
      if (node.asset_id) {
        try {
          const url = await nodeMediaURL(graph.canvas.id, node.id, node.asset_id);
          result.PreviewURL = url;
          result.SelectedOutputURL = url;
        } catch {
          /* The node remains editable when media cannot be read. */
        }
      }
      return result;
    }),
  );
}
export async function writeGraph(
  canvasId: string,
  change: (graph: CanvasGraph) => { upsert?: CanvasNode[]; delete_ids?: string[] },
  options?: ApiRequestConfig,
) {
  const graph = await canvasGetGraph(canvasId, options);
  const mutation = change(graph);
  return canvasMutateGraph(
    canvasId,
    {
      expected_revision: graph.canvas.revision,
      operation_id: crypto.randomUUID(),
      upsert: mutation.upsert ?? [],
      delete_ids: mutation.delete_ids ?? [],
    },
    options,
  );
}
const requiredNode = (graph: CanvasGraph, id: string) => {
  const node = graph.nodes.find((item) => item.id === id);
  if (!node) throw new Error("节点已不存在，请刷新画布");
  return node;
};
async function responseNode(graph: CanvasGraph, id: string) {
  const node = requiredNode(graph, id);
  const result = presentNode(graph, node);
  if (node.asset_id) {
    try {
      result.PreviewURL = await nodeMediaURL(graph.canvas.id, id, node.asset_id);
      result.SelectedOutputURL = result.PreviewURL;
    } catch {
      /* Preserve graph data if media is unavailable. */
    }
  }
  return { CanvasNode: result, CanvasRevision: graph.canvas.revision };
}
export async function CreateCanvasNode(request: view.CreateCanvasNodeRequest, options?: ApiRequestConfig) {
  const id = crypto.randomUUID();
  if (request.UploadedAsset) {
    const selected = selectedUpload(request.UploadedAsset.BlobID);
    await canvasUploadNode(
      request.CanvasID,
      id,
      selected.file,
      { name: request.UploadedAsset.FileName },
      {
        signal: selected.controller.signal,
        onUploadProgress: (event) => {
          if (event.total) selected.progress((event.loaded * 100) / event.total);
        },
      },
    );
    completeUpload(request.UploadedAsset.BlobID);
    return UpdateCanvasNode({ ...request, NodeID: id }, options);
  }
  if (request.ResourceID || request.ResourceAssetID) {
    const resources = request.ResourceAssetID ? undefined : await canvasListResources(request.ProjectID, options);
    const asset =
      request.ResourceAssetID ??
      resources?.items.find((item) => item.id === request.ResourceID)?.primary_resource_asset_id;
    if (!asset) throw new Error("该资产没有可用素材");
    await canvasCopyResourceToCanvas(request.CanvasID, { resource_asset_id: asset, node_id: id }, options);
    return UpdateCanvasNode({ ...request, NodeID: id }, options);
  }
  const graph = await writeGraph(
    request.CanvasID,
    (current) => {
      const ordered = current.nodes
        .filter((node) => node.type === view.CanvasNodeType.VIDEO_GENERATION)
        .sort((a, b) => a.storyboard_rank - b.storyboard_rank);
      const afterIndex = request.AfterNodeID
        ? ordered.findIndex((node) => node.id === request.AfterNodeID)
        : ordered.length - 1;
      const following = ordered
        .slice(afterIndex + 1)
        .map((node) => ({ ...node, storyboard_rank: node.storyboard_rank + 1 }));
      const rank = ordered[afterIndex]?.storyboard_rank ?? 0;
      const node: CanvasNode = {
        id,
        type: request.Type,
        name:
          request.Name ??
          { 1: "图片", 2: "视频", 3: "音频", 4: "文本", 5: "图片生成", 6: "视频生成", 7: "文本生成" }[request.Type] ??
          "节点",
        x: request.Position.PositionX,
        y: request.Position.PositionY,
        text: request.Text ?? "",
        prompt: "",
        asset_id: request.AssetID ?? "",
        generation_config: generationConfig({ ModelServiceID: request.ModelServiceID }),
        incoming_edges: [],
        storyboard_rank: rank + 1,
        video_input_mode: 1,
        revision: 0,
      };
      return { upsert: [node, ...following] };
    },
    options,
  );
  return responseNode(graph, id);
}

export async function GetCanvasGraph(request: view.GetCanvasGraphRequest, options?: ApiRequestConfig) {
  const [graph, status] = await Promise.all([
    canvasGetGraph(request.CanvasID, options),
    canvasGenerationStatus(request.CanvasID, options),
  ]);
  return { Nodes: await presentGraph(graph, status.items) };
}

export async function UpdateCanvasNode(request: view.UpdateCanvasNodeRequest, options?: ApiRequestConfig) {
  const graph = await writeGraph(
    request.CanvasID,
    (current) => {
      const node = requiredNode(current, request.NodeID);
      return {
        upsert: [
          {
            ...node,
            name: request.Name ?? node.name,
            prompt: request.Prompt ?? node.prompt,
            text: request.Text ?? node.text,
            x: request.Position?.PositionX ?? node.x,
            y: request.Position?.PositionY ?? node.y,
            video_input_mode: request.VideoInputMode ?? node.video_input_mode,
            generation_config: generationConfig(request.GenerationConfig ?? {}, node.generation_config),
          },
        ],
      };
    },
    options,
  );
  return responseNode(graph, request.NodeID);
}

export async function DeleteCanvasNode(request: view.DeleteCanvasNodeRequest, options?: ApiRequestConfig) {
  const graph = await writeGraph(request.CanvasID, () => ({ delete_ids: [request.NodeID] }), options);
  return { CanvasRevision: graph.canvas.revision };
}

export async function BatchDeleteCanvasNodes(request: view.BatchDeleteCanvasNodesRequest, options?: ApiRequestConfig) {
  const graph = await writeGraph(request.CanvasID, () => ({ delete_ids: request.NodeIDs }), options);
  return { CanvasRevision: graph.canvas.revision };
}

export async function BatchUpdateCanvasNodePositions(
  request: view.BatchUpdateCanvasNodePositionsRequest,
  options?: ApiRequestConfig,
) {
  const graph = await writeGraph(
    request.CanvasID,
    (current) => ({
      upsert: request.Items.map((position) => ({
        ...requiredNode(current, position.NodeID),
        x: position.Position.PositionX,
        y: position.Position.PositionY,
      })),
    }),
    options,
  );
  return { Items: await presentGraph(graph) };
}

export async function CopyCanvasNode(request: view.CopyCanvasNodeRequest, options?: ApiRequestConfig) {
  const current = await canvasGetGraph(request.CanvasID, options);
  const id = crypto.randomUUID();
  await canvasCopyNode(
    request.CanvasID,
    request.SourceNodeID,
    { expected_revision: current.canvas.revision, node_id: id },
    options,
  );
  return UpdateCanvasNode({ ...request, NodeID: id }, options);
}

export async function ConnectCanvasNodes(request: view.ConnectCanvasNodesRequest, options?: ApiRequestConfig) {
  const graph = await writeGraph(
    request.CanvasID,
    (current) => {
      const target = requiredNode(current, request.TargetNodeID);
      requiredNode(current, request.SourceNodeID);
      const port = ports[request.TargetPort] ?? "REFERENCE_IMAGE";
      const incoming = target.incoming_edges.filter(
        (edge) => !(edge.source_node_id === request.SourceNodeID && edge.target_port === port),
      );
      return {
        upsert: [
          {
            ...target,
            incoming_edges: [
              ...incoming,
              {
                id: crypto.randomUUID(),
                source_node_id: request.SourceNodeID,
                source_port: "OUTPUT",
                target_port: port,
                target_order: request.TargetOrder ?? incoming.length,
              },
            ],
          },
        ],
      };
    },
    options,
  );
  return {
    TargetNode: (await responseNode(graph, request.TargetNodeID)).CanvasNode,
    CanvasRevision: graph.canvas.revision,
  };
}

export async function DeleteCanvasEdge(request: view.DeleteCanvasEdgeRequest, options?: ApiRequestConfig) {
  const graph = await writeGraph(
    request.CanvasID,
    (current) => ({
      upsert: current.nodes
        .filter((node) => node.incoming_edges.some((edge) => edge.id === request.EdgeID))
        .map((node) => ({ ...node, incoming_edges: node.incoming_edges.filter((edge) => edge.id !== request.EdgeID) })),
    }),
    options,
  );
  return {
    TargetNode: (await responseNode(graph, request.TargetNodeID)).CanvasNode,
    CanvasRevision: graph.canvas.revision,
  };
}

export async function ReorderStoryboardNodes(request: view.ReorderStoryboardNodesRequest, options?: ApiRequestConfig) {
  const graph = await writeGraph(
    request.CanvasID,
    (current) => ({
      upsert: request.Items.map((item) => ({
        ...requiredNode(current, item.NodeID),
        storyboard_rank: item.StoryboardRank,
      })),
    }),
    options,
  );
  return { Nodes: await presentGraph(graph), CanvasRevision: graph.canvas.revision };
}
