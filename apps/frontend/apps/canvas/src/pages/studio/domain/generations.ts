import {
  canvasCancelNodeGeneration,
  canvasListNodeHistories,
  canvasSelectNodeHistory,
  canvasStartGeneration,
  canvasStartNodeGeneration,
  type ApiRequestConfig,
  type CanvasNodeHistory,
} from "@repo/api";

import type { canvasnode } from "@/domain";

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
