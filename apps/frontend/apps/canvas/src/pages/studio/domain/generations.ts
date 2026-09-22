import {
  canvasBatchGetNodeStates,
  canvasCancelNodeGeneration,
  canvasListNodeHistories,
  canvasSelectNodeHistory,
  canvasStartGeneration,
  canvasStartNodeGeneration,
  type ApiRequestConfig,
  type CanvasNodeHistory,
} from "@repo/api";

import type { canvasnode } from "@/domain";

import { presentNode } from "./persistence";

export async function StartCanvasNodeGeneration(
  input: { CanvasID: string; NodeID: string; ProjectID?: string },
  options?: ApiRequestConfig,
) {
  if (!input.ProjectID) throw new Error("缺少项目标识");
  const response = await canvasStartNodeGeneration(input.ProjectID, input.CanvasID, input.NodeID, options);
  return { TaskRunID: response.task_run_id };
}

export async function StartCanvasGeneration(
  input: { CanvasID: string; ProjectID?: string },
  options?: ApiRequestConfig,
) {
  if (!input.ProjectID) throw new Error("缺少项目标识");
  const response = await canvasStartGeneration(input.ProjectID, input.CanvasID, options);
  return {
    Items: response.items.map((item) => ({ NodeID: item.node_id, TaskRunID: item.task_run_id })),
    SkippedCount: response.skipped_count,
  };
}

export async function CancelCanvasNodeGeneration(
  input: { CanvasID: string; TaskRunID: string; NodeID?: string; ProjectID?: string },
  options?: ApiRequestConfig,
) {
  if (!input.ProjectID || !input.NodeID) throw new Error("缺少生成任务范围");
  await canvasCancelNodeGeneration(input.ProjectID, input.CanvasID, input.NodeID, input.TaskRunID, options);
}

export async function BatchGetCanvasNodeStates(
  input: {
    CanvasID: string;
    ProjectID?: string;
    Targets: Array<{ NodeID: string; TaskRunID: string; TaskType?: canvasnode.CanvasNodeTaskType }>;
  },
  options?: ApiRequestConfig,
) {
  if (!input.ProjectID) throw new Error("缺少项目标识");
  const response = await canvasBatchGetNodeStates(
    input.ProjectID,
    input.CanvasID,
    { targets: input.Targets.map((item) => ({ node_id: item.NodeID, task_run_id: item.TaskRunID })) },
    options,
  );
  return {
    Items: response.items.map(
      (state): canvasnode.CanvasNodeState => ({
        NodeID: state.node_id,
        TaskRunID: state.task_run_id,
        Status: state.status,
        TaskType: state.task_type,
        Node: presentNode(state.node, state),
        RelatedNodes: state.related_nodes.map((node) => presentNode(node)),
        ErrorCode: state.error_code,
        ErrorMessage: state.error_message,
        SeedanceTaskID: state.seedance_task_id,
        VideoProviderStatus: state.video_provider_status,
      }),
    ),
    DraftSessions: response.draft_sessions,
  };
}

function presentHistory(value: CanvasNodeHistory): canvasnode.CanvasNodeHistory {
  return {
    HistoryID: value.history_id,
    Status: value.status,
    ModelServiceID: value.model_service_id,
    Resolution: value.resolution,
    AspectRatio: value.aspect_ratio,
    DurationSeconds: value.duration_seconds,
    GenerateAudio: value.generate_audio,
    Watermark: value.watermark,
    Prompt: value.prompt,
    VideoURL: value.video_url,
    ErrorMessage: value.error_message,
    CompletedAt: value.completed_at,
    CreatedAt: value.created_at,
    ProviderStatus: value.provider_status,
    FirstFrameAssetID: value.first_frame_asset_id,
    LastFrameAssetID: value.last_frame_asset_id,
    FirstFrameURL: value.first_frame_url,
    LastFrameURL: value.last_frame_url,
    ResourceAssetSnapshots: value.resource_asset_snapshots.map((item) => ({
      SourceNodeID: item.source_node_id,
      ResourceAssetID: item.resource_asset_id,
      ResourceAssetRevision: item.resource_asset_revision,
      AssetID: item.asset_id,
    })),
    Type: value.type,
    OutputAssetID: value.output_asset_id,
    OutputURL: value.output_url,
    OutputText: value.output_text,
    ErrorCode: value.error_code,
    SeedanceTaskID: value.seedance_task_id,
  };
}

export async function ListCanvasNodeHistories(
  input: { CanvasID: string; NodeID: string; ProjectID?: string },
  options?: ApiRequestConfig,
) {
  if (!input.ProjectID) throw new Error("缺少项目标识");
  const response = await canvasListNodeHistories(input.ProjectID, input.CanvasID, input.NodeID, options);
  return { Items: response.items.map(presentHistory) };
}

export async function SelectCanvasNodeHistory(
  input: { CanvasID: string; NodeID: string; HistoryID: string; ProjectID?: string },
  options?: ApiRequestConfig,
) {
  if (!input.ProjectID) throw new Error("缺少项目标识");
  const response = await canvasSelectNodeHistory(
    input.ProjectID,
    input.CanvasID,
    input.NodeID,
    input.HistoryID,
    options,
  );
  return { History: presentHistory(response.history) };
}
