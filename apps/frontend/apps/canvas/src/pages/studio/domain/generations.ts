import {
  canvasGetGraph,
  canvasStartGeneration,
  canvasStartAllVideoGenerations,
  canvasCancelGeneration,
  canvasListGenerations,
  canvasApplyGeneration,
  canvasGetAssetMatch,
  type ApiRequestConfig,
  type CanvasGeneration,
} from "@repo/api";

import { canvasnode } from "@/domain";
import { generationMediaURL } from "@/utils/media";

import { presentGraph, presentNode } from "./persistence";

const statuses: Record<string, canvasnode.CanvasGenerationStatus> = {
  pending: 1,
  queued: 1,
  running: 2,
  completed: 3,
  cancelling: 2,
  succeeded: 3,
  failed: 4,
  cancelled: 5,
};
export const generationStatus = (status: string) => statuses[status] ?? canvasnode.CanvasGenerationStatus.FAILED;

export async function StartCanvasNodeGeneration(
  input: { CanvasID: string; NodeID: string; ProjectID?: string },
  options?: ApiRequestConfig,
) {
  const graph = await canvasGetGraph(input.CanvasID, options);
  const node = graph.nodes.find((item) => item.id === input.NodeID);
  if (!node) throw new Error("节点已不存在");
  const result = await canvasStartGeneration(
    input.CanvasID,
    input.NodeID,
    { expected_revision: node.revision, operation_id: crypto.randomUUID() },
    options,
  );
  return { TaskRunID: result.id };
}
export async function StartCanvasGeneration(
  input: { CanvasID: string; ProjectID?: string },
  options?: ApiRequestConfig,
) {
  const result = await canvasStartAllVideoGenerations(input.CanvasID, { operation_id: crypto.randomUUID() }, options);
  return {
    Items: result.started.map((item) => ({ NodeID: item.node_id, TaskRunID: item.task_run_id })),
    SkippedCount: result.skipped_count,
  };
}
export async function CancelCanvasNodeGeneration(
  input: { CanvasID: string; TaskRunID: string; NodeID?: string; ProjectID?: string },
  options?: ApiRequestConfig,
) {
  await canvasCancelGeneration(input.CanvasID, input.TaskRunID, options);
}
export const CancelCanvasNodeTextGeneration = CancelCanvasNodeGeneration;

export async function BatchGetCanvasNodeStates(
  input: {
    CanvasID: string;
    ProjectID?: string;
    Targets: Array<{ NodeID: string; TaskRunID: string; TaskType?: canvasnode.CanvasNodeTaskType }>;
  },
  options?: ApiRequestConfig,
) {
  const runs = await Promise.all(
    input.Targets.map(async (target) => {
      if (target.TaskType === canvasnode.CanvasNodeTaskType.ASSETS_MATCH) {
        const run = await canvasGetAssetMatch(input.CanvasID, target.NodeID, target.TaskRunID, options);
        return { target, run, matching: true } as const;
      }
      const runs = await canvasListGenerations(input.CanvasID, target.NodeID, options);
      const run = runs.items.find((item) => item.id === target.TaskRunID);
      return run ? ({ target, run, matching: false } as const) : undefined;
    }),
  );
  const graph = await canvasGetGraph(input.CanvasID, options);
  const nodes = await presentGraph(graph);
  const Items = runs.flatMap((state): canvasnode.CanvasNodeState[] => {
    if (!state) return [];
    const { target, run, matching } = state;
    const node = nodes.find((item) => item.NodeID === target.NodeID);
    if (!node) return [];
    if (["queued", "running"].includes(run.status)) {
      node.ActiveTaskRunID = run.id;
      node.ActiveTaskType = matching
        ? canvasnode.CanvasNodeTaskType.ASSETS_MATCH
        : canvasnode.CanvasNodeTaskType.GENERATION;
      if (!matching) node.Status = canvasnode.CanvasNodeStatus.GENERATING;
    }
    const relatedIds = new Set(node.IncomingEdges.map((edge) => edge.SourceNodeID));
    return [
      {
        NodeID: target.NodeID,
        TaskRunID: run.id,
        Status: generationStatus(run.status),
        TaskType: matching ? canvasnode.CanvasNodeTaskType.ASSETS_MATCH : canvasnode.CanvasNodeTaskType.GENERATION,
        Node: node,
        RelatedNodes: matching ? nodes.filter((item) => relatedIds.has(item.NodeID)) : [],
        ErrorMessage: run.error || undefined,
        VideoProviderStatus: canvasnode.CanvasNodeVideoProviderStatus.UNKNOWN,
      },
    ];
  });
  return { Items, CanvasRevision: graph.canvas.revision };
}

async function history(run: CanvasGeneration, canvasId: string, type: number): Promise<canvasnode.CanvasNodeHistory> {
  const result: canvasnode.CanvasNodeHistory = {
    HistoryID: run.id,
    Status: generationStatus(run.status),
    ModelServiceID: run.provider_id,
    Prompt: run.prompt,
    CreatedAt: run.created_at,
    CompletedAt: ["completed", "succeeded", "failed", "cancelled"].includes(run.status) ? run.updated_at : undefined,
    ProviderStatus: canvasnode.CanvasNodeVideoProviderStatus.UNKNOWN,
    ResourceAssetSnapshots: [],
    Type: type,
    OutputAssetID: run.output_asset_id || undefined,
    OutputText: run.output_text || undefined,
    ErrorMessage: run.error || undefined,
  };
  if (run.output_asset_id && ["completed", "succeeded"].includes(run.status)) {
    result.OutputURL = await generationMediaURL(canvasId, run.id);
    if (type === canvasnode.CanvasNodeType.VIDEO_GENERATION) result.VideoURL = result.OutputURL;
  }
  return result;
}
export async function ListCanvasNodeHistories(
  input: { CanvasID: string; NodeID: string; ProjectID?: string },
  options?: ApiRequestConfig,
) {
  const [graph, runs] = await Promise.all([
    canvasGetGraph(input.CanvasID, options),
    canvasListGenerations(input.CanvasID, input.NodeID, options),
  ]);
  const node = graph.nodes.find((item) => item.id === input.NodeID);
  if (!node) throw new Error("节点已不存在");
  return { Items: await Promise.all(runs.items.map((run) => history(run, input.CanvasID, node.type))) };
}
export async function SelectCanvasNodeHistory(
  input: { CanvasID: string; NodeID: string; HistoryID: string; ProjectID?: string },
  options?: ApiRequestConfig,
) {
  const [current, runs] = await Promise.all([
    canvasGetGraph(input.CanvasID, options),
    canvasListGenerations(input.CanvasID, input.NodeID, options),
  ]);
  const selected = runs.items.find((run) => run.id === input.HistoryID);
  if (!selected) throw new Error("生成记录已不存在，请刷新后重试");
  const currentNode = current.nodes.find((item) => item.id === input.NodeID);
  if (!currentNode) throw new Error("节点已不存在");
  const graph = await canvasApplyGeneration(
    input.CanvasID,
    input.HistoryID,
    { expected_revision: currentNode.revision },
    options,
  );
  const node = graph.nodes.find((item) => item.id === input.NodeID);
  if (!node) throw new Error("节点已不存在");
  return {
    CanvasNode: { ...presentNode(graph, node), SelectedOutputID: input.HistoryID },
    CanvasRevision: graph.canvas.revision,
    History: await history(selected, input.CanvasID, node.type),
  };
}
