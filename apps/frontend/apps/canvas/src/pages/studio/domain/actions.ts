import {
  canvasStartStoryboard,
  canvasListStoryboards,
  canvasGetStoryboard,
  canvasConfirmStoryboard,
  canvasCancelStoryboard,
  observeCanvasStoryboard,
  canvasGetGraph,
  canvasStartGeneration,
  canvasListGenerations,
  type CanvasStoryboardDraft,
  type ApiRequestConfig,
} from "@repo/api";

import type { AgentFrameService } from "@/api/agentframe";
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
import { CreateCanvasNode, UpdateCanvasNode, DeleteCanvasNode } from "@/pages/studio/domain/persistence";
import { latestAssetReview } from "@/utils/assetReview";
import t from "@/utils/i18n";
import { resolveUpPreviewURL } from "@/utils/upPreviewURL";

import { isVideoGenerationCancellationAllowed } from "./generationCancellation";
import { generationStatus } from "./generations";
import { materializedCanvasNodeAssetId } from "./model";
import { generationConfig as persistedGenerationConfig } from "./persistence";
import {
  DEFAULT_SETTINGS,
  type GenerationHistoryItem,
  type Shot,
  type StoryboardAsset,
  type StoryboardSettings,
} from "./types";

type StoryboardService = Pick<
  AgentFrameService,
  "MaterializeCanvasResourceAssetReference" | "MaterializeCanvasStandaloneAssetReference" | "SearchCanvasNodeAssets"
>;

type ResourceMentionReference = Extract<MentionReferenceIdentity, { kind: "resource" | "resourceAsset" }>;
type AssetMentionReference = Extract<MentionReferenceIdentity, { kind: "asset" }>;
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

// The generated Web SDK may lag the additive Server enum during rollout.
const ASPECT_RATIO_3_2 = 7 as canvasnode.CanvasNodeAspectRatio;
const ASPECT_RATIO_ADAPTIVE = 8 as canvasnode.CanvasNodeAspectRatio;

const RATIO_FROM_API: Record<number, string> = {
  [canvasnode.CanvasNodeAspectRatio.RATIO_21_9]: "21:9",
  [canvasnode.CanvasNodeAspectRatio.RATIO_16_9]: "16:9",
  [canvasnode.CanvasNodeAspectRatio.RATIO_4_3]: "4:3",
  [canvasnode.CanvasNodeAspectRatio.RATIO_1_1]: "1:1",
  [canvasnode.CanvasNodeAspectRatio.RATIO_3_4]: "3:4",
  [canvasnode.CanvasNodeAspectRatio.RATIO_9_16]: "9:16",
  [ASPECT_RATIO_3_2]: "3:2",
  [canvasnode.CanvasNodeAspectRatio.RATIO_2_3]: "2:3",
  [ASPECT_RATIO_ADAPTIVE]: "adaptive",
};

const RATIO_TO_API: Record<string, canvasnode.CanvasNodeAspectRatio> = {
  "21:9": canvasnode.CanvasNodeAspectRatio.RATIO_21_9,
  "16:9": canvasnode.CanvasNodeAspectRatio.RATIO_16_9,
  "4:3": canvasnode.CanvasNodeAspectRatio.RATIO_4_3,
  "1:1": canvasnode.CanvasNodeAspectRatio.RATIO_1_1,
  "3:4": canvasnode.CanvasNodeAspectRatio.RATIO_3_4,
  "9:16": canvasnode.CanvasNodeAspectRatio.RATIO_9_16,
  "3:2": ASPECT_RATIO_3_2,
  "2:3": canvasnode.CanvasNodeAspectRatio.RATIO_2_3,
  adaptive: ASPECT_RATIO_ADAPTIVE,
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
    videoUrl: resolveUpPreviewURL(value.SelectedOutputURL ?? value.PreviewURL ?? ""),
    firstFrameAssetId: value.FirstFrameAssetID,
    firstFrameUrl: resolveUpPreviewURL(value.FirstFrameURL ?? ""),
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
    videoUrl: resolveUpPreviewURL(value.OutputURL ?? value.VideoURL ?? ""),
    outputAssetId: value.OutputAssetID,
    firstFrameAssetId: value.FirstFrameAssetID,
    lastFrameAssetId: value.LastFrameAssetID,
    firstFrameUrl: resolveUpPreviewURL(value.FirstFrameURL ?? ""),
    lastFrameUrl: resolveUpPreviewURL(value.LastFrameURL ?? ""),
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

/** TOP 请求层会抛出 ResponseMetadata.Error；业务交互直接展示其安全 Message。 */
export function canvasRequestErrorMessage(error: unknown, fallbackMessage: string) {
  if (!error || typeof error !== "object") return fallbackMessage;
  const message = (error as { Message?: unknown }).Message;
  return typeof message === "string" && message.trim() ? message.trim() : fallbackMessage;
}

export interface CanvasTextGenerationStreamState {
  taskRunId: string;
  status: canvasnode.CanvasGenerationStatus;
  content: string;
  errorCode?: string;
  errorMessage?: string;
}

export async function streamCanvasNodeTextGeneration(
  body: { CanvasID: string; NodeID: string; ProjectID?: string },
  signal: AbortSignal,
  onState: (state: CanvasTextGenerationStreamState) => void,
) {
  const graph = await canvasGetGraph(body.CanvasID, { signal });
  let run = await canvasStartGeneration(
    body.CanvasID,
    body.NodeID,
    { expected_revision: graph.canvas.revision, operation_id: crypto.randomUUID() },
    { signal },
  );
  for (;;) {
    signal.throwIfAborted();
    const current = {
      taskRunId: run.id,
      status: generationStatus(run.status),
      content: run.output_text,
      errorMessage: run.error || undefined,
    };
    onState(current);
    if (!["queued", "pending", "running"].includes(run.status)) return current;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 1000);
      signal.addEventListener("abort", abort, { once: true });
    });
    const latest = (
      await canvasListGenerations(body.CanvasID, body.NodeID, { signal, skipErrorNotify: true })
    ).items.find((item) => item.id === run.id);
    if (!latest) throw new Error("生成任务已不存在");
    run = latest;
  }
}

export function generationConfigPatch(
  current: StoryboardSettings,
  next: StoryboardSettings,
  videoInputMode = canvasnode.CanvasVideoInputMode.REFERENCE,
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

export async function listCanvasNodeDraftSessions(_projectId: string, canvasId: string) {
  const result = await canvasListStoryboards(canvasId);
  return result.items.map(
    (item) =>
      ({
        id: item.id,
        detailLoaded: true,
        timelineStatus:
          item.status === "queued" || item.status === "running"
            ? "generating"
            : item.status === "failed"
              ? "failed"
              : "pending-confirmation",
        storyboardTaskRunId: item.id,
        duration: DEFAULT_SETTINGS.duration,
        status: "empty",
        script: item.plot,
        settings: storyboardSettings(item),
      }) satisfies Shot,
  );
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
    const previewURL = node.PreviewURL ? resolveUpPreviewURL(node.PreviewURL) : undefined;
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
  _projectId: string,
  canvasId: string,
  plot: string,
  inferenceModelServiceId: string,
  durations: { shot: { min: number; max: number }; video: { min: number; max: number } },
  frontendSettings: StoryboardSettings,
  signal: AbortSignal,
  onSession: (session: StoryboardDraftSession) => void,
  onCanvasNode: (shot: Shot) => void,
) {
  const draft = await canvasStartStoryboard(
    canvasId,
    {
      plot,
      provider_id: inferenceModelServiceId,
      operation_id: crypto.randomUUID(),
      parameters: null,
      duration_min: durations.shot.min,
      duration_max: durations.shot.max,
      total_duration_min: durations.video.min * 60,
      total_duration_max: durations.video.max * 60,
      video_config: persistedGenerationConfig(generationConfigFromSettings(frontendSettings)),
    },
    { signal },
  );
  return observeDraft(canvasId, draft, signal, onSession, onCanvasNode);
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
  _projectId: string,
  canvasId: string,
  taskRunId: string,
  _frontendSettings: StoryboardSettings,
  signal: AbortSignal,
  onSession: (session: StoryboardDraftSession) => void,
  onCanvasNode: (shot: Shot) => void,
) {
  const draft = await canvasGetStoryboard(canvasId, taskRunId, { signal });
  return observeDraft(canvasId, draft, signal, onSession, onCanvasNode);
}

function generationConfigFromSettings(settings: StoryboardSettings): canvasnode.CanvasNodeGenerationConfig {
  return {
    ModelServiceID: settings.model,
    Resolution: RESOLUTION_TO_API[settings.resolution],
    AspectRatio: RATIO_TO_API[settings.ratio],
    DurationSeconds: Number.parseInt(settings.duration, 10),
    GenerateAudio: settings.audio === AUDIO_ENABLED,
    Watermark: settings.watermark === WATERMARK_ENABLED,
  };
}

export async function confirmCanvasNodeDrafts(_projectId: string, canvasId: string, taskRunId: string, shots: Shot[]) {
  const [current, draft] = await Promise.all([canvasGetGraph(canvasId), canvasGetStoryboard(canvasId, taskRunId)]);
  const graph = await canvasConfirmStoryboard(canvasId, taskRunId, {
    expected_revision: current.canvas.revision,
    shots: shots.map((shot, index) => ({
      id: shot.id,
      sequence_no: index + 1,
      prompt: shot.script,
      duration_seconds: Number.parseFloat(shot.duration),
    })),
    video_config: shots[0]
      ? persistedGenerationConfig(generationConfigFromSettings(shots[0].settings))
      : draft.video_config,
  });
  const previous = new Set(current.nodes.map((node) => node.id));
  return {
    canvasNodeIds: graph.nodes.filter((node) => !previous.has(node.id)).map((node) => node.id),
    canvasRevision: graph.canvas.revision,
  };
}

export async function cancelCanvasNodeDrafts(_projectId: string, canvasId: string, taskRunId: string) {
  await canvasCancelStoryboard(canvasId, taskRunId);
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
  return response.Items.map((item) => historyFromDTO(item, canvasnodeId));
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
  service: StoryboardService,
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
  const request: CompatibleMaterializeResourceReferenceRequest = {
    ...scope(projectId, canvasId),
    TargetNodeID: targetNodeId,
    ReferenceType: reference.ReferenceType,
    ...referenceFields,
    TargetPort: targetPort,
    ResourceAssetNodePosition: position,
  };
  return service.MaterializeCanvasResourceAssetReference(request, SILENT_REQUEST);
}

export function materializeCanvasStandaloneAssetReference(
  service: StoryboardService,
  projectId: string,
  canvasId: string,
  targetNodeId: string,
  reference: AssetMentionReference | canvasnode.CanvasUploadedAsset,
  targetPort: canvasnode.CanvasPort,
  position: canvasnode.CanvasNodePosition,
) {
  const uploaded = "BlobID" in reference;
  const request: CompatibleMaterializeAssetReferenceRequest = {
    ...scope(projectId, canvasId),
    TargetNodeID: targetNodeId,
    ReferenceType: canvasnode.CanvasNodeMentionReferenceType.ASSET,
    AssetID: uploaded ? undefined : reference.AssetID,
    UploadedAsset: uploaded ? reference : undefined,
    TargetPort: targetPort,
    AssetNodePosition: position,
  };
  return service.MaterializeCanvasStandaloneAssetReference(request, SILENT_REQUEST);
}

function resolveMentionNodeURL(node: canvasnode.CanvasNodeAssetMentionNode): MentionNode {
  return {
    ...node,
    Children: node.Children.map(resolveMentionNodeURL),
    Review: latestAssetReview(node.Reviews),
    URL: node.URL ? resolveUpPreviewURL(node.URL) : undefined,
  };
}

/** @ 面板直接消费服务端返回的通用素材树和窗口状态。 */
export async function queryMentionTree(
  service: Pick<AgentFrameService, "SearchCanvasNodeAssets">,
  projectId: string,
  canvasId: string,
  canvasnodeId: string,
  keyword: string,
  cursor: string | undefined,
  limit: number,
  mediaTypes?: canvasnode.CanvasNodeMediaType[],
): Promise<MentionTreeResult> {
  const trimmed = keyword.trim();
  const response = await service.SearchCanvasNodeAssets(
    {
      ...scope(projectId, canvasId),
      NodeID: canvasnodeId,
      Keyword: trimmed || undefined,
      Cursor: cursor,
      Limit: limit,
      MediaTypes: mediaTypes,
    },
    SILENT_REQUEST,
  );
  return {
    items: response.Items.map(resolveMentionNodeURL),
    nextCursor: response.NextCursor,
  };
}

function storyboardSettings(draft: CanvasStoryboardDraft): StoryboardSettings {
  const config = draft.video_config;
  return {
    model: config.provider_id,
    ratio: config.aspect_ratio,
    resolution: config.resolution,
    duration: config.duration_seconds + "s",
    audio: config.generate_audio ? "有声" : "无声",
    watermark: config.watermark ? "有水印" : "无水印",
  };
}
async function observeDraft(
  canvasId: string,
  draft: CanvasStoryboardDraft,
  signal: AbortSignal,
  onSession: (session: StoryboardDraftSession) => void,
  onShot: (shot: Shot) => void,
) {
  let snapshot = draft;
  const publish = (next: CanvasStoryboardDraft) => {
    snapshot = next;
    const settings = storyboardSettings(next);
    const shots = next.shots.map((shot) =>
      shotFromDraftDTO(
        {
          DraftID: shot.id,
          CanvasNodeNo: shot.sequence_no,
          Prompt: shot.prompt,
          DurationSeconds: shot.duration_seconds,
          AssetReferences: [],
        },
        settings,
      ),
    );
    const running = next.status === "queued" || next.status === "running";
    onSession({
      taskRunId: next.id,
      plot: next.plot,
      status: running ? "running" : next.status === "failed" || next.status === "cancelled" ? "failed" : "completed",
      generating: running,
      canvasnodes: shots,
      inferenceModelServiceId: next.input.provider_id,
      videoModelServiceId: next.video_config.provider_id,
      canvasnodeDurationMinSeconds: next.input.duration_min,
      canvasnodeDurationMaxSeconds: next.input.duration_max,
      totalDurationMinSeconds: next.input.total_duration_min,
      totalDurationMaxSeconds: next.input.total_duration_max,
      settings,
    });
    for (const shot of shots) onShot(shot);
  };
  publish(draft);
  if (draft.status === "queued" || draft.status === "running")
    await observeCanvasStoryboard(canvasId, draft.id, signal, publish);
  if (snapshot.status === "queued" || snapshot.status === "running")
    publish(await canvasGetStoryboard(canvasId, draft.id, { signal }));
}
