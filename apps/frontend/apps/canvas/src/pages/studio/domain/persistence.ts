import {
  canvasBatchDeleteNodes,
  canvasConnectNodes,
  canvasCopyNode,
  canvasDeleteEdge,
  canvasDeleteNode,
  canvasGetGraph,
  canvasCreateNode,
  canvasReorderStoryboard,
  canvasUpdateNode,
  canvasUpdateNodePositions,
  type ApiRequestConfig,
  type CanvasNode as CanvasNodeDTO,
  type CanvasNodeState,
} from "@repo/api";

import { canvasnode as view } from "@/domain";

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

function presentGenerationConfig(
  config: CanvasNodeDTO["generation_config"],
): view.CanvasNodeGenerationConfig | undefined {
  if (!config) return undefined;
  return {
    ModelServiceID: config.model_service_id,
    Resolution: config.resolution,
    AspectRatio: config.aspect_ratio,
    DurationSeconds: config.duration_seconds,
    GenerateAudio: config.generate_audio,
    Watermark: config.watermark,
  };
}

export function presentNode(node: CanvasNodeDTO, state?: CanvasNodeState): view.CanvasNode {
  const stateIsTerminal =
    state?.status === view.CanvasGenerationStatus.SUCCEEDED ||
    state?.status === view.CanvasGenerationStatus.FAILED ||
    state?.status === view.CanvasGenerationStatus.CANCELLED;
  const serverStartedNewerTask = Boolean(
    stateIsTerminal && node.active_task_run_id && node.active_task_run_id !== state?.task_run_id,
  );
  const activeTaskRunID = serverStartedNewerTask
    ? node.active_task_run_id
    : stateIsTerminal
      ? undefined
      : (state?.task_run_id ?? node.active_task_run_id);
  const activeTaskType = serverStartedNewerTask
    ? node.active_task_type
    : stateIsTerminal
      ? undefined
      : (state?.task_type ?? node.active_task_type);
  return {
    NodeID: node.node_id,
    CanvasID: node.canvas_id,
    CanvasNodeNo: node.canvas_node_no,
    Prompt: node.prompt,
    Type: node.type,
    Name: node.name,
    Position: { PositionX: node.position.position_x, PositionY: node.position.position_y },
    Revision: node.revision,
    StoryboardRank: node.storyboard_rank,
    Text: node.text,
    SelectedOutputText: node.selected_output_text,
    SelectedOutputID: node.selected_output_id,
    AssetID: node.asset_id,
    ResourceID: node.resource_id,
    ResourceAssetID: node.resource_asset_id,
    ResourceAssetRevision: node.resource_asset_revision,
    ResourceAssetIsPrimary: node.resource_asset_is_primary,
    CurrentAssetID: node.current_asset_id,
    DraftSession: node.draft_session,
    SelectedAssetID: node.selected_asset_id,
    Status: node.status,
    ReferenceStatus: node.reference_status,
    ReferenceType: node.reference_type,
    VideoInputMode: node.video_input_mode,
    CreatedAt: node.created_at,
    UpdatedAt: node.updated_at,
    CreatedBy: node.created_by,
    UpdatedBy: node.updated_by,
    ActiveTaskRunID: activeTaskRunID,
    ActiveTaskType: activeTaskType,
    FirstFrameAssetID: node.first_frame_asset_id,
    FirstFrameURL: node.first_frame_url,
    LastFrameAssetID: node.last_frame_asset_id,
    SelectedOutputURL: node.selected_output_url,
    SelectedOutputDurationSeconds: node.selected_output_duration_seconds,
    PreviewURL: node.preview_url,
    Reviews: node.reviews?.map((review) => ({
      PackageID: review.package_id,
      PackageName: review.package_name,
      Status: review.status,
      FailureReason: review.failure_reason,
      SubmittedAt: review.submitted_at,
      UpdatedAt: review.updated_at,
    })),
    LatestGenerationFailure: node.latest_generation_failure
      ? {
          TaskRunID: node.latest_generation_failure.task_run_id,
          ErrorCode: node.latest_generation_failure.error_code,
          ErrorMessage: node.latest_generation_failure.error_message,
          SeedanceTaskID: node.latest_generation_failure.seedance_task_id,
        }
      : undefined,
    GenerationConfig: presentGenerationConfig(node.generation_config),
    IncomingEdges: node.incoming_edges.map((edge) => ({
      EdgeID: edge.edge_id,
      SourceNodeID: edge.source_node_id,
      SourcePort: edge.source_port,
      TargetPort: edge.target_port,
      TargetOrder: edge.target_order,
    })),
  };
}

export async function presentGraph(nodes: CanvasNodeDTO[], states: CanvasNodeState[] = []) {
  return nodes.map((node) =>
    presentNode(
      node,
      states.find((state) => state.node_id === node.node_id),
    ),
  );
}

function generationConfigPatch(config: view.CanvasNodeGenerationConfigPatch) {
  return {
    aspect_ratio: config.AspectRatio,
    duration_seconds: config.DurationSeconds,
    generate_audio: config.GenerateAudio,
    model_service_id: config.ModelServiceID,
    resolution: config.Resolution,
    watermark: config.Watermark,
  };
}

export async function CreateCanvasNode(request: view.CreateCanvasNodeRequest, options?: ApiRequestConfig) {
  const response = await canvasCreateNode(
    request.ProjectID,
    request.CanvasID,
    {
      after_node_id: request.AfterNodeID,
      asset_id: request.AssetID,
      model_service_id: request.ModelServiceID,
      position: { position_x: request.Position.PositionX, position_y: request.Position.PositionY },
      resource_asset_id: request.ResourceAssetID,
      resource_id: request.ResourceID,
      text: request.Text,
      type: request.Type,
      uploaded_asset: request.UploadedAsset
        ? { blob_id: request.UploadedAsset.BlobID, file_name: request.UploadedAsset.FileName }
        : undefined,
    },
    options,
  );
  return { CanvasNode: presentNode(response.canvas_node), CanvasRevision: response.canvas_revision };
}

export async function GetCanvasGraph(request: view.GetCanvasGraphRequest, options?: ApiRequestConfig) {
  const response = await canvasGetGraph(request.ProjectID, request.CanvasID, options);
  return { Nodes: await presentGraph(response.nodes) };
}

export async function UpdateCanvasNode(request: view.UpdateCanvasNodeRequest, options?: ApiRequestConfig) {
  const response = await canvasUpdateNode(
    request.ProjectID,
    request.CanvasID,
    request.NodeID,
    {
      generation_config: request.GenerationConfig ? generationConfigPatch(request.GenerationConfig) : undefined,
      name: request.Name,
      position: request.Position
        ? { position_x: request.Position.PositionX, position_y: request.Position.PositionY }
        : undefined,
      prompt: request.Prompt,
      text: request.Text,
      video_input_mode: request.VideoInputMode,
    },
    options,
  );
  return { CanvasNode: presentNode(response.canvas_node) };
}

export async function DeleteCanvasNode(request: view.DeleteCanvasNodeRequest, options?: ApiRequestConfig) {
  const response = await canvasDeleteNode(request.ProjectID, request.CanvasID, request.NodeID, {}, options);
  return { CanvasRevision: response.canvas_revision };
}

export async function BatchDeleteCanvasNodes(request: view.BatchDeleteCanvasNodesRequest, options?: ApiRequestConfig) {
  const response = await canvasBatchDeleteNodes(
    request.ProjectID,
    request.CanvasID,
    { node_ids: request.NodeIDs },
    options,
  );
  return { CanvasRevision: response.canvas_revision };
}

export async function BatchUpdateCanvasNodePositions(
  request: view.BatchUpdateCanvasNodePositionsRequest,
  options?: ApiRequestConfig,
) {
  const response = await canvasUpdateNodePositions(
    request.ProjectID,
    request.CanvasID,
    {
      items: request.Items.map((item) => ({
        node_id: item.NodeID,
        position: { position_x: item.Position.PositionX, position_y: item.Position.PositionY },
      })),
    },
    options,
  );
  return { Items: response.items.map((item) => presentNode(item)) };
}

export async function CopyCanvasNode(request: view.CopyCanvasNodeRequest, options?: ApiRequestConfig) {
  const response = await canvasCopyNode(
    request.ProjectID,
    request.CanvasID,
    request.SourceNodeID,
    {
      source_node_id: request.SourceNodeID,
      position: { position_x: request.Position.PositionX, position_y: request.Position.PositionY },
    },
    options,
  );
  return { CanvasNode: presentNode(response.canvas_node), CanvasRevision: response.canvas_revision };
}

export async function ConnectCanvasNodes(request: view.ConnectCanvasNodesRequest, options?: ApiRequestConfig) {
  const response = await canvasConnectNodes(
    request.ProjectID,
    request.CanvasID,
    {
      source_node_id: request.SourceNodeID,
      target_node_id: request.TargetNodeID,
      target_order: request.TargetOrder,
      target_port: request.TargetPort,
    },
    options,
  );
  return { TargetNode: presentNode(response.target_node), CanvasRevision: response.canvas_revision };
}

export async function DeleteCanvasEdge(request: view.DeleteCanvasEdgeRequest, options?: ApiRequestConfig) {
  const response = await canvasDeleteEdge(
    request.ProjectID,
    request.CanvasID,
    { edge_id: request.EdgeID, target_node_id: request.TargetNodeID },
    options,
  );
  return { TargetNode: presentNode(response.target_node), CanvasRevision: response.canvas_revision };
}

export async function ReorderStoryboardNodes(request: view.ReorderStoryboardNodesRequest, options?: ApiRequestConfig) {
  const response = await canvasReorderStoryboard(
    request.ProjectID,
    request.CanvasID,
    { items: request.Items.map((item) => ({ node_id: item.NodeID, storyboard_rank: item.StoryboardRank })) },
    options,
  );
  return { Nodes: response.nodes.map((item) => presentNode(item)), CanvasRevision: response.canvas_revision };
}
