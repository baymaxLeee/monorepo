import {
  canvasBatchGetNodeStates,
  canvasStartGeneration,
  canvasStartAllVideoGenerations,
  canvasCancelGeneration,
  canvasGetGraph,
  canvasListGenerations,
  canvasApplyGeneration,
  type ApiRequestConfig,
  type CanvasGeneration,
} from "@repo/api";

import { canvasnode } from "@/domain";
import { generationMediaURL } from "@/utils/media";

import { presentNode } from "./persistence";

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
  const response = await canvasBatchGetNodeStates(
    input.CanvasID,
    {
      targets: input.Targets.map((target) => ({
        node_id: target.NodeID,
        task_run_id: target.TaskRunID,
        task_type: target.TaskType ?? canvasnode.CanvasNodeTaskType.GENERATION,
      })),
    },
    options,
  );
  const rawNodes = response.items.flatMap((state) => [state.node, ...state.related_nodes]);
  const graph = {
    canvas: {
      id: input.CanvasID,
      project_id: input.ProjectID ?? "",
      name: "",
      cover_image_path: "",
      created_by: "",
      default_view: 0,
      revision: response.canvas_revision,
      created_at: "",
      updated_at: "",
    },
    nodes: rawNodes,
  };
  const Items = response.items.map((state): canvasnode.CanvasNodeState => {
    const matching = state.task_type === canvasnode.CanvasNodeTaskType.ASSETS_MATCH;
    const active = ["pending", "queued", "running", "cancelling"].includes(state.status);
    const node = presentNode(
      graph,
      state.node,
      matching
        ? undefined
        : {
            id: state.task_run_id,
            node_id: state.node_id,
            status: state.status,
            task_type: state.task_type,
            selected_generation_id: state.selected_generation_id,
            cancel_requested: false,
          },
    );
    if (active) {
      node.ActiveTaskRunID = state.task_run_id;
      node.ActiveTaskType = matching
        ? canvasnode.CanvasNodeTaskType.ASSETS_MATCH
        : canvasnode.CanvasNodeTaskType.GENERATION;
    }
    const relatedIds = new Set(node.IncomingEdges.map((edge) => edge.SourceNodeID));
    return {
      NodeID: state.node_id,
      TaskRunID: state.task_run_id,
      Status: generationStatus(state.status),
      TaskType: state.task_type,
      Node: node,
      RelatedNodes: matching
        ? state.related_nodes
            .filter((item) => relatedIds.has(item.id))
            .map((item) => presentNode(graph, item))
        : [],
      ErrorMessage: state.error || undefined,
      VideoProviderStatus: canvasnode.CanvasNodeVideoProviderStatus.UNKNOWN,
    };
  });
  return { Items, CanvasRevision: response.canvas_revision };
}

async function history(
  run: CanvasGeneration,
  canvasId: string,
  type: canvasnode.CanvasNodeType,
): Promise<canvasnode.CanvasNodeHistory> {
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
