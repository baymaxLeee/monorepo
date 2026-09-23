import {
  canvasStartStoryboardDrafts,
  canvasConfirmStoryboardDrafts,
  canvasCancelStoryboardDrafts,
  canvasMaterializeAssetReference,
  canvasMaterializeResourceReference,
  canvasSearchNodeAssets,
  type CanvasNodeDraftSession,
  type ApiRequestConfig,
} from "@repo/api";

import type { MentionNode, MentionReferenceIdentity, MentionTreeResult } from "@/components/promptEditor";
import { asset, canvasnode } from "@/domain";
import {
  StartCanvasNodeGeneration,
  StartCanvasGeneration,
  BatchGetCanvasNodeStates,
  CancelCanvasNodeGeneration,
  ListCanvasNodeHistories,
  SelectCanvasNodeHistory,
} from "@/pages/studio/domain/generations";
import { CreateCanvasNode, UpdateCanvasNode, DeleteCanvasNode, presentNode } from "@/pages/studio/domain/persistence";
import { resolveArtifactURL } from "@/utils/artifactURL";
import { latestAssetReview } from "@/utils/assetReview";
import t from "@/utils/i18n";

import { requestCanvasState, type CanvasStatePubSub, watchCanvasTarget } from "./canvasStatePubSub";
import { isVideoGenerationCancellationAllowed } from "./generationCancellation";
import { materializedCanvasNodeAssetId } from "./model";
import {
  DEFAULT_SETTINGS,
  type GenerationHistoryItem,
  type Shot,
  type StoryboardAsset,
  type StoryboardSettings,
} from "./types";

type ResourceMentionReference = Extract<MentionReferenceIdentity, { kind: "resource" | "resourceAsset" }>;
type AssetMentionReference = Extract<MentionReferenceIdentity, { kind: "asset" }>;
const RESOLUTION_FROM_API: Record<number, string> = {
  [canvasnode.CanvasNodeResolution.P480]: "480P",
  [canvasnode.CanvasNodeResolution.P720]: "720P",
  [canvasnode.CanvasNodeResolution.P1080]: "1080P",
  [canvasnode.CanvasNodeResolution.P2K]: "2K",
  [canvasnode.CanvasNodeResolution.P4K]: "4K",
};

const RESOLUTION_TO_API: Record<string, canvasnode.CanvasNodeResolution> = {
  "480P": canvasnode.CanvasNodeResolution.P480,
  "720P": canvasnode.CanvasNodeResolution.P720,
  "1080P": canvasnode.CanvasNodeResolution.P1080,
  "2K": canvasnode.CanvasNodeResolution.P2K,
  "4K": canvasnode.CanvasNodeResolution.P4K,
};

const RATIO_FROM_API: Record<number, string> = {
  [canvasnode.CanvasNodeAspectRatio.RATIO_21_9]: "21:9",
  [canvasnode.CanvasNodeAspectRatio.RATIO_16_9]: "16:9",
  [canvasnode.CanvasNodeAspectRatio.RATIO_4_3]: "4:3",
  [canvasnode.CanvasNodeAspectRatio.RATIO_1_1]: "1:1",
  [canvasnode.CanvasNodeAspectRatio.RATIO_3_4]: "3:4",
  [canvasnode.CanvasNodeAspectRatio.RATIO_9_16]: "9:16",
  [canvasnode.CanvasNodeAspectRatio.RATIO_3_2]: "3:2",
  [canvasnode.CanvasNodeAspectRatio.RATIO_2_3]: "2:3",
  [canvasnode.CanvasNodeAspectRatio.RATIO_ADAPTIVE]: "adaptive",
};

const RATIO_TO_API: Record<string, canvasnode.CanvasNodeAspectRatio> = {
  "21:9": canvasnode.CanvasNodeAspectRatio.RATIO_21_9,
  "16:9": canvasnode.CanvasNodeAspectRatio.RATIO_16_9,
  "4:3": canvasnode.CanvasNodeAspectRatio.RATIO_4_3,
  "1:1": canvasnode.CanvasNodeAspectRatio.RATIO_1_1,
  "3:4": canvasnode.CanvasNodeAspectRatio.RATIO_3_4,
  "9:16": canvasnode.CanvasNodeAspectRatio.RATIO_9_16,
  "3:2": canvasnode.CanvasNodeAspectRatio.RATIO_3_2,
  "2:3": canvasnode.CanvasNodeAspectRatio.RATIO_2_3,
  adaptive: canvasnode.CanvasNodeAspectRatio.RATIO_ADAPTIVE,
};

// These values are domain option IDs shared with model capabilities, not UI copy.
// starling-disable-next-line
const AUDIO_ENABLED = "有声";
// starling-disable-next-line
const AUDIO_DISABLED = "无声";
// starling-disable-next-line
const WATERMARK_ENABLED = "有水印";
// starling-disable-next-line
const WATERMARK_DISABLED = "无水印";

const STATUS_FROM_API: Record<number, Shot["status"]> = {
  [canvasnode.CanvasNodeStatus.EMPTY]: "empty",
  [canvasnode.CanvasNodeStatus.READY]: "ready",
  [canvasnode.CanvasNodeStatus.GENERATING]: "generating",
};

export function settingsFromDTO(config?: canvasnode.CanvasNodeGenerationConfig): StoryboardSettings {
  if (!config) return { ...DEFAULT_SETTINGS };
  return {
    model: config.ModelServiceID,
    resolution: RESOLUTION_FROM_API[config.Resolution] ?? "720P",
    ratio: RATIO_FROM_API[config.AspectRatio] ?? "9:16",
    duration: `${config.DurationSeconds}s`,
    audio: config.GenerateAudio ? AUDIO_ENABLED : AUDIO_DISABLED,
    watermark: config.Watermark ? WATERMARK_ENABLED : WATERMARK_DISABLED,
  };
}
export function shotFromDTO(value: canvasnode.CanvasNode): Shot {
  const settings = settingsFromDTO(value.GenerationConfig);
  return {
    id: value.NodeID,
    name: value.Name,
    revision: value.Revision,
    detailLoaded: true,
    timelineStatus: "completed",
    duration:
      value.SelectedOutputDurationSeconds === null || value.SelectedOutputDurationSeconds === undefined
        ? settings.duration
        : `${value.SelectedOutputDurationSeconds}s`,
    status: STATUS_FROM_API[value.Status] ?? "empty",
    script: value.Prompt,
    settings,
    videoUrl: resolveArtifactURL(value.SelectedOutputURL ?? value.PreviewURL ?? ""),
    firstFrameAssetId: value.FirstFrameAssetID,
    firstFrameUrl: resolveArtifactURL(value.FirstFrameURL ?? ""),
    firstFramePreviewResolved: Boolean(value.FirstFrameURL),
    activeGenerationRunId: value.ActiveTaskRunID,
    selectedOutputId: value.SelectedOutputID,
    videoInputMode: value.VideoInputMode ?? canvasnode.CanvasVideoInputMode.REFERENCE,
  };
}

export function shotFromDraftDTO(value: canvasnode.CanvasNodeDraft, frontendSettings: StoryboardSettings): Shot {
  const settings = {
    ...frontendSettings,
    duration: `${value.DurationSeconds}s`,
  };
  return {
    id: value.DraftID,
    detailLoaded: true,
    timelineStatus: "pending-confirmation",
    draftCanvasNodeNo: value.CanvasNodeNo,
    assetReferences: (value.AssetReferences ?? []).map((reference) => ({
      id: reference.ResourceAssetID,
      assetId: reference.AssetID,
      resourceAssetId: reference.ResourceAssetID,
      category:
        reference.MediaType === asset.AssetMediaType.VIDEO
          ? "video"
          : reference.MediaType === asset.AssetMediaType.AUDIO
            ? "audio"
            : "image",
      title: reference.Label ?? reference.AnchorText,
      description: reference.AnchorText,
      source: "project",
      syncStatus: "ready",
    })),
    duration: settings.duration,
    status: "empty",
    script: value.Prompt,
    settings,
    videoInputMode: canvasnode.CanvasVideoInputMode.REFERENCE,
  };
}

const HISTORY_STATUS_FROM_API: Record<number, GenerationHistoryItem["status"]> = {
  [canvasnode.CanvasGenerationStatus.QUEUED]: "running",
  [canvasnode.CanvasGenerationStatus.RUNNING]: "running",
  [canvasnode.CanvasGenerationStatus.SUCCEEDED]: "succeeded",
  [canvasnode.CanvasGenerationStatus.FAILED]: "failed",
  [canvasnode.CanvasGenerationStatus.CANCELLED]: "cancelled",
};

function timestampMillis(value?: string) {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

export function historyFromDTO(value: canvasnode.CanvasNodeHistory, canvasnodeId: string): GenerationHistoryItem {
  return {
    id: value.HistoryID,
    shotId: canvasnodeId,
    status: HISTORY_STATUS_FROM_API[value.Status] ?? "failed",
    model: value.ModelServiceID,
    type: value.Type,
    resolution: value.Resolution ? (RESOLUTION_FROM_API[value.Resolution] ?? "") : "",
    duration: value.DurationSeconds ? `${value.DurationSeconds}s` : "",
    script: value.Prompt,
    outputText: value.OutputText,
    videoUrl: resolveArtifactURL(value.OutputURL ?? value.VideoURL ?? ""),
    outputAssetId: value.OutputAssetID,
    firstFrameAssetId: value.FirstFrameAssetID,
    lastFrameAssetId: value.LastFrameAssetID,
    firstFrameUrl: resolveArtifactURL(value.FirstFrameURL ?? ""),
    lastFrameUrl: resolveArtifactURL(value.LastFrameURL ?? ""),
    completedAt: timestampMillis(value.CompletedAt),
    createdAt: timestampMillis(value.CreatedAt) ?? 0,
    errorCode: value.ErrorCode,
    errorMessage: value.ErrorMessage,
    seedanceTaskId: value.SeedanceTaskID,
  };
}

export function canvasGenerationFailureFromError(
  error: unknown,
  fallbackMessage: string,
): { errorMessage: string; requestId?: string } {
  if (!error || typeof error !== "object") {
    return { errorMessage: fallbackMessage };
  }
  const value = error as { Message?: unknown; RequestID?: unknown };
  return {
    errorMessage: canvasRequestErrorMessage(error, fallbackMessage),
    requestId: typeof value.RequestID === "string" && value.RequestID.trim() ? value.RequestID.trim() : undefined,
  };
}

/** API 请求层会抛出 ResponseMetadata.Error；业务交互直接展示其安全 Message。 */
export function canvasRequestErrorMessage(error: unknown, fallbackMessage: string) {
  if (!error || typeof error !== "object") return fallbackMessage;
  const message = (error as { Message?: unknown }).Message;
  return typeof message === "string" && message.trim() ? message.trim() : fallbackMessage;
}

export function generationConfigPatch(
  current: StoryboardSettings,
  next: StoryboardSettings,
  videoInputMode: canvasnode.CanvasVideoInputMode = canvasnode.CanvasVideoInputMode.REFERENCE,
): canvasnode.CanvasNodeGenerationConfigPatch {
  const patch: canvasnode.CanvasNodeGenerationConfigPatch = {};
  if (current.model !== next.model) {
    patch.ModelServiceID = next.model;
  }
  if (current.resolution !== next.resolution) {
    const resolution = RESOLUTION_TO_API[next.resolution];
    if (resolution !== undefined) {
      patch.Resolution = resolution;
    }
  }
  if (videoInputMode !== canvasnode.CanvasVideoInputMode.FIRST_LAST_FRAME && current.ratio !== next.ratio) {
    const aspectRatio = RATIO_TO_API[next.ratio];
    if (aspectRatio !== undefined) {
      patch.AspectRatio = aspectRatio;
    }
  }
  if (current.duration !== next.duration) {
    patch.DurationSeconds = Number.parseInt(next.duration, 10);
  }
  if (current.audio !== next.audio) {
    patch.GenerateAudio = next.audio === AUDIO_ENABLED;
  }
  if (current.watermark !== next.watermark) {
    patch.Watermark = next.watermark === WATERMARK_ENABLED;
  }
  return patch;
}

const scope = (projectId: string, canvasId: string) => ({
  ProjectID: projectId,
  CanvasID: canvasId,
});

const SILENT_POLL: ApiRequestConfig = { skipErrorNotify: true };

const SILENT_REQUEST = SILENT_POLL;

export function storyboardDraftShotFromNode(node: canvasnode.CanvasNode): Shot | undefined {
  if (node.Type !== canvasnode.CanvasNodeType.STORYBOARD_DRAFT) return undefined;
  const session = node.DraftSession;
  const settings = session ? storyboardSettings(session) : { ...DEFAULT_SETTINGS };
  return {
    id: node.NodeID,
    detailLoaded: true,
    timelineStatus: session?.status === 3 ? "failed" : session?.status === 2 ? "pending-confirmation" : "generating",
    storyboardTaskRunId: session?.task_run_id ?? node.NodeID,
    duration: settings.duration,
    status: "empty",
    script: session?.plot ?? node.Prompt ?? "",
    settings,
  };
}

export async function getCanvasNodeAssets(target: canvasnode.CanvasNode, graphNodes: canvasnode.CanvasNode[]) {
  const incomingBySourceID = new Map(target.IncomingEdges.map((edge) => [edge.SourceNodeID, edge]));
  const sourceNodes = graphNodes.filter((node) => incomingBySourceID.has(node.NodeID));
  const connectedAssets = sourceNodes.flatMap<StoryboardAsset>((node) => {
    if (node.Type === canvasnode.CanvasNodeType.TEXT || node.Type === canvasnode.CanvasNodeType.TEXT_GENERATION) {
      return [
        {
          id: node.NodeID,
          canvasNodeId: node.NodeID,
          category: "text" as const,
          title: node.Name || t("文本"),
          description:
            node.Type === canvasnode.CanvasNodeType.TEXT_GENERATION
              ? (node.SelectedOutputText ?? "")
              : (node.Text ?? ""),
          syncStatus: "ready" as const,
          source: "canvasnode",
          targetPort: incomingBySourceID.get(node.NodeID)?.TargetPort,
        },
      ];
    }
    const assetID = materializedCanvasNodeAssetId(node);
    if (!assetID) return [];
    const category =
      node.Type === canvasnode.CanvasNodeType.VIDEO_ASSET || node.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION
        ? "video"
        : node.Type === canvasnode.CanvasNodeType.AUDIO_ASSET
          ? "audio"
          : "image";
    const previewURL = node.PreviewURL ? resolveArtifactURL(node.PreviewURL) : undefined;
    return [
      {
        id: node.NodeID,
        assetId: assetID,
        canvasNodeId: node.NodeID,
        category,
        title: node.Name,
        description: "",
        previewUrl: previewURL,
        thumbnail: category === "image" ? previewURL : undefined,
        syncStatus: "ready",
        review: latestAssetReview(node.Reviews),
        reviews: node.Reviews,
        referenceType: "canvasNode",
        resourceId: node.ResourceID,
        resourceAssetId: node.ResourceAssetID,
        source: "canvasnode",
        targetPort: incomingBySourceID.get(node.NodeID)?.TargetPort,
      },
    ];
  });
  return connectedAssets;
}

export async function createCanvasNode(
  projectId: string,
  canvasId: string,
  modelServiceId: string,
  afterCanvasNodeId?: string,
) {
  const response = await CreateCanvasNode(
    {
      ...scope(projectId, canvasId),
      AfterNodeID: afterCanvasNodeId,
      ModelServiceID: modelServiceId,
      Type: canvasnode.CanvasNodeType.VIDEO_GENERATION,
      Position: { PositionX: 0, PositionY: 0 },
    },
    SILENT_REQUEST,
  );
  return {
    node: response.CanvasNode,
    shot: shotFromDTO(response.CanvasNode),
    index: Math.max(0, response.CanvasNode.CanvasNodeNo - 1),
    canvasRevision: response.CanvasRevision,
  };
}

export async function streamCanvasNodeDrafts(
  projectId: string,
  canvasId: string,
  plot: string,
  modelBindings: { inferenceModelServiceId: string; videoModelServiceId: string },
  durations: { shot: { min: number; max: number }; video: { min: number; max: number } },
  frontendSettings: StoryboardSettings,
  statePubSub: CanvasStatePubSub,
  signal: AbortSignal,
  onSession: (session: StoryboardDraftSession) => void,
  onCanvasNode: (shot: Shot) => void,
) {
  const started = await canvasStartStoryboardDrafts(
    projectId,
    canvasId,
    {
      plot,
      planning_config: {
        canvas_node_duration_min_seconds: durations.shot.min,
        canvas_node_duration_max_seconds: durations.shot.max,
        total_duration_min_seconds: durations.video.min * 60,
        total_duration_max_seconds: durations.video.max * 60,
      },
      model_config: {
        inference_model_service_id: modelBindings.inferenceModelServiceId,
        video_model_service_id: modelBindings.videoModelServiceId,
        video_parameters: {
          resolution: RESOLUTION_TO_API[frontendSettings.resolution],
          aspect_ratio: RATIO_TO_API[frontendSettings.ratio],
          generate_audio: frontendSettings.audio === AUDIO_ENABLED,
          watermark: frontendSettings.watermark === WATERMARK_ENABLED,
        },
      },
    },
    { signal },
  );
  if (!started.session) throw new Error(t("分镜任务启动失败"));
  return observeDraft(statePubSub, started.session, signal, onSession, onCanvasNode);
}

export interface StoryboardDraftSession {
  taskRunId: string;
  plot: string;
  status: "running" | "completed" | "failed";
  generating: boolean;
  canvasnodes: Shot[];
  inferenceModelServiceId?: string;
  videoModelServiceId?: string;
  canvasnodeDurationMinSeconds?: number;
  canvasnodeDurationMaxSeconds?: number;
  totalDurationMinSeconds?: number;
  totalDurationMaxSeconds?: number;
  settings: StoryboardSettings;
}

export class StoryboardDraftNotFoundError extends Error {}

export async function recoverCanvasNodeDrafts(
  statePubSub: CanvasStatePubSub,
  taskRunId: string,
  _frontendSettings: StoryboardSettings,
  signal: AbortSignal,
  onSession: (session: StoryboardDraftSession) => void,
  onCanvasNode: (shot: Shot) => void,
) {
  const stopWatching = watchCanvasTarget(statePubSub, { NodeID: taskRunId, TaskRunID: taskRunId });
  const result = await requestCanvasState(statePubSub).finally(stopWatching);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const draft = result.Items.find((item) => item.NodeID === taskRunId)?.Node.DraftSession;
  if (!draft) throw new StoryboardDraftNotFoundError();
  return observeDraft(statePubSub, draft, signal, onSession, onCanvasNode);
}

export async function confirmCanvasNodeDrafts(projectId: string, canvasId: string, taskRunId: string, shots: Shot[]) {
  const result = await canvasConfirmStoryboardDrafts(projectId, canvasId, taskRunId, {
    items: shots.map((shot) => ({
      draft_id: shot.id,
      generation_config: {
        model_service_id: shot.settings.model,
        resolution: RESOLUTION_TO_API[shot.settings.resolution],
        aspect_ratio: RATIO_TO_API[shot.settings.ratio],
        duration_seconds: Number.parseFloat(shot.duration),
        generate_audio: shot.settings.audio === AUDIO_ENABLED,
        watermark: shot.settings.watermark === WATERMARK_ENABLED,
      },
    })),
  });
  return {
    canvasNodeIds: result.canvas_node_ids,
    canvasRevision: result.canvas_revision,
  };
}

export async function cancelCanvasNodeDrafts(projectId: string, canvasId: string, taskRunId: string) {
  await canvasCancelStoryboardDrafts(projectId, canvasId, taskRunId);
}

export async function startCanvasNodeGeneration(projectId: string, canvasId: string, canvasnodeId: string) {
  const response = await StartCanvasNodeGeneration(
    {
      ...scope(projectId, canvasId),
      NodeID: canvasnodeId,
    },
    SILENT_REQUEST,
  );
  return response.TaskRunID;
}

export async function startCanvasGeneration(projectId: string, canvasId: string) {
  return StartCanvasGeneration(scope(projectId, canvasId), SILENT_REQUEST);
}

export async function getCanvasGenerationState(
  projectId: string,
  canvasId: string,
  canvasnodeId: string,
  taskRunId: string,
) {
  const response = await BatchGetCanvasNodeStates(
    {
      ...scope(projectId, canvasId),
      Targets: [{ NodeID: canvasnodeId, TaskRunID: taskRunId }],
    },
    SILENT_REQUEST,
  );
  return response.Items.find((item) => item.NodeID === canvasnodeId && item.TaskRunID === taskRunId);
}

export async function cancelCancellableVideoGeneration(
  projectId: string,
  canvasId: string,
  canvasnodeId: string,
  taskRunId: string,
) {
  const state = await getCanvasGenerationState(projectId, canvasId, canvasnodeId, taskRunId);
  const status = state?.Status;
  const providerStatus = state?.VideoProviderStatus;
  const active =
    status === canvasnode.CanvasGenerationStatus.QUEUED || status === canvasnode.CanvasGenerationStatus.RUNNING;
  if (!active || !isVideoGenerationCancellationAllowed(providerStatus)) {
    return { cancelled: false, status, providerStatus } as const;
  }
  await cancelCanvasNodeGeneration(projectId, canvasId, canvasnodeId, taskRunId);
  return { cancelled: true, status, providerStatus } as const;
}

export function cancelCanvasNodeGeneration(
  projectId: string,
  canvasId: string,
  canvasnodeId: string,
  runId: string | Promise<string>,
) {
  return Promise.resolve(runId).then((TaskRunID) =>
    CancelCanvasNodeGeneration(
      {
        ...scope(projectId, canvasId),
        NodeID: canvasnodeId,
        TaskRunID,
      },
      SILENT_REQUEST,
    ),
  );
}

export async function listCanvasNodeHistories(projectId: string, canvasId: string, canvasnodeId: string) {
  const response = await ListCanvasNodeHistories({
    ...scope(projectId, canvasId),
    NodeID: canvasnodeId,
  });
  return response.Items.map((item: canvasnode.CanvasNodeHistory) => historyFromDTO(item, canvasnodeId));
}

export async function selectCanvasNodeHistory(
  projectId: string,
  canvasId: string,
  canvasnodeId: string,
  historyId: string,
) {
  const response = await SelectCanvasNodeHistory(
    {
      ...scope(projectId, canvasId),
      NodeID: canvasnodeId,
      HistoryID: historyId,
    },
    SILENT_REQUEST,
  );
  return response.History;
}

export async function updateCanvasNode(
  projectId: string,
  canvasId: string,
  canvasnodeId: string,
  patch: Partial<Pick<canvasnode.UpdateCanvasNodeRequest, "Prompt" | "GenerationConfig" | "Name" | "VideoInputMode">>,
) {
  const response = await UpdateCanvasNode(
    {
      ...scope(projectId, canvasId),
      NodeID: canvasnodeId,
      ...patch,
    },
    SILENT_REQUEST,
  );
  return { node: response.CanvasNode, shot: shotFromDTO(response.CanvasNode) };
}

export function deleteCanvasNode(projectId: string, canvasId: string, canvasnodeId: string) {
  return DeleteCanvasNode(
    {
      ...scope(projectId, canvasId),
      NodeID: canvasnodeId,
    },
    SILENT_REQUEST,
  );
}

export function materializeCanvasResourceAssetReference(
  projectId: string,
  canvasId: string,
  targetNodeId: string,
  reference: ResourceMentionReference,
  targetPort: canvasnode.CanvasPort,
  position: canvasnode.CanvasNodePosition,
) {
  const referenceFields =
    reference.kind === "resource"
      ? { ResourceID: reference.ResourceID }
      : { ResourceAssetID: reference.ResourceAssetID };
  return canvasMaterializeResourceReference(
    projectId,
    canvasId,
    {
      target_node_id: targetNodeId,
      reference_type: reference.ReferenceType,
      resource_id: referenceFields.ResourceID,
      resource_asset_id: referenceFields.ResourceAssetID,
      target_port: targetPort,
      resource_asset_node_position: { position_x: position.PositionX, position_y: position.PositionY },
    },
    SILENT_REQUEST,
  ).then((response) => ({
    ResourceAssetNode: presentNode(response.resource_asset_node),
    TargetNode: presentNode(response.target_node),
    CanvasRevision: response.canvas_revision,
    CreatedResourceAssetNode: response.created_resource_asset_node,
  }));
}

export function materializeCanvasStandaloneAssetReference(
  projectId: string,
  canvasId: string,
  targetNodeId: string,
  reference: AssetMentionReference | canvasnode.CanvasUploadedAsset,
  targetPort: canvasnode.CanvasPort,
  position: canvasnode.CanvasNodePosition,
) {
  const uploaded = "BlobID" in reference;
  return canvasMaterializeAssetReference(
    projectId,
    canvasId,
    {
      target_node_id: targetNodeId,
      reference_type: canvasnode.CanvasNodeMentionReferenceType.ASSET,
      asset_id: uploaded ? undefined : reference.AssetID,
      uploaded_asset: uploaded ? { blob_id: reference.BlobID, file_name: reference.FileName } : undefined,
      target_port: targetPort,
      asset_node_position: { position_x: position.PositionX, position_y: position.PositionY },
    },
    SILENT_REQUEST,
  ).then((response) => ({
    AssetNode: presentNode(response.asset_node),
    TargetNode: presentNode(response.target_node),
    CanvasRevision: response.canvas_revision,
    CreatedAssetNode: response.created_asset_node,
  }));
}

function resolveMentionNodeURL(node: canvasnode.CanvasNodeAssetMentionNode): MentionNode {
  return {
    ...node,
    Children: node.Children.map(resolveMentionNodeURL),
    Review: latestAssetReview(node.Reviews),
    URL: node.URL ? resolveArtifactURL(node.URL) : undefined,
  };
}

function mentionNodeFromDTO(
  node: Awaited<ReturnType<typeof canvasSearchNodeAssets>>["items"][number],
): canvasnode.CanvasNodeAssetMentionNode {
  return {
    ID: node.id,
    Label: node.label,
    Children: node.children.map(mentionNodeFromDTO),
    URL: node.url,
    MediaType: node.media_type,
    Description: node.description,
    CanvasNodeID: node.canvas_node_id,
    AssetID: node.asset_id,
    NodeType: node.node_type,
    ResourceAssetID: node.resource_asset_id,
    ResourceID: node.resource_id,
    ReferenceType: node.reference_type,
    ResourceType: node.resource_type,
    Available: node.available,
    Generating: node.generating,
    Reviews: node.reviews?.map((review) => ({
      PackageID: review.package_id,
      PackageName: review.package_name,
      Status: review.status,
      FailureReason: review.failure_reason,
      SubmittedAt: review.submitted_at,
      UpdatedAt: review.updated_at,
    })),
  };
}

/** @ 面板直接消费服务端返回的通用素材树和窗口状态。 */
export async function queryMentionTree(
  projectId: string,
  canvasId: string,
  canvasnodeId: string,
  keyword: string,
  cursor: string | undefined,
  limit: number,
  mediaTypes?: canvasnode.CanvasNodeMediaType[],
): Promise<MentionTreeResult> {
  const trimmed = keyword.trim();
  const response = await canvasSearchNodeAssets(
    projectId,
    canvasId,
    canvasnodeId,
    { keyword: trimmed || undefined, cursor, limit, media_types: mediaTypes },
    SILENT_REQUEST,
  );
  return {
    items: response.items.map((node) => resolveMentionNodeURL(mentionNodeFromDTO(node))),
    nextCursor: response.next_cursor,
  };
}

function storyboardSettings(draft: CanvasNodeDraftSession): StoryboardSettings {
  const config = draft.model_config?.video_parameters;
  return {
    model: draft.model_config?.video_model_service_id ?? "",
    ratio: RATIO_FROM_API[config?.aspect_ratio ?? canvasnode.CanvasNodeAspectRatio.RATIO_16_9] ?? "16:9",
    resolution: RESOLUTION_FROM_API[config?.resolution ?? canvasnode.CanvasNodeResolution.P720] ?? "720P",
    duration: DEFAULT_SETTINGS.duration,
    audio: config?.generate_audio ? AUDIO_ENABLED : AUDIO_DISABLED,
    watermark: config?.watermark ? WATERMARK_ENABLED : WATERMARK_DISABLED,
  };
}

function shotFromDraftSession(
  session: CanvasNodeDraftSession,
  draft: NonNullable<CanvasNodeDraftSession["canvas_nodes"]>[number],
) {
  return shotFromDraftDTO(
    {
      DraftID: draft.draft_id,
      CanvasNodeNo: draft.canvas_node_no,
      Prompt: draft.prompt,
      DurationSeconds: draft.duration_seconds,
      AssetReferences: draft.asset_references.map((reference) => ({
        ResourceAssetID: reference.resource_asset_id,
        AssetID: reference.asset_id,
        Label: reference.label,
        TargetField: reference.target_field,
        AnchorText: reference.anchor_text,
        MediaType: reference.media_type,
      })),
    },
    storyboardSettings(session),
  );
}

async function observeDraft(
  statePubSub: CanvasStatePubSub,
  draft: CanvasNodeDraftSession,
  signal: AbortSignal,
  onSession: (session: StoryboardDraftSession) => void,
  onShot: (shot: Shot) => void,
) {
  let snapshot = draft;
  const publish = (next: CanvasNodeDraftSession) => {
    snapshot = next;
    const settings = storyboardSettings(next);
    const shots = (next.canvas_nodes ?? []).map((shot) => shotFromDraftSession(next, shot));
    const running = next.status === 1;
    onSession({
      taskRunId: next.task_run_id,
      plot: next.plot,
      status: running ? "running" : next.status === 3 ? "failed" : "completed",
      generating: running,
      canvasnodes: shots,
      inferenceModelServiceId: next.model_config?.inference_model_service_id,
      videoModelServiceId: next.model_config?.video_model_service_id,
      canvasnodeDurationMinSeconds: next.planning_config?.canvas_node_duration_min_seconds,
      canvasnodeDurationMaxSeconds: next.planning_config?.canvas_node_duration_max_seconds,
      totalDurationMinSeconds: next.planning_config?.total_duration_min_seconds,
      totalDurationMaxSeconds: next.planning_config?.total_duration_max_seconds,
      settings,
    });
    for (const shot of shots) onShot(shot);
  };
  publish(draft);
  if (snapshot.status !== 1) return snapshot;
  return new Promise<CanvasNodeDraftSession>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      unsubscribe();
      stopWatching();
      signal.removeEventListener("abort", onAbort);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => settle(() => reject(new DOMException("Aborted", "AbortError")));
    const unsubscribe = statePubSub.on("snapshot", (result) => {
      const next = result.Items.find((item) => item.NodeID === draft.task_run_id)?.Node.DraftSession;
      // 关注登记可能与上一个在途批次重叠；该快照未包含新会话时等待下个统一周期。
      if (!next) return;
      publish(next);
      if (next.status !== 1) settle(() => resolve(next));
    });
    const stopWatching = watchCanvasTarget(statePubSub, {
      NodeID: draft.task_run_id,
      TaskRunID: draft.task_run_id,
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
