import { canvasCreateArchive, canvasUpdateCanvasView, fetchCanvasSettings } from "@repo/api";
import { Provider, useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { AssetReviewDialog } from "@/components/AssetReviewDialog/index";
import { CanvasConversation } from "@/components/CanvasConversation";
import { EllipsisText as CEllipsis } from "@/components/compat";
import {
  getVideoModelParamConfigByOption,
  sanitizeGenerationSettings,
} from "@/components/GenerationConfiguration/videoModelConfig";
import {
  type AssetMentionItem,
  type AssetMentionSource,
  mentionReferenceIdentity,
} from "@/components/promptEditor/index";
import { Message, Spin, Tooltip } from "@/components/ui";
import { type asset, canvas as canvasIDL, canvasnode } from "@/domain";
import type { UploadBlobResult } from "@/hooks/uploads";
import useSilentUploadBlob from "@/hooks/useSilentUploadBlob";
import {
  GetCanvasGraph,
  ConnectCanvasNodes,
  DeleteCanvasNode,
  DeleteCanvasEdge,
  ReorderStoryboardNodes,
} from "@/pages/studio/domain/persistence";
import { resolveArtifactURL } from "@/utils/artifactURL";
import { latestAssetReview } from "@/utils/assetReview";
import t from "@/utils/i18n";

import { getCanvas } from "../canvases/actions";
import { createResourceFromExistingAsset } from "../resources/domain/actions";
import { MaterialMatchButton } from "./assetMatching/MaterialMatchButton";
import { useMaterialMatching } from "./assetMatching/useMaterialMatching";
import { CanvasBoard, type CanvasBoardHandle } from "./canvas/CanvasBoard";
import { CanvasNodeStore } from "./canvas/graph/CanvasNodeStore";
import { canvasNodeGraphEdges, resolveCanvasConnection } from "./canvas/graph/connectionPolicy";
import {
  type CanvasNodePortCounts,
  canvasNodeInputMediaTypes,
  canvasNodeInputWarning,
  resolveCanvasNodeInput,
} from "./canvas/graph/nodeProtocol";
import { AssetStrip } from "./components/AssetStrip";
import { ExportHistoryDrawer } from "./components/ExportHistoryDrawer";
import { GenerationHistoryDialog } from "./components/GenerationHistoryDialog";
import { ScriptEditor } from "./components/ScriptEditor";
import {
  ScriptEditorActivationRegion,
  isScriptEditorInteractionTarget,
} from "./components/ScriptEditorActivationRegion";
import { StudioAssetPanel } from "./components/StudioAssetPanel";
import { StudioHeader } from "./components/StudioHeader";
import {
  StoryboardDraftNotFoundError,
  cancelCancellableVideoGeneration,
  cancelCanvasNodeDrafts,
  canvasGenerationFailureFromError,
  canvasRequestErrorMessage,
  confirmCanvasNodeDrafts,
  createCanvasNode,
  deleteCanvasNode,
  generationConfigPatch,
  getCanvasNodeAssets,
  materializeCanvasResourceAssetReference,
  materializeCanvasStandaloneAssetReference,
  queryMentionTree,
  recoverCanvasNodeDrafts,
  selectCanvasNodeHistory,
  startCanvasGeneration,
  startCanvasNodeGeneration,
  streamCanvasNodeDrafts,
  updateCanvasNode,
} from "./domain/actions";
import { createCanvasStatePubSub } from "./domain/canvasStatePubSub";
import { hasExportableCanvasVideo } from "./domain/exportAvailability";
import { isVideoGenerationCancellationDisabled, videoProviderStatusForRun } from "./domain/generationCancellation";
import {
  assetFromCanvasNode,
  categoryFromFile,
  hasStoryboardScript,
  isAssetUploadReady,
  isVisibleStripAsset,
  materializedCanvasNodeAssetId,
  preferLocalBlobPreview,
  releaseAssetLocalFile,
  revokeAssetBlobUrls,
  revokeUnusedAssetBlobUrls,
} from "./domain/model";
import {
  DEFAULT_SETTINGS,
  type GenerationHistoryItem,
  type PlayMode,
  type Shot,
  type StoryboardAsset,
  type StoryboardSettings,
  type StudioView,
} from "./domain/types";
import { listStudioModels } from "./domain/videoModels";
import { waitForCanvasEditingBeforeViewChange } from "./domain/viewTransition";
import { activeAssetsAtom, canvasAssetDetailsAtom, useStudioAssetStore } from "./store/assets";
import {
  assetsPanelOpenAtom,
  canvasAtom,
  canvasGenerationRuntimeStatesAtom,
  canvasGraphLoadedAtom,
  canvasLayoutRequestAtom,
  canvasNodesAtom,
  clearCanvasGenerationFailureAtom,
  defaultModelsAtom,
  defaultStoryboardModelIdAtom,
  defaultVideoModelIdAtom,
  imageModelsAtom,
  patchCanvasNodeAtom,
  removeCanvasNodeAtom,
  reorderStoryboardNodesAtom,
  replaceCanvasNodesAtom,
  setCanvasGenerationFailureAtom,
  setCanvasGenerationRuntimeStateAtom,
  storyboardModelsAtom,
  storyboardOptimisticShotsAtom,
  storyboardShotsAtom,
  studioReadyAtom,
  studioViewAtom,
  studioViewChangingAtom,
  textModelsAtom,
  upsertCanvasNodesAtom,
  useStudioMutationCoordinator,
  videoModelsAtom,
} from "./store/index";
import { EmptyStoryboard } from "./storyboard/EmptyStoryboard";
import { PreviewPanel } from "./storyboard/PreviewPanel";
import { ScriptDesignDialog } from "./storyboard/ScriptDesignDialog";
import {
  DEFAULT_SHOT_DURATION_RANGE,
  DEFAULT_VIDEO_DURATION_RANGE,
  type ScriptDurationRange,
} from "./storyboard/scriptDuration";
import { type AddShotMode, ShotTimeline } from "./storyboard/ShotTimeline";
import { ShotTitle } from "./storyboard/ShotTitle";
import { StoryboardPreviewDialog } from "./storyboard/StoryboardPreviewDialog";
import { StoryboardToolbar } from "./storyboard/StoryboardToolbar";
import { useCanvasStatePolling } from "./useCanvasStatePolling";
import { useStudioAssetReviewPolling } from "./useStudioAssetReviewPolling";

const CHAT_PANEL_MIN_WIDTH = 320;
const CHAT_PANEL_MAX_WIDTH = 640;

export default function StudioPage() {
  const { projectId = "", canvasId = "" } = useParams();
  return (
    <Provider key={`${projectId}:${canvasId}`}>
      <StudioContent />
    </Provider>
  );
}

function StudioContent() {
  const navigate = useNavigate();
  const { projectId = "", canvasId = "" } = useParams();
  const { abortUploadAllFiles, abortUploadFile, customRequest } = useSilentUploadBlob();
  const assetStore = useStudioAssetStore();
  const mutationCoordinator = useStudioMutationCoordinator();
  const studioStore = useStore();
  const [nodePubSub] = useState(() => new CanvasNodeStore(studioStore));
  const [statePubSub] = useState(createCanvasStatePubSub);
  const assets = useAtomValue(activeAssetsAtom);

  const [canvas, setCanvas] = useAtom(canvasAtom);
  const [studioReady, setStudioReady] = useAtom(studioReadyAtom);
  const [view, setView] = useAtom(studioViewAtom);
  const [viewChanging, setViewChanging] = useAtom(studioViewChangingAtom);
  const [assetsOpen, setAssetsOpen] = useAtom(assetsPanelOpenAtom);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(420);
  const [chatResizing, setChatResizing] = useState(false);
  const chatResizeCleanupRef = useRef<(() => void) | undefined>(undefined);
  const canvasBoardRef = useRef<CanvasBoardHandle>(null);
  const shots = useAtomValue(storyboardShotsAtom);
  const canvasNodes = useAtomValue(canvasNodesAtom);
  const canvasAssetDetails = useAtomValue(canvasAssetDetailsAtom);
  const canvasGraphLoaded = useAtomValue(canvasGraphLoadedAtom);
  const canvasGenerationRuntimeStates = useAtomValue(canvasGenerationRuntimeStatesAtom);
  useCanvasStatePolling({ canvasId, nodePubSub, projectId, statePubSub });
  useStudioAssetReviewPolling(projectId, canvasGraphLoaded);
  const setOptimisticShots = useSetAtom(storyboardOptimisticShotsAtom);

  useEffect(() => () => chatResizeCleanupRef.current?.(), []);
  useEffect(() => () => statePubSub.clear(), [statePubSub]);
  const upsertCanvasNodes = useSetAtom(upsertCanvasNodesAtom);
  const replaceCanvasNodes = useSetAtom(replaceCanvasNodesAtom);
  const patchCanvasNode = useSetAtom(patchCanvasNodeAtom);
  const clearCanvasGenerationFailure = useSetAtom(clearCanvasGenerationFailureAtom);
  const setCanvasGenerationFailure = useSetAtom(setCanvasGenerationFailureAtom);
  const removeCanvasNode = useSetAtom(removeCanvasNodeAtom);
  const reorderStoryboardNodes = useSetAtom(reorderStoryboardNodesAtom);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  /** design 剧本输入；preview 分镜预览（含生成中 / 生成后）。 */
  const [storyboardStep, setStoryboardStep] = useState<"design" | "preview">();
  const [storyboardPlot, setStoryboardPlot] = useState("");
  const [storyboardTaskRunId, setStoryboardTaskRunId] = useState("");
  const [, setStoryboardDraftPresent] = useState(false);
  const [storyboardDraftStatus, setStoryboardDraftStatus] = useState<"running" | "completed" | "failed">("running");
  const [previewShots, setPreviewShots] = useState<Shot[]>([]);
  const [previewGenerating, setPreviewGenerating] = useState(false);
  const [previewConfirming, setPreviewConfirming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySelecting, setHistorySelecting] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const videoModels = useAtomValue(videoModelsAtom);
  const storyboardModels = useAtomValue(storyboardModelsAtom);
  const setVideoModels = useSetAtom(videoModelsAtom);
  const setStoryboardModels = useSetAtom(storyboardModelsAtom);
  const setImageModels = useSetAtom(imageModelsAtom);
  const setTextModels = useSetAtom(textModelsAtom);
  const setDefaultModels = useSetAtom(defaultModelsAtom);
  const requestCanvasLayout = useSetAtom(canvasLayoutRequestAtom);
  const defaultVideoModelId = useAtomValue(defaultVideoModelIdAtom);
  const defaultInferenceModelId = useAtomValue(defaultStoryboardModelIdAtom);
  const [storyboardBatchSettings, setStoryboardBatchSettings] = useState<StoryboardSettings>(DEFAULT_SETTINGS);
  const [storyboardInferenceModelId, setStoryboardInferenceModelId] = useState("");
  const [storyboardShotDuration, setStoryboardShotDuration] =
    useState<ScriptDurationRange>(DEFAULT_SHOT_DURATION_RANGE);
  const [storyboardVideoDuration, setStoryboardVideoDuration] =
    useState<ScriptDurationRange>(DEFAULT_VIDEO_DURATION_RANGE);
  const storyboardAbortRef = useRef<AbortController>();
  const storyboardRequestIDRef = useRef(0);
  const [selectedShotId, setSelectedShotId] = useState("");
  const [draftScript, setDraftScript] = useState("");
  const [draftSettings, setDraftSettings] = useState<StoryboardSettings>(DEFAULT_SETTINGS);
  const [draftVideoInputMode, setDraftVideoInputMode] = useState<canvasnode.CanvasVideoInputMode>(
    canvasnode.CanvasVideoInputMode.REFERENCE,
  );
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [composing, setComposing] = useState(false);
  const [stoppingGenerationShotId, setStoppingGenerationShotId] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exportHistoryOpen, setExportHistoryOpen] = useState(false);
  const [playMode, setPlayMode] = useState<PlayMode>("shot");
  /** 播放头停在哪个分镜上；暂停时保留，便于原地续播。 */
  const [playingShotId, setPlayingShotId] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const storyboardEditorRegionRef = useRef<HTMLElement>(null);
  const finishEditingPromiseRef = useRef<Promise<void>>();
  const [reviewRequest, setReviewRequest] = useState<{
    item: AssetMentionItem;
    error?: string;
    loading: boolean;
    onUpdated: Parameters<NonNullable<AssetMentionSource["review"]>>[1];
    shotId: string;
    upload?: asset.AssetReviewUpload;
  }>();
  const reviewRequestIDRef = useRef(0);
  const assetDetailRequestIDRef = useRef(0);
  const canvasGraphRequestIDRef = useRef(0);
  /** draftId → 后台 artifact storage 直传 Promise。 */
  const assetTaskRef = useRef(new Map<string, Promise<string>>());
  /** 已移除或取消的 draft，禁止后台写回 store。 */
  const cancelledDraftRef = useRef(new Set<string>());
  /** 编辑开始时的正式输入关系，用于取消编辑或保存失败时恢复素材连线。 */
  const draftInputBaselineRef = useRef<{
    edges: canvasnode.CanvasEdge[];
    shotId: string;
  }>();
  /** 当前编辑会话中新建的素材节点；移除引用时一起删除，避免留下孤立节点。 */
  const draftCreatedNodeIdsRef = useRef(new Set<string>());
  /** Start 返回 TaskRunID 前仍允许用户终止；取消请求会排在 Start 之后执行。 */
  const generationStartRef = useRef(new Map<string, Promise<string>>());

  const selectedIndex = shots.findIndex((shot) => shot.id === selectedShotId);
  const currentShot = shots[selectedIndex];
  /** 生成参数存在分镜上；无选中分镜时使用项目配置的默认视频模型。 */
  const persistedSettings = currentShot?.settings ?? {
    ...DEFAULT_SETTINGS,
    model: defaultVideoModelId,
  };
  const settings = editing ? draftSettings : persistedSettings;
  const videoInputMode = editing
    ? draftVideoInputMode
    : (currentShot?.videoInputMode ?? canvasnode.CanvasVideoInputMode.REFERENCE);
  const materialMatching = useMaterialMatching(selectedShotId);
  const editorScript = editing ? draftScript : (currentShot?.script ?? "");
  const hasCurrentScript = hasStoryboardScript(editorScript);
  const hasVideoModels = videoModels.length > 0;
  const hasStoryboardModels = storyboardModels.length > 0;
  const resolveModelServiceId = () => settings.model || defaultVideoModelId;
  const canvasnodeIDBefore = (index: number) =>
    shots
      .slice(0, index)
      .reverse()
      .find((item) => !item.storyboardTaskRunId)?.id;
  const modelParamConfig = getVideoModelParamConfigByOption(resolveModelServiceId(), videoModels);
  const modelAssetLimits = modelParamConfig.limits.assets;
  const hasRenderedShot = shots.some((shot) => shot.status === "ready" && Boolean(shot.videoUrl || shot.thumbnail));
  const hasRenderedCanvasVideo = hasExportableCanvasVideo(canvasNodes);
  const canvasPanelNodes = canvasNodes.map((item) => {
    const detail = assetFromCanvasNode(item, canvasAssetDetails.get(item.NodeID));
    return {
      asset: detail,
      item,
      previewURL: item.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION ? item.FirstFrameURL : detail.previewUrl,
    };
  });
  const playableShots = shots.filter(
    (shot) => !shot.storyboardTaskRunId && !shot.optimisticCreate && shot.status === "ready" && Boolean(shot.videoUrl),
  );
  const hasPlayableShot = playableShots.length > 0;
  const playingShotIndex = playableShots.findIndex((shot) => shot.id === playingShotId);
  const nextPlaybackShot = playingShotIndex >= 0 ? playableShots[playingShotIndex + 1] : undefined;
  const formalShotCount = shots.reduce(
    (count, shot) => count + (shot.storyboardTaskRunId || shot.optimisticCreate ? 0 : 1),
    0,
  );
  const hasGeneratableShot = shots.some(
    (shot) => !shot.storyboardTaskRunId && !shot.optimisticCreate && hasStoryboardScript(shot.script),
  );
  const detailLoaded = currentShot?.detailLoaded !== false;
  const editable =
    detailLoaded &&
    (currentShot?.status === "empty" || currentShot?.status === "ready" || currentShot?.status === "failed");
  const generating = currentShot?.status === "generating";
  /** 详情未加载或正在生成时，提示词、素材与生成参数都不可修改。 */
  const assetsEditable = editing && detailLoaded && !generating && !saving;
  /** 整集连播时预览跟着播放位置走，其余时候跟着时间轴选中项走。 */
  const previewShot = playingShotId ? shots.find((shot) => shot.id === playingShotId) : currentShot;
  const stripAssets = assets.filter(isVisibleStripAsset);

  /** 资产按分镜隔离，选中项一变外部 store 也要切到对应分镜名下。 */
  const selectShot = useCallback(
    (id: string) => {
      setSelectedShotId(id);
      assetStore.setActiveShot(id);
    },
    [assetStore],
  );

  useEffect(() => {
    if (!canvasGraphLoaded) return;
    const formalShots = shots.filter((shot) => !shot.storyboardTaskRunId);
    if (formalShots.some((shot) => shot.id === selectedShotId)) return;
    selectShot(formalShots[0]?.id ?? "");
  }, [canvasGraphLoaded, selectShot, selectedShotId, shots]);

  useEffect(() => {
    let active = true;
    setStudioReady(false);
    getCanvas(projectId, canvasId)
      .then((result) => {
        if (active) {
          setCanvas(result);
          setView(result.DefaultView === canvasIDL.CanvasViewMode.STORYBOARD ? "storyboard" : "canvas");
        }
      })
      .catch(() => {
        // 请求失败的提示由请求层统一处理，页面保留默认标题。
      })
      .finally(() => {
        if (active) {
          setStudioReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [canvasId, projectId]);

  const refreshCanvasGraph = useCallback(async () => {
    const requestID = ++canvasGraphRequestIDRef.current;
    await mutationCoordinator.waitForIdle();
    const snapshotEpoch = mutationCoordinator.snapshotEpoch();
    const response = await GetCanvasGraph({
      ProjectID: projectId,
      CanvasID: canvasId,
    });
    if (requestID !== canvasGraphRequestIDRef.current || !mutationCoordinator.isSnapshotCurrent(snapshotEpoch)) {
      return;
    }
    const nodes = response.Nodes;
    assetStore.cacheDetails(
      nodes.map((item) => {
        const detail = assetFromCanvasNode(item);
        const previewURL = resolveArtifactURL(item.PreviewURL ?? "");
        return {
          ...detail,
          previewUrl: previewURL || undefined,
          review: latestAssetReview(item.Reviews),
          reviews: item.Reviews,
          thumbnail: detail.category === "image" ? previewURL || undefined : detail.thumbnail,
        };
      }),
    );
    // 先准备展示详情，再替换整图。批量采纳产生的新分镜首次进入顶层
    // canvasNodes 时即可拿到资产库预览，不暴露 nodes / details 的中间态。
    replaceCanvasNodes(nodes);
  }, [assetStore, canvasId, mutationCoordinator, projectId, replaceCanvasNodes]);

  useEffect(() => {
    if (!studioReady) return;
    void refreshCanvasGraph().catch(() => {
      // 请求层已统一提示，保留加载态供重新进入页面重试。
    });
    return () => {
      canvasGraphRequestIDRef.current += 1;
    };
  }, [refreshCanvasGraph, studioReady]);

  useEffect(() => {
    let active = true;
    fetchCanvasSettings()
      .then((config) => {
        if (active) {
          setDefaultModels(config.defaults);
        }
      })
      .catch(() => {
        if (active) {
          setDefaultModels({});
          Message.warning(t("默认模型配置加载失败，已使用项目可用模型"));
        }
      });
    setImageModels([]);
    setTextModels([]);
    setVideoModels([]);
    setStoryboardModels([]);
    setModelsLoading(true);
    listStudioModels(projectId)
      .then((items) => {
        if (active) {
          setImageModels(items.image);
          setTextModels(items.text);
          setVideoModels(items.video);
          setStoryboardModels(items.storyboard);
        }
      })
      .catch(() => {
        if (active) {
          setImageModels([]);
          setTextModels([]);
          setVideoModels([]);
          setStoryboardModels([]);
        }
      })
      .finally(() => {
        if (active) {
          setModelsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (defaultVideoModelId) {
      setStoryboardBatchSettings((current) => (current.model ? current : { ...current, model: defaultVideoModelId }));
    }
    if (defaultInferenceModelId) {
      setStoryboardInferenceModelId((current) => current || defaultInferenceModelId);
    }
  }, [defaultInferenceModelId, defaultVideoModelId]);

  useEffect(() => {
    if (!studioReady || !canvasGraphLoaded) return;
    storyboardRequestIDRef.current += 1;
    storyboardAbortRef.current?.abort();
    storyboardAbortRef.current = undefined;
    setStoryboardStep(undefined);
    setStoryboardPlot("");
    setStoryboardTaskRunId("");
    setStoryboardDraftPresent(false);
    setStoryboardDraftStatus("running");
    setPreviewShots([]);
    setPreviewGenerating(false);
    setLoading(false);
  }, [canvasGraphLoaded, studioReady]);

  /** 正式关系已可同步投影；异步请求只补充签名 URL、审核等展示信息。 */
  useEffect(() => {
    if (view !== "storyboard" || !selectedShotId) return;
    const targetNode = canvasNodes.find((node) => node.NodeID === selectedShotId);
    if (!targetNode) return;
    const requestID = ++assetDetailRequestIDRef.current;
    getCanvasNodeAssets(targetNode, canvasNodes).then(
      (assets) => {
        if (requestID !== assetDetailRequestIDRef.current) return;
        assetStore.cacheDetails(assets);
      },
      () => {
        // 请求层已统一提示；画布节点占位仍保留，展示详情可稍后重试。
      },
    );
    return () => {
      if (requestID === assetDetailRequestIDRef.current) {
        assetDetailRequestIDRef.current += 1;
      }
    };
  }, [assetStore, canvasNodes, selectedShotId, view]);

  /** Provider 虽按画布隔离，卸载时仍需释放本地预览。 */
  useEffect(
    () => () => {
      storyboardAbortRef.current?.abort();
      revokeAssetBlobUrls(assetStore.listAll());
      assetStore.reset();
    },
    [canvasId, projectId],
  );

  const stopPlayback = () => {
    setPlaying(false);
    setPlayingShotId(undefined);
  };

  const patchShot = (id: string, patch: Partial<Shot>) => {
    const nodePatch: Partial<canvasnode.CanvasNode> = {};
    if (patch.revision !== undefined) nodePatch.Revision = patch.revision;
    if (patch.script !== undefined) nodePatch.Prompt = patch.script;
    if (patch.videoInputMode !== undefined) nodePatch.VideoInputMode = patch.videoInputMode;
    if ("activeGenerationRunId" in patch) nodePatch.ActiveTaskRunID = patch.activeGenerationRunId;
    if ("selectedOutputId" in patch) nodePatch.SelectedOutputID = patch.selectedOutputId;
    if ("videoUrl" in patch) nodePatch.SelectedOutputURL = patch.videoUrl;
    if ("firstFrameAssetId" in patch) nodePatch.FirstFrameAssetID = patch.firstFrameAssetId;
    if ("firstFrameUrl" in patch) nodePatch.FirstFrameURL = patch.firstFrameUrl;
    if (patch.duration !== undefined) {
      const duration = Number.parseInt(patch.duration, 10);
      if (Number.isFinite(duration)) nodePatch.SelectedOutputDurationSeconds = duration;
    }
    if (patch.status !== undefined) {
      nodePatch.Status =
        patch.status === "generating"
          ? canvasnode.CanvasNodeStatus.GENERATING
          : patch.status === "ready"
            ? canvasnode.CanvasNodeStatus.READY
            : canvasnode.CanvasNodeStatus.EMPTY;
    }
    patchCanvasNode({ nodeId: id, patch: nodePatch });
  };

  const updateCanvasNodePartially = (shotId: string, patch: Parameters<typeof updateCanvasNode>[3]) => {
    const execute = async () => {
      const saved = await updateCanvasNode(projectId, canvasId, shotId, patch);
      upsertCanvasNodes([saved.node]);
      return saved;
    };
    return mutationCoordinator.enqueue(execute);
  };

  /** 列表状态只是快照；点击任何草稿项都走同一个 Fetch SSE，由服务端按最新 DB 状态决策重放或跟随。 */
  const openStoryboardTask = (target: Shot) => {
    const taskRunId = target.storyboardTaskRunId;
    if (!taskRunId) {
      return;
    }
    storyboardAbortRef.current?.abort();
    const controller = new AbortController();
    storyboardAbortRef.current = controller;
    const requestId = storyboardRequestIDRef.current + 1;
    storyboardRequestIDRef.current = requestId;
    setStoryboardTaskRunId(taskRunId);
    setStoryboardPlot(target.script);
    setStoryboardDraftPresent(true);
    setStoryboardDraftStatus(
      target.timelineStatus === "pending-confirmation"
        ? "completed"
        : target.timelineStatus === "failed"
          ? "failed"
          : "running",
    );
    setPreviewGenerating(target.timelineStatus === "generating");
    setPreviewShots([]);
    setStoryboardStep("preview");
    const frontendSettings = {
      ...target.settings,
      model: target.settings.model || defaultVideoModelId,
    };
    setStoryboardBatchSettings(frontendSettings);
    void recoverCanvasNodeDrafts(
      statePubSub,
      taskRunId,
      frontendSettings,
      controller.signal,
      (session) => {
        if (controller.signal.aborted || requestId !== storyboardRequestIDRef.current) {
          return;
        }
        setStoryboardPlot(session.plot);
        if (session.inferenceModelServiceId) {
          setStoryboardInferenceModelId(session.inferenceModelServiceId);
        }
        setStoryboardBatchSettings(session.settings);
        if (session.canvasnodeDurationMinSeconds && session.canvasnodeDurationMaxSeconds) {
          setStoryboardShotDuration({
            min: session.canvasnodeDurationMinSeconds,
            max: session.canvasnodeDurationMaxSeconds,
          });
        }
        if (session.totalDurationMinSeconds && session.totalDurationMaxSeconds) {
          setStoryboardVideoDuration({
            min: session.totalDurationMinSeconds / 60,
            max: session.totalDurationMaxSeconds / 60,
          });
        }
        setStoryboardDraftStatus(session.status);
        setPreviewGenerating(session.generating);
      },
      (shot) => {
        if (controller.signal.aborted || requestId !== storyboardRequestIDRef.current) {
          return;
        }
        setPreviewShots((current) =>
          [...current.filter((item) => item.id !== shot.id), shot].sort(
            (left, right) => (left.draftCanvasNodeNo ?? 0) - (right.draftCanvasNodeNo ?? 0),
          ),
        );
      },
    )
      .then(() => {
        if (controller.signal.aborted || requestId !== storyboardRequestIDRef.current) {
          return;
        }
        setPreviewGenerating(false);
        setStoryboardDraftStatus("completed");
        void refreshCanvasGraph();
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          requestId !== storyboardRequestIDRef.current ||
          error instanceof StoryboardDraftNotFoundError
        ) {
          return;
        }
        setPreviewGenerating(false);
        setStoryboardDraftStatus("failed");
        void refreshCanvasGraph();
        Message.error(error instanceof Error ? error.message : t("恢复分镜草稿失败"));
      });
  };

  const openShot = (id: string) => {
    const target = shots.find((shot) => shot.id === id);
    if (!target) {
      return;
    }
    stopPlayback();
    if (target.storyboardTaskRunId) {
      openStoryboardTask(target);
      return;
    }
    selectShot(id);
    setEditing(false);
    setDirty(false);
  };

  const beginEditing = () => {
    stopPlayback();
    if (currentShot) {
      assetStore.beginDraft(currentShot.id);
      const target = studioStore.get(canvasNodesAtom).find((node) => node.NodeID === currentShot.id);
      draftInputBaselineRef.current = {
        edges: [...(target?.IncomingEdges ?? [])],
        shotId: currentShot.id,
      };
      draftCreatedNodeIdsRef.current.clear();
    }
    setDraftScript(currentShot?.script ?? "");
    setDraftSettings(
      sanitizeGenerationSettings(
        persistedSettings,
        getVideoModelParamConfigByOption(persistedSettings.model, videoModels),
      ),
    );
    setDraftVideoInputMode(currentShot?.videoInputMode ?? canvasnode.CanvasVideoInputMode.REFERENCE);
    setEditing(true);
  };

  const queryMentionAssets = useCallback(
    async (query: string, cursor: string | undefined, limit: number, signal: AbortSignal) => {
      if (!selectedShotId) {
        return {
          items: [],
        };
      }
      signal.throwIfAborted();
      const target = canvasNodes.find((node) => node.NodeID === selectedShotId);
      if (!target) {
        return { items: [] };
      }
      const result = await queryMentionTree(
        projectId,
        canvasId,
        selectedShotId,
        query,
        cursor,
        limit,
        canvasNodeInputMediaTypes(target, "material"),
      );
      signal.throwIfAborted();
      return result;
    },
    [canvasId, canvasNodes, projectId, selectedShotId],
  );

  const selectMentionAsset = useCallback(
    async (
      candidate: AssetMentionItem & {
        targetPort?: canvasnode.CanvasPort;
      },
    ) => {
      if (!selectedShotId) {
        throw new Error("canvasnode is not selected");
      }
      const shotId = selectedShotId;
      const inputTarget = (target: canvasnode.CanvasNode) => ({
        ...target,
        VideoInputMode: draftVideoInputMode,
      });
      const slotCounts = assetStore.getForShot(shotId).reduce<CanvasNodePortCounts>((counts, item) => {
        if (item.targetPort !== undefined) {
          counts[item.targetPort] = (counts[item.targetPort] ?? 0) + 1;
        }
        return counts;
      }, {});
      const initialReference = mentionReferenceIdentity(candidate);
      if (initialReference?.kind === "canvasNode") {
        const sourceNodeId = initialReference.CanvasNodeID;
        const target = studioStore.get(canvasNodesAtom).find((node) => node.NodeID === shotId);
        if (!target) throw new Error("canvas node is not available");
        const source = studioStore.get(canvasNodesAtom).find((node) => node.NodeID === sourceNodeId);
        if (!source) throw new Error("source canvas node is not available");
        const resolution = resolveCanvasConnection(
          source,
          inputTarget(target),
          canvasNodeGraphEdges(studioStore.get(canvasNodesAtom)),
          {
            slotCounts,
            preferredPort: candidate.targetPort,
          },
        );
        if (!resolution.accepted) {
          Message.warning(canvasNodeInputWarning(resolution));
          throw new Error("canvas node input rejected");
        }
        const targetPort = resolution.targetPort;
        if (!target.IncomingEdges.some((edge) => edge.SourceNodeID === sourceNodeId)) {
          const connected = await mutationCoordinator.enqueue(() =>
            ConnectCanvasNodes(
              {
                ProjectID: projectId,
                CanvasID: canvasId,
                SourceNodeID: sourceNodeId,
                TargetNodeID: shotId,
                TargetPort: targetPort,
              },
              { skipErrorNotify: true },
            ),
          );
          upsertCanvasNodes([connected.TargetNode]);
          setCanvas((current) => (current ? { ...current, Revision: connected.CanvasRevision } : current));
        }
        const selected: StoryboardAsset = {
          ...candidate,
          id: sourceNodeId,
          referenceType: "canvasNode",
          canvasNodeId: sourceNodeId,
          description: candidate.description ?? "",
          syncStatus: "ready",
          source: "canvasnode",
          targetPort,
        };
        assetStore.cacheDetails([selected]);
        assetStore.updateDraft(shotId, (items) =>
          items.some((item) => item.id === selected.id) ? items : [...items, selected],
        );
        return selected;
      }
      let resolvedCandidate = candidate;
      const assetId = candidate.assetId ?? candidate.id;
      let uploadedAsset: canvasnode.CanvasUploadedAsset | undefined;
      const existing = assetStore
        .getForShot(shotId)
        .find(
          (item) =>
            item.id === candidate.id ||
            item.assetId === assetId ||
            item.draftId === candidate.id ||
            candidate.draftId === item.id,
        );
      const target = studioStore.get(canvasNodesAtom).find((node) => node.NodeID === shotId);
      if (!target) throw new Error("canvas node is not available");
      if (existing) {
        if (existing.targetPort !== undefined) {
          slotCounts[existing.targetPort] = Math.max(0, (slotCounts[existing.targetPort] ?? 0) - 1);
        }
      }
      const resolution = resolveCanvasNodeInput(candidate.category, inputTarget(target), {
        kind: "material",
        slotCounts,
        preferredPort: candidate.targetPort,
      });
      if (!resolution.accepted) {
        Message.warning(canvasNodeInputWarning(resolution));
        throw new Error("canvas node input rejected");
      }
      const targetPort = resolution.targetPort;
      if (candidate.id.startsWith("draft-")) {
        let local = assetStore
          .getForShot(shotId)
          .find((item) => item.id === candidate.id || item.draftId === candidate.id);
        if (!local) throw new Error("local asset is not available");
        if (!local.blobId) {
          const task = assetTaskRef.current.get(candidate.id);
          if (!task) throw new Error("local asset upload is not available");
          await task;
          local = assetStore
            .getForShot(shotId)
            .find((item) => item.id === candidate.id || item.draftId === candidate.id);
        }
        if (!local?.blobId) throw new Error("local asset blob is not available");
        uploadedAsset = { BlobID: local.blobId, FileName: local.title };
        resolvedCandidate = {
          ...candidate,
          referenceType: "asset",
          description: local.description,
          previewUrl: local.previewUrl,
          thumbnail: local.thumbnail,
          title: local.title,
        };
      }
      const reference = uploadedAsset ? undefined : mentionReferenceIdentity(resolvedCandidate);
      if ((!reference && !uploadedAsset) || reference?.kind === "canvasNode") {
        throw new Error("asset reference is not available");
      }
      let materializedNode: canvasnode.CanvasNode;
      let materializedTarget: canvasnode.CanvasNode;
      let materializedCanvasRevision: number;
      let createdMaterializedNode = false;
      if (reference && (reference.kind === "resource" || reference.kind === "resourceAsset")) {
        const materialized = await mutationCoordinator.enqueue(() =>
          materializeCanvasResourceAssetReference(projectId, canvasId, shotId, reference, targetPort, target.Position),
        );
        materializedNode = materialized.ResourceAssetNode;
        materializedTarget = materialized.TargetNode;
        materializedCanvasRevision = materialized.CanvasRevision;
        createdMaterializedNode = materialized.CreatedResourceAssetNode;
      } else {
        const standaloneReference = uploadedAsset ?? (reference?.kind === "asset" ? reference : undefined);
        if (!standaloneReference) throw new Error("standalone asset reference is not available");
        const materialized = await mutationCoordinator.enqueue(() =>
          materializeCanvasStandaloneAssetReference(
            projectId,
            canvasId,
            shotId,
            standaloneReference,
            targetPort,
            target.Position,
          ),
        );
        materializedNode = materialized.AssetNode;
        materializedTarget = materialized.TargetNode;
        materializedCanvasRevision = materialized.CanvasRevision;
        createdMaterializedNode = materialized.CreatedAssetNode;
      }
      setCanvas((current) => (current ? { ...current, Revision: materializedCanvasRevision } : current));
      upsertCanvasNodes([materializedNode, materializedTarget]);
      if (createdMaterializedNode) {
        draftCreatedNodeIdsRef.current.add(materializedNode.NodeID);
      }
      if (existing) {
        const selected: StoryboardAsset = preferLocalBlobPreview(existing, {
          ...existing,
          id: materializedNode.NodeID,
          referenceType: "canvasNode",
          assetId: materializedCanvasNodeAssetId(materializedNode, resolvedCandidate.assetId),
          canvasNodeId: materializedNode.NodeID,
          resourceAssetId: resolvedCandidate.resourceAssetId,
          title: resolvedCandidate.title,
          previewUrl: resolvedCandidate.previewUrl ?? existing.previewUrl,
          thumbnail: resolvedCandidate.thumbnail ?? existing.thumbnail,
          source: resolvedCandidate.source ?? existing.source,
          resourceId: resolvedCandidate.resourceId ?? existing.resourceId,
          resourceType: resolvedCandidate.resourceType ?? existing.resourceType,
          review: resolvedCandidate.review ?? existing.review,
          blobId: undefined,
          pendingFile: undefined,
          syncStatus: "ready",
          targetPort,
        });
        assetStore.cacheDetails([selected]);
        assetStore.updateDraft(shotId, (items) => items.map((item) => (item === existing ? selected : item)));
        return selected;
      }
      const selected: StoryboardAsset = {
        id: materializedNode.NodeID,
        referenceType: "canvasNode",
        assetId: materializedCanvasNodeAssetId(materializedNode, resolvedCandidate.assetId),
        canvasNodeId: materializedNode.NodeID,
        resourceAssetId: resolvedCandidate.resourceAssetId,
        category: resolvedCandidate.category,
        title: resolvedCandidate.title,
        description: resolvedCandidate.description ?? "",
        previewUrl: materializedNode.PreviewURL || resolvedCandidate.previewUrl,
        thumbnail:
          resolvedCandidate.thumbnail ||
          (resolvedCandidate.category === "image" ? materializedNode.PreviewURL : undefined),
        syncStatus: "ready",
        source: resolvedCandidate.source ?? "project",
        resourceId: resolvedCandidate.resourceId,
        resourceType: resolvedCandidate.resourceType,
        review: resolvedCandidate.review,
        targetPort,
      };
      assetStore.cacheDetails([selected]);
      assetStore.updateDraft(shotId, (items) =>
        items.some((item) => item.id === selected.id) ? items : [...items, selected],
      );
      return selected;
    },
    [
      assetStore,
      canvasId,
      draftVideoInputMode,
      mutationCoordinator,
      projectId,
      selectedShotId,
      setCanvas,
      studioStore,
      upsertCanvasNodes,
    ],
  );

  const selectMentionAssetWithFeedback = useCallback(
    async (candidate: Parameters<typeof selectMentionAsset>[0]) => {
      try {
        return await selectMentionAsset(candidate);
      } catch (error) {
        Message.error(canvasRequestErrorMessage(error, t("添加素材失败，请重试")));
        throw error;
      }
    },
    [selectMentionAsset],
  );

  const prepareReviewRequest = useCallback(
    async (
      shotId: string,
      candidate: AssetMentionItem,
      onUpdated: Parameters<NonNullable<AssetMentionSource["review"]>>[1],
    ) => {
      const requestID = ++reviewRequestIDRef.current;
      setReviewRequest({ item: candidate, loading: true, onUpdated, shotId });
      try {
        const draftId = candidate.draftId ?? candidate.id;
        if (!draftId.startsWith("draft-")) {
          if (requestID !== reviewRequestIDRef.current) return;
          setReviewRequest({
            item: candidate,
            loading: false,
            onUpdated,
            shotId,
          });
          return;
        }
        let current = assetStore.getForShot(shotId).find((item) => item.id === draftId || item.draftId === draftId);
        if (!current || !isAssetUploadReady(current)) {
          const task = assetTaskRef.current.get(draftId);
          if (!task) throw new Error(t("素材尚未就绪，请稍后重试"));
          await task;
          current = assetStore.getForShot(shotId).find((item) => item.id === draftId || item.draftId === draftId);
        }
        if (!current?.blobId) {
          throw new Error(t("素材尚未就绪，请稍后重试"));
        }
        if (requestID !== reviewRequestIDRef.current) return;
        setReviewRequest({
          item: { ...candidate, title: current.title },
          loading: false,
          onUpdated,
          shotId,
          upload: {
            BlobID: current.blobId,
            ClientID: draftId,
            FileName: current.title,
          },
        });
      } catch (reason) {
        if (requestID !== reviewRequestIDRef.current) return;
        setReviewRequest({
          item: candidate,
          error: reason instanceof Error ? reason.message : t("送审信息加载失败，请重试"),
          loading: false,
          onUpdated,
          shotId,
        });
      }
    },
    [],
  );

  const reviewMentionAsset = useCallback(
    (candidate: AssetMentionItem, onUpdated: Parameters<NonNullable<AssetMentionSource["review"]>>[1]) => {
      if (!selectedShotId && (candidate.draftId ?? candidate.id).startsWith("draft-")) {
        return;
      }
      void prepareReviewRequest(selectedShotId, candidate, onUpdated);
    },
    [prepareReviewRequest, selectedShotId],
  );

  const addMentionAssetToLibrary = useCallback<NonNullable<AssetMentionSource["addToLibrary"]>>(
    async (candidate, input) => {
      const nodeId = candidate.canvasNodeId;
      const response = await createResourceFromExistingAsset(projectId, candidate.assetId ?? candidate.id, {
        ...input,
        canvasId: nodeId ? canvasId : undefined,
        canvasNodeId: nodeId,
      });
      const binding = response.CanvasNodeBinding;
      if (binding) {
        const current = studioStore.get(canvasNodesAtom).find((item) => item.NodeID === binding.CanvasNodeID);
        if (current) {
          const updated: canvasnode.CanvasNode = {
            ...current,
            AssetID: undefined,
            CurrentAssetID: binding.CurrentAssetID,
            ResourceAssetID: binding.ResourceAssetID,
            ResourceAssetIsPrimary: response.ResourceAsset.IsPrimary,
            ResourceAssetRevision: response.ResourceAsset.Revision,
            Revision: binding.CanvasNodeRevision,
            SelectedAssetID: undefined,
            SelectedOutputID: undefined,
          };
          upsertCanvasNodes([updated]);
          assetStore.cacheDetails([
            {
              ...assetFromCanvasNode(updated),
              assetId: binding.CurrentAssetID,
              previewUrl: resolveArtifactURL(response.ResourceAsset.PreviewURL ?? ""),
              resourceAssetId: binding.ResourceAssetID,
              resourceId: response.Resource.ResourceID,
              review: latestAssetReview(response.ResourceAsset.Reviews),
              reviews: response.ResourceAsset.Reviews,
            },
          ]);
        }
      }
      Message.success(t("已添加到资产库"));
    },
    [assetStore, canvasId, projectId, studioStore, upsertCanvasNodes],
  );

  const patchAsset = (
    shotId: string,
    draftId: string,
    patch: Partial<StoryboardAsset> | ((item: StoryboardAsset) => StoryboardAsset),
  ) => {
    assetStore.updateDraft(shotId, (current) =>
      current.map((item) => {
        if (item.id !== draftId && item.draftId !== draftId) {
          return item;
        }
        return typeof patch === "function" ? patch(item) : { ...item, ...patch };
      }),
    );
  };

  /**
   * 选文件只静默直传 artifact storage，不建 Asset、不绑分镜。
   * 关浏览器或不保存时服务端绑定与编辑前一致。
   */
  const startAssetBatchSync = (shotId: string, entries: Array<{ draftId: string; file: File }>) => {
    entries.forEach(({ draftId, file }) => {
      const task = (async () => {
        patchAsset(shotId, draftId, {
          syncStatus: "uploading",
          uploading: false,
        });
        const blobId = await uploadBlob(file);
        if (cancelledDraftRef.current.has(draftId)) {
          throw new Error("asset cancelled");
        }
        patchAsset(shotId, draftId, (item) => ({
          ...releaseAssetLocalFile(item),
          blobId,
          syncStatus: "uploaded",
        }));
        return blobId;
      })().catch((error) => {
        if (!cancelledDraftRef.current.has(draftId)) {
          patchAsset(shotId, draftId, (item) => ({
            ...releaseAssetLocalFile(item),
            syncStatus: "failed",
            uploading: false,
            description: t("同步失败，可移除后重试"),
          }));
        }
        throw error;
      });
      assetTaskRef.current.set(draftId, task);
      void task
        .finally(() => {
          if (assetTaskRef.current.get(draftId) === task) {
            assetTaskRef.current.delete(draftId);
          }
        })
        .catch(() => undefined);
    });
  };

  const ensureAssetsReady = async (shotId: string) => {
    const items = assetStore.getForShot(shotId);
    const failed = items.filter((item) => item.syncStatus === "failed");
    if (failed.length) {
      Message.error(t("部分资产同步失败，请移除后重新上传"));
      throw new Error("asset sync failed");
    }
    await Promise.all(
      items.map(async (item) => {
        if (isAssetUploadReady(item)) {
          return;
        }
        const key = item.draftId ?? item.id;
        const task = assetTaskRef.current.get(key);
        if (!task) {
          Message.error(t("资产尚未就绪，请稍后重试"));
          throw new Error("asset task missing");
        }
        await task;
      }),
    );
  };

  /** 保存前把仍停留在上传态的草稿素材统一落成 CanvasNode 和正式连线。 */
  const materializePendingInputs = async (shot: Shot) => {
    const pending = assetStore.getForShot(shot.id).filter((item) => !item.canvasNodeId);
    for (const item of pending) {
      await selectMentionAssetWithFeedback(item);
    }
  };

  const persistRemovedInputs = async (
    shotId: string,
    target: canvasnode.CanvasNode,
    desiredSourceIDs = new Set(
      assetStore.getForShot(shotId).flatMap((item) => (item.canvasNodeId ? [item.canvasNodeId] : [])),
    ),
  ) => {
    const removed = target.IncomingEdges.filter((edge) => !desiredSourceIDs.has(edge.SourceNodeID));
    if (!removed.length) return;
    let canvasRevision: number | undefined;
    for (const edge of removed) {
      if (draftCreatedNodeIdsRef.current.has(edge.SourceNodeID)) {
        const response = await mutationCoordinator.enqueue(() =>
          DeleteCanvasNode(
            {
              ProjectID: projectId,
              CanvasID: canvasId,
              NodeID: edge.SourceNodeID,
            },
            { skipErrorNotify: true },
          ),
        );
        canvasRevision = response.CanvasRevision;
        draftCreatedNodeIdsRef.current.delete(edge.SourceNodeID);
        removeCanvasNode(edge.SourceNodeID);
        continue;
      }
      const response = await mutationCoordinator.enqueue(() =>
        DeleteCanvasEdge(
          {
            ProjectID: projectId,
            CanvasID: canvasId,
            TargetNodeID: shotId,
            EdgeID: edge.EdgeID,
          },
          { skipErrorNotify: true },
        ),
      );
      canvasRevision = response.CanvasRevision;
      upsertCanvasNodes([response.TargetNode]);
    }
    if (canvasRevision !== undefined) {
      setCanvas((current) => (current ? { ...current, Revision: canvasRevision } : current));
    }
  };

  /** 保存中途失败时，清理本次编辑新增的输入，并恢复编辑前被移除的正式连线。 */
  const restoreDraftInputBaseline = async (shotId: string) => {
    const baseline = draftInputBaselineRef.current;
    if (baseline?.shotId !== shotId) return;
    const baselineSourceIDs = new Set(baseline.edges.map((edge) => edge.SourceNodeID));
    const target = studioStore.get(canvasNodesAtom).find((node) => node.NodeID === shotId);
    if (!target) return;

    await persistRemovedInputs(shotId, target, baselineSourceIDs);
    let currentTarget = studioStore.get(canvasNodesAtom).find((node) => node.NodeID === shotId);
    if (!currentTarget) return;

    let canvasRevision: number | undefined;
    for (const edge of [...baseline.edges].sort((left, right) => left.TargetOrder - right.TargetOrder)) {
      if (currentTarget.IncomingEdges.some((current) => current.SourceNodeID === edge.SourceNodeID)) {
        continue;
      }
      const connected = await mutationCoordinator.enqueue(() =>
        ConnectCanvasNodes(
          {
            ProjectID: projectId,
            CanvasID: canvasId,
            SourceNodeID: edge.SourceNodeID,
            TargetNodeID: shotId,
            TargetPort: edge.TargetPort,
          },
          { skipErrorNotify: true },
        ),
      );
      canvasRevision = connected.CanvasRevision;
      currentTarget = connected.TargetNode;
      upsertCanvasNodes([connected.TargetNode]);
    }
    if (canvasRevision !== undefined) {
      setCanvas((current) => (current ? { ...current, Revision: canvasRevision } : current));
    }
  };

  const persistFirstLastFrameOrder = async (shotId: string, target: canvasnode.CanvasNode) => {
    const frames = assetStore
      .getForShot(shotId)
      .filter((item) => item.category === "image")
      .sort((left, right) => {
        const order = (item: StoryboardAsset) =>
          item.targetPort === canvasnode.CanvasPort.FIRST_FRAME
            ? 0
            : item.targetPort === canvasnode.CanvasPort.LAST_FRAME
              ? 1
              : 2;
        return order(left) - order(right);
      })
      .slice(0, 2);
    if (frames.length !== 2) return;

    const desired = frames.map((frame, index) => ({
      sourceNodeId: frame.canvasNodeId ?? frame.id,
      targetPort: index === 0 ? canvasnode.CanvasPort.FIRST_FRAME : canvasnode.CanvasPort.LAST_FRAME,
    }));
    return mutationCoordinator.enqueue(async () => {
      const currentBySource = new Map(target.IncomingEdges.map((edge) => [edge.SourceNodeID, edge]));
      if (desired.every((item) => currentBySource.get(item.sourceNodeId)?.TargetPort === item.targetPort)) {
        return;
      }

      let canvasRevision: number | undefined;
      for (const item of desired) {
        const edge = currentBySource.get(item.sourceNodeId);
        if (!edge) continue;
        const deleted = await DeleteCanvasEdge(
          {
            ProjectID: projectId,
            CanvasID: canvasId,
            TargetNodeID: shotId,
            EdgeID: edge.EdgeID,
          },
          { skipErrorNotify: true },
        );
        canvasRevision = deleted.CanvasRevision;
        upsertCanvasNodes([deleted.TargetNode]);
      }

      for (const item of desired) {
        const connected = await ConnectCanvasNodes(
          {
            ProjectID: projectId,
            CanvasID: canvasId,
            SourceNodeID: item.sourceNodeId,
            TargetNodeID: shotId,
            TargetPort: item.targetPort,
          },
          { skipErrorNotify: true },
        );
        canvasRevision = connected.CanvasRevision;
        upsertCanvasNodes([connected.TargetNode]);
      }

      if (canvasRevision !== undefined) {
        setCanvas((current) => (current ? { ...current, Revision: canvasRevision } : current));
      }
    });
  };

  /** 提示词、生成参数和输入模式共用同一份编辑草稿，并在保存时一次提交。 */
  const persistDraft = async () => {
    if (!currentShot) {
      return;
    }
    const shotId = currentShot.id;
    let inputsNeedRestore = true;
    let nodeNeedsRestore = false;
    setSaving(true);
    try {
      await ensureAssetsReady(shotId);
      const target = studioStore.get(canvasNodesAtom).find((node) => node.NodeID === shotId);
      if (!target) throw new Error("canvas node is not available");
      await persistRemovedInputs(shotId, target);
      const generationConfig = generationConfigPatch(currentShot.settings, draftSettings, draftVideoInputMode);
      let saved: Awaited<ReturnType<typeof updateCanvasNodePartially>>;
      try {
        saved = await updateCanvasNodePartially(shotId, {
          Prompt: draftScript,
          ...(Object.keys(generationConfig).length > 0 ? { GenerationConfig: generationConfig } : {}),
          ...(draftVideoInputMode !== currentShot.videoInputMode ? { VideoInputMode: draftVideoInputMode } : {}),
        });
      } catch (error) {
        Message.error(canvasRequestErrorMessage(error, t("分镜保存失败，请重试")));
        throw error;
      }
      nodeNeedsRestore = true;
      await materializePendingInputs(currentShot);
      if (draftVideoInputMode === canvasnode.CanvasVideoInputMode.FIRST_LAST_FRAME) {
        const liveTarget = studioStore.get(canvasNodesAtom).find((node) => node.NodeID === shotId);
        if (!liveTarget) throw new Error("canvas node is not available");
        await persistFirstLastFrameOrder(shotId, liveTarget);
      }
      inputsNeedRestore = false;
      nodeNeedsRestore = false;
      setDraftScript(saved.shot.script);
      setDraftSettings(saved.shot.settings);
      setDraftVideoInputMode(saved.shot.videoInputMode ?? canvasnode.CanvasVideoInputMode.REFERENCE);
      setEditing(false);
      setDirty(false);
      assetStore.clearDraft(shotId);
      draftInputBaselineRef.current = undefined;
      draftCreatedNodeIdsRef.current.clear();
    } catch (error) {
      if (nodeNeedsRestore) {
        try {
          const originalVideoInputMode = currentShot.videoInputMode ?? canvasnode.CanvasVideoInputMode.REFERENCE;
          const generationConfig = generationConfigPatch(draftSettings, currentShot.settings, originalVideoInputMode);
          await updateCanvasNodePartially(shotId, {
            Prompt: currentShot.script,
            ...(Object.keys(generationConfig).length > 0 ? { GenerationConfig: generationConfig } : {}),
            ...(draftVideoInputMode !== originalVideoInputMode ? { VideoInputMode: originalVideoInputMode } : {}),
          });
        } catch {
          // 请求层会提示节点恢复失败；继续尝试恢复输入连线。
        }
      }
      if (inputsNeedRestore) {
        try {
          await restoreDraftInputBaseline(shotId);
        } catch {
          // 请求层会提示恢复失败；保留编辑态，避免把当前草稿误判为已保存。
        }
      }
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const discardDraft = async () => {
    abortUploadAllFiles();
    const shotId = currentShot?.id;
    const snapshot = assetStore.getSnapshot();
    for (const item of snapshot) {
      const draftId = item.draftId ?? (item.id.startsWith("draft-") ? item.id : "");
      if (draftId) {
        cancelledDraftRef.current.add(draftId);
      }
      if (item.pendingFile) {
        abortUploadFile(item.pendingFile);
      }
    }
    if (shotId) {
      const baseline = draftInputBaselineRef.current;
      const target = studioStore.get(canvasNodesAtom).find((node) => node.NodeID === shotId);
      if (target && baseline?.shotId === shotId) {
        await persistRemovedInputs(shotId, target, new Set(baseline.edges.map((edge) => edge.SourceNodeID)));
      }
      assetTaskRef.current.clear();
      assetStore.clearDraft(shotId);
      revokeUnusedAssetBlobUrls(snapshot, assetStore.getForShot(shotId));
    }
    draftInputBaselineRef.current = undefined;
    draftCreatedNodeIdsRef.current.clear();
    setDraftScript(currentShot?.script ?? "");
    setDraftSettings(persistedSettings);
    setDraftVideoInputMode(currentShot?.videoInputMode ?? canvasnode.CanvasVideoInputMode.REFERENCE);
    setEditing(false);
    setDirty(false);
  };

  /** 与画布一致：离开编辑区域时，有修改则保存，无修改则结束编辑。 */
  const finishEditing = () => {
    if (finishEditingPromiseRef.current) {
      return finishEditingPromiseRef.current;
    }
    const task = (dirty ? persistDraft() : discardDraft()).finally(() => {
      if (finishEditingPromiseRef.current === task) {
        finishEditingPromiseRef.current = undefined;
      }
    });
    finishEditingPromiseRef.current = task;
    return task;
  };

  const saveDraft = () => {
    finishEditing().catch(() => {
      // 请求层已统一提示，保持编辑态便于重试。
    });
  };

  /** 切换分镜、视图或返回列表前，先自动保存当前编辑会话。 */
  const guard = (action: () => void) => {
    if (!editing) {
      action();
      return;
    }
    void finishEditing()
      .then(action)
      .catch(() => {
        // 保存失败时停留在当前分镜，保留草稿供用户重试。
      });
  };

  const addSingleShot = async (index: number) => {
    const modelServiceId = resolveModelServiceId();
    if (!modelServiceId) {
      Message.error(t("暂无可用视频模型"));
      return;
    }
    const afterCanvasNodeId = canvasnodeIDBefore(index);
    const previousSelectedShotId = selectedShotId;
    const optimisticId = `optimistic-create-${Date.now()}`;
    const optimisticSettings = sanitizeGenerationSettings(
      { ...DEFAULT_SETTINGS, model: modelServiceId },
      getVideoModelParamConfigByOption(modelServiceId, videoModels),
    );
    setOptimisticShots([
      {
        id: optimisticId,
        detailLoaded: false,
        timelineStatus: "creating",
        optimisticCreate: true,
        optimisticAfterNodeId: afterCanvasNodeId,
        duration: optimisticSettings.duration,
        status: "empty",
        script: "",
        settings: optimisticSettings,
        videoInputMode: canvasnode.CanvasVideoInputMode.REFERENCE,
      },
    ]);
    if (!previousSelectedShotId) {
      selectShot(optimisticId);
    }
    setCreating(true);
    try {
      const created = await mutationCoordinator.enqueue(async () => {
        const result = await createCanvasNode(projectId, canvasId, modelServiceId, afterCanvasNodeId);
        upsertCanvasNodes([result.node]);
        return result;
      });
      setCanvas((current) => (current ? { ...current, Revision: created.canvasRevision } : current));
      setOptimisticShots([]);
      // 新分镜没有可继承的播放上下文；否则 previewShot 会继续命中上一分镜，
      // 导致时间轴已选中新分镜时右侧仍残留旧视频及其播放能力。
      stopPlayback();
      selectShot(created.shot.id);
      setEditing(false);
      setDirty(false);
    } catch {
      setOptimisticShots([]);
      if (!previousSelectedShotId) selectShot("");
      // 请求层已统一提示，乐观分镜已撤销。
    } finally {
      setCreating(false);
    }
  };

  const handleAddShot = (index: number, mode: AddShotMode) => {
    if (!hasVideoModels || (mode === "batch" && !hasStoryboardModels)) {
      Message.warning(t("当前工作空间暂无可用模型，请先在管理端配置并启用模型"));
      return;
    }
    if (mode === "single") {
      void addSingleShot(index);
      return;
    }
    setStoryboardPlot("");
    setStoryboardBatchSettings({
      ...DEFAULT_SETTINGS,
      model: defaultVideoModelId,
    });
    setStoryboardInferenceModelId(defaultInferenceModelId);
    setStoryboardShotDuration(DEFAULT_SHOT_DURATION_RANGE);
    setStoryboardVideoDuration(DEFAULT_VIDEO_DURATION_RANGE);
    setStoryboardTaskRunId("");
    setStoryboardDraftPresent(false);
    setStoryboardDraftStatus("running");
    setStoryboardStep("design");
  };

  const resetStoryboardFlow = () => {
    storyboardAbortRef.current?.abort();
    storyboardAbortRef.current = undefined;
    setStoryboardStep(undefined);
    setStoryboardPlot("");
    setStoryboardTaskRunId("");
    setStoryboardDraftPresent(false);
    setStoryboardDraftStatus("running");
    setPreviewShots([]);
    setPreviewGenerating(false);
    setPreviewConfirming(false);
  };

  /** 关闭预览不取消生成：SSE 继续，时间轴显示草稿卡片。 */
  const handleStoryboardMinimize = () => {
    setStoryboardStep(undefined);
  };

  const handleScriptDesignSubmit = (
    plot: string,
    batchSettings: StoryboardSettings,
    durations: { shot: ScriptDurationRange; video: ScriptDurationRange },
    inferenceModelServiceId: string,
  ) => {
    const requestId = storyboardRequestIDRef.current + 1;
    storyboardRequestIDRef.current = requestId;
    setStoryboardPlot(plot);
    setStoryboardBatchSettings(batchSettings);
    setStoryboardInferenceModelId(inferenceModelServiceId);
    setStoryboardShotDuration(durations.shot);
    setStoryboardVideoDuration(durations.video);
    setStoryboardStep("preview");
    setPreviewShots([]);
    setPreviewGenerating(true);
    storyboardAbortRef.current?.abort();
    const controller = new AbortController();
    storyboardAbortRef.current = controller;

    void (async () => {
      let sessionReceived = false;
      const modelServiceId = batchSettings.model || defaultVideoModelId;
      if (!modelServiceId) {
        Message.error(t("暂无可用视频模型"));
        setStoryboardStep("design");
        setPreviewGenerating(false);
        return;
      }
      const frontendSettings = sanitizeGenerationSettings(
        { ...batchSettings, model: modelServiceId },
        getVideoModelParamConfigByOption(modelServiceId, videoModels),
      );
      try {
        await streamCanvasNodeDrafts(
          projectId,
          canvasId,
          plot,
          {
            inferenceModelServiceId,
            videoModelServiceId: modelServiceId,
          },
          durations,
          frontendSettings,
          statePubSub,
          controller.signal,
          (session) => {
            const firstSession = !sessionReceived;
            sessionReceived = true;
            if (controller.signal.aborted || requestId !== storyboardRequestIDRef.current) {
              return;
            }
            setStoryboardPlot(session.plot);
            if (session.inferenceModelServiceId) {
              setStoryboardInferenceModelId(session.inferenceModelServiceId);
            }
            setStoryboardBatchSettings(session.settings);
            if (session.canvasnodeDurationMinSeconds && session.canvasnodeDurationMaxSeconds) {
              setStoryboardShotDuration({
                min: session.canvasnodeDurationMinSeconds,
                max: session.canvasnodeDurationMaxSeconds,
              });
            }
            if (session.totalDurationMinSeconds && session.totalDurationMaxSeconds) {
              setStoryboardVideoDuration({
                min: session.totalDurationMinSeconds / 60,
                max: session.totalDurationMaxSeconds / 60,
              });
            }
            setStoryboardTaskRunId(session.taskRunId);
            setStoryboardDraftPresent(true);
            setStoryboardDraftStatus(session.status);
            setPreviewGenerating(session.generating);
            if (firstSession) void refreshCanvasGraph();
          },
          (shot) => {
            if (controller.signal.aborted || requestId !== storyboardRequestIDRef.current) {
              return;
            }
            setPreviewShots((current) =>
              [...current.filter((item) => item.id !== shot.id), shot].sort(
                (left, right) => (left.draftCanvasNodeNo ?? 0) - (right.draftCanvasNodeNo ?? 0),
              ),
            );
          },
        );
        if (controller.signal.aborted || requestId !== storyboardRequestIDRef.current) {
          return;
        }
        setPreviewGenerating(false);
        setStoryboardDraftStatus("completed");
        await refreshCanvasGraph();
      } catch (error) {
        if (controller.signal.aborted || requestId !== storyboardRequestIDRef.current) {
          return;
        }
        Message.error(error instanceof Error ? error.message : t("分镜生成失败"));
        setPreviewGenerating(false);
        setStoryboardDraftStatus("failed");
        if (sessionReceived) {
          void refreshCanvasGraph();
        }
        // 已入库的失败草稿节点必须显式放弃后才能重建；建节点前失败才回设计页。
        setStoryboardStep(sessionReceived ? "preview" : "design");
      }
    })();
  };

  const cancelStoryboardDraft = async () => {
    if (!storyboardTaskRunId) {
      return;
    }
    try {
      await mutationCoordinator.enqueue(() => cancelCanvasNodeDrafts(projectId, canvasId, storyboardTaskRunId));
      await refreshCanvasGraph();
      storyboardRequestIDRef.current += 1;
      resetStoryboardFlow();
    } catch {
      // 请求层已统一提示；保留草稿 UI，刷新后仍可从 Canvas 节点恢复。
    }
  };

  const handleStoryboardDiscard = () => {
    void cancelStoryboardDraft();
  };

  const handleStoryboardTerminate = () => {
    void cancelStoryboardDraft();
  };

  const handleStoryboardAdopt = async (items: Shot[]) => {
    if (storyboardDraftStatus !== "completed") {
      Message.error(t("分镜尚未完整生成，无法采纳"));
      return;
    }
    setPreviewConfirming(true);
    try {
      const confirmed = await mutationCoordinator.enqueue(() =>
        confirmCanvasNodeDrafts(
          projectId,
          canvasId,
          storyboardTaskRunId,
          items.map((shot) => ({
            ...shot,
            settings: sanitizeGenerationSettings(
              shot.settings,
              getVideoModelParamConfigByOption(shot.settings.model, videoModels),
            ),
          })),
        ),
      );
      setCanvas((current) => (current ? { ...current, Revision: confirmed.canvasRevision } : current));
      await refreshCanvasGraph();
      requestCanvasLayout({
        requestId: Date.now(),
        seedNodeIds: confirmed.canvasNodeIds,
      });
      const firstCanvasNodeId = confirmed.canvasNodeIds[0];
      if (firstCanvasNodeId) {
        selectShot(firstCanvasNodeId);
      }
      setEditing(false);
      setDirty(false);
      Message.success(
        t("已创建 {count} 个分镜", {
          count: confirmed.canvasNodeIds.length,
        }),
      );
      resetStoryboardFlow();
    } finally {
      setPreviewConfirming(false);
    }
  };

  const removeShot = async (id: string) => {
    if (!canvas) return;
    const response = await mutationCoordinator.enqueue(() => deleteCanvasNode(projectId, canvasId, id));
    setCanvas((current) => (current ? { ...current, Revision: response.CanvasRevision } : current));
    const index = shots.findIndex((shot) => shot.id === id);
    const nextShots = shots.filter((shot) => shot.id !== id);
    removeCanvasNode(id);
    const removedAssets = assetStore.getForShot(id);
    assetStore.dropShot(id);
    revokeUnusedAssetBlobUrls(removedAssets, assetStore.listAll());
    if (selectedShotId === id) {
      const fallback =
        nextShots
          .slice(0, index)
          .reverse()
          .find((item) => !item.storyboardTaskRunId) ??
        nextShots.slice(index).find((item) => !item.storyboardTaskRunId);
      selectShot(fallback?.id ?? "");
      setDraftScript(fallback?.script ?? "");
      setEditing(false);
      setDirty(false);
    }
  };

  const renameShot = async (id: string, name: string) => {
    try {
      const saved = await updateCanvasNodePartially(id, { Name: name });
      return saved.shot.name || name;
    } catch (error) {
      Message.error(canvasRequestErrorMessage(error, t("节点保存失败，请刷新后重试")));
      throw error;
    }
  };

  const handleRemoveShot = (id: string) => {
    const index = shots.findIndex((shot) => shot.id === id);
    if (index < 0) {
      return;
    }
    const target = shots[index];
    if (target?.status === "generating" || target?.timelineStatus === "generating" || target?.activeGenerationRunId) {
      return;
    }
    if (target?.storyboardTaskRunId) {
      const targetTaskRunId = target.storyboardTaskRunId;
      void mutationCoordinator
        .enqueue(() => cancelCanvasNodeDrafts(projectId, canvasId, targetTaskRunId))
        .then(async () => {
          await refreshCanvasGraph();
          if (storyboardTaskRunId === target.storyboardTaskRunId) {
            resetStoryboardFlow();
          }
        });
      return;
    }
    void removeShot(id).catch(() => Message.error(t("分镜删除失败，请重试")));
  };

  const handleGenerate = async () => {
    const selectedModelID = resolveModelServiceId();
    if (!selectedModelID || !videoModels.some((model) => model.id === selectedModelID)) {
      Message.warning(t("当前分镜选择的模型未获项目授权，请重新选择模型"));
      return;
    }
    if (!currentShot || currentShot.status === "generating" || !hasStoryboardScript(currentShot.script)) {
      return;
    }
    const shotId = currentShot.id;
    try {
      await ensureAssetsReady(shotId);
      await materializePendingInputs(currentShot);
    } catch {
      return;
    }
    stopPlayback();
    patchShot(shotId, {
      status: "generating",
    });
    const start = mutationCoordinator.enqueue(() => startCanvasNodeGeneration(projectId, canvasId, shotId));
    generationStartRef.current.set(shotId, start);
    try {
      const runId = await start;
      clearCanvasGenerationFailure(shotId);
      patchShot(shotId, { activeGenerationRunId: runId });
    } catch (error) {
      setCanvasGenerationFailure({
        nodeId: shotId,
        ...canvasGenerationFailureFromError(error, t("视频生成启动失败")),
      });
      patchShot(shotId, {
        status: currentShot.videoUrl ? "ready" : "empty",
      });
    } finally {
      if (generationStartRef.current.get(shotId) === start) {
        generationStartRef.current.delete(shotId);
      }
    }
  };

  const handleCompose = async () => {
    if (!hasVideoModels) {
      Message.warning(t("当前工作空间暂无可用视频模型，请先在管理端配置并启用视频模型"));
      return;
    }
    if (composing || !hasGeneratableShot) {
      return;
    }
    setComposing(true);
    try {
      // 与单镜生成保持一致：任一正式分镜存在失败或未就绪资产时都不发起整集任务。
      await Promise.all(shots.filter((shot) => !shot.storyboardTaskRunId).map((shot) => ensureAssetsReady(shot.id)));
      const response = await mutationCoordinator.enqueue(() => startCanvasGeneration(projectId, canvasId));
      const accepted = new Map(response.Items.map((item) => [item.NodeID, item.TaskRunID]));
      if (accepted.size > 0) {
        stopPlayback();
        accepted.forEach((runId, nodeId) => {
          clearCanvasGenerationFailure(nodeId);
          patchCanvasNode({
            nodeId,
            patch: {
              Status: canvasnode.CanvasNodeStatus.GENERATING,
              ActiveTaskRunID: runId,
            },
          });
        });
      }
      if (accepted.size === 0) {
        Message.warning(t("当前没有符合生成条件的分镜"));
      } else if (response.SkippedCount > 0) {
        Message.success(
          t("已接纳 {acceptedCount} 个分镜，跳过 {skippedCount} 个", {
            acceptedCount: accepted.size,
            skippedCount: response.SkippedCount,
          }),
        );
      } else {
        Message.success(
          t("已接纳 {acceptedCount} 个分镜生成任务", {
            acceptedCount: accepted.size,
          }),
        );
      }
    } catch {
      // 请求层已统一提示。
    } finally {
      setComposing(false);
    }
  };

  const handleSelectHistory = async (item: GenerationHistoryItem) => {
    if (!currentShot || historySelecting || item.status !== "succeeded") {
      return;
    }
    setHistorySelecting(true);
    try {
      const selectedHistory = await mutationCoordinator.enqueue(() =>
        selectCanvasNodeHistory(projectId, canvasId, currentShot.id, item.id),
      );
      const selectedVideoURL = selectedHistory.OutputURL ?? selectedHistory.VideoURL;
      if (!selectedVideoURL) {
        return;
      }
      stopPlayback();
      patchCanvasNode({
        nodeId: currentShot.id,
        patch: {
          Status: canvasnode.CanvasNodeStatus.READY,
          SelectedOutputID: selectedHistory.HistoryID,
          SelectedAssetID: selectedHistory.OutputAssetID,
          SelectedOutputURL: selectedVideoURL,
          SelectedOutputDurationSeconds: selectedHistory.DurationSeconds,
          FirstFrameAssetID: selectedHistory.FirstFrameAssetID,
          LastFrameAssetID: selectedHistory.LastFrameAssetID,
          FirstFrameURL: selectedHistory.FirstFrameURL,
        },
      });
      clearCanvasGenerationFailure(currentShot.id);
      setHistoryOpen(false);
      Message.success(t("已选用该视频"));
    } catch {
      // 请求层已统一提示，保留当前选中视频。
    } finally {
      setHistorySelecting(false);
    }
  };

  /** 播放全部从第一个已生成分镜起连播，播完顺延到下一个。 */
  const handlePlayAll = () => {
    if (editing) {
      return;
    }
    const first = playableShots[0];
    if (!first) {
      return;
    }
    setPlayMode("canvas");
    selectShot(first.id);
    setPlayingShotId(first.id);
    setPlaying(true);
  };

  /** 视频的 ended 事件到达后再切下一段，避免用配置时长猜测真实播放进度。 */
  const handlePlaybackEnded = () => {
    if (editing) {
      stopPlayback();
      return;
    }
    if (playMode !== "canvas" || !playingShotId) {
      setPlaying(false);
      return;
    }
    const next = nextPlaybackShot;
    if (!next) {
      stopPlayback();
      return;
    }
    selectShot(next.id);
    setPlayingShotId(next.id);
    setPlaying(true);
  };

  const handleStopGenerate = async () => {
    if (!currentShot) {
      return;
    }
    const shotId = currentShot.id;
    const runIdOrPromise = currentShot.activeGenerationRunId ?? generationStartRef.current.get(shotId);
    if (!runIdOrPromise) {
      Message.warning(t("生成任务尚未就绪，请稍后重试"));
      return;
    }
    const generationStatus = videoProviderStatusForRun(
      studioStore.get(canvasGenerationRuntimeStatesAtom),
      shotId,
      currentShot.activeGenerationRunId,
    );
    if (isVideoGenerationCancellationDisabled(generationStatus)) {
      Message.info(t("视频已开始生成，无法取消"));
      return;
    }
    if (stoppingGenerationShotId === shotId) {
      return;
    }
    setStoppingGenerationShotId(shotId);
    try {
      const runId = await Promise.resolve(runIdOrPromise);
      const result = await mutationCoordinator.enqueue(() =>
        cancelCancellableVideoGeneration(projectId, canvasId, shotId, runId),
      );
      if (
        result.status === canvasnode.CanvasGenerationStatus.QUEUED ||
        result.status === canvasnode.CanvasGenerationStatus.RUNNING
      ) {
        studioStore.set(setCanvasGenerationRuntimeStateAtom, {
          nodeId: shotId,
          taskRunId: runId,
          status: result.status,
          providerStatus: result.providerStatus,
        });
      }
      if (!result.cancelled) {
        if (isVideoGenerationCancellationDisabled(result.providerStatus)) {
          Message.info(t("视频已开始生成，无法取消"));
        } else {
          Message.warning(t("生成任务尚未就绪，请稍后重试"));
        }
        return;
      }
      patchShot(shotId, {
        status: "empty",
        activeGenerationRunId: undefined,
      });
      clearCanvasGenerationFailure(shotId);
      Message.success(t("已终止视频生成"));
    } catch {
      Message.error(t("终止视频生成失败，请重试"));
    } finally {
      setStoppingGenerationShotId((current) => (current === shotId ? undefined : current));
    }
  };

  const handleSettingsChange = (next: StoryboardSettings) => {
    if (!currentShot || !editing) {
      return;
    }
    const sanitized = sanitizeGenerationSettings(next, getVideoModelParamConfigByOption(next.model, videoModels));
    setDraftSettings(sanitized);
    setDirty(true);
  };

  const handleVideoInputModeChange = (next: canvasnode.CanvasVideoInputMode) => {
    if (!currentShot || !editing || next === draftVideoInputMode) return;
    setDraftVideoInputMode(next);
    setDirty(true);
  };

  const uploadBlob = (file: File) =>
    new Promise<string>((resolve, reject) => {
      customRequest({
        file,
        onProgress: () => undefined,
        onSuccess: (response) => {
          const blobId = (response as UploadBlobResult | undefined)?.BlobID;
          if (blobId) {
            resolve(blobId);
            return;
          }
          reject(new Error(t("缺少 BlobID")));
        },
        onError: (error) => reject(error),
      });
    });

  const handleUpload = (files: File[], targetPort?: canvasnode.CanvasPort) => {
    const shotId = selectedShotId;
    if (!shotId) {
      return;
    }
    const target = studioStore.get(canvasNodesAtom).find((node) => node.NodeID === shotId);
    if (!target) return;
    const slotCounts = assetStore.getForShot(shotId).reduce<CanvasNodePortCounts>((current, item) => {
      if (item.targetPort !== undefined) {
        current[item.targetPort] = (current[item.targetPort] ?? 0) + 1;
      }
      return current;
    }, {});
    const acceptedFiles: Array<{
      file: File;
      targetPort: canvasnode.CanvasPort;
    }> = [];
    const warnings = new Set<string>();
    for (const file of files) {
      const category = categoryFromFile(file);
      const resolution = resolveCanvasNodeInput(
        category,
        { ...target, VideoInputMode: draftVideoInputMode },
        {
          kind: "material",
          slotCounts,
          preferredPort: targetPort,
        },
      );
      if (!resolution.accepted) {
        warnings.add(canvasNodeInputWarning(resolution));
        continue;
      }
      slotCounts[resolution.targetPort] = (slotCounts[resolution.targetPort] ?? 0) + 1;
      acceptedFiles.push({ file, targetPort: resolution.targetPort });
    }
    warnings.forEach((message) => Message.warning(message));
    if (!acceptedFiles.length) return;
    const entries = acceptedFiles.map(({ file, targetPort }, offset) => {
      const placeholderId = `draft-${Date.now()}-${offset}`;
      cancelledDraftRef.current.delete(placeholderId);
      const preview = URL.createObjectURL(file);
      const thumbnail = file.type.startsWith("image/") ? preview : undefined;
      assetStore.updateDraft(shotId, (current) => [
        ...current,
        {
          id: placeholderId,
          draftId: placeholderId,
          category: categoryFromFile(file),
          title: file.name,
          description: t("本地预览"),
          thumbnail,
          previewUrl: preview,
          pendingFile: file,
          syncStatus: "uploading",
          uploading: false,
          source: "canvasnode",
          targetPort,
        },
      ]);
      return { draftId: placeholderId, file };
    });
    startAssetBatchSync(shotId, entries);
    setDirty(true);
  };

  const handleRemoveAsset = (id: string) => {
    const shotId = selectedShotId;
    if (!shotId) {
      return;
    }
    const removed = assetStore.getForShot(shotId).find((asset) => asset.id === id || asset.draftId === id);
    if (!removed) {
      return;
    }
    const draftId = removed.draftId ?? removed.id;
    cancelledDraftRef.current.add(draftId);
    assetTaskRef.current.delete(draftId);
    if (removed.pendingFile) {
      abortUploadFile(removed.pendingFile);
    }
    assetStore.updateDraft(shotId, (current) => current.filter((asset) => asset.id !== id && asset.draftId !== id));
    revokeUnusedAssetBlobUrls([removed], assetStore.listAll());
    setDirty(true);
    Message.info(t("资产将在保存后移除，取消编辑可撤销"));
  };

  const handleSwapFrameAssets = () => {
    const shotId = selectedShotId;
    if (!shotId) return;
    const frameAssets = assetStore
      .getForShot(shotId)
      .filter((item) => item.category === "image")
      .sort((left, right) => {
        const order = (item: StoryboardAsset) =>
          item.targetPort === canvasnode.CanvasPort.FIRST_FRAME
            ? 0
            : item.targetPort === canvasnode.CanvasPort.LAST_FRAME
              ? 1
              : 2;
        return order(left) - order(right);
      })
      .slice(0, 2);
    if (frameAssets.length !== 2) return;
    const [firstFrame, lastFrame] = frameAssets;
    assetStore.updateDraft(shotId, (current) =>
      current.map((item) =>
        item.id === firstFrame.id
          ? { ...item, targetPort: canvasnode.CanvasPort.LAST_FRAME }
          : item.id === lastFrame.id
            ? { ...item, targetPort: canvasnode.CanvasPort.FIRST_FRAME }
            : item,
      ),
    );
    setDirty(true);
  };

  const applyReviewResults = (results: asset.SubmitAssetReviewResponse[]) => {
    if (!reviewRequest || !results.length) return;
    const latest = results.at(-1);
    if (!latest) return;
    results.forEach((result) => assetStore.updateReview(result.AssetID, result.Review));
    const reviews = results.reduce<asset.AssetReview[]>(
      (current, result) => [...current.filter((review) => review.PackageID !== result.Review.PackageID), result.Review],
      reviewRequest.item.reviews ?? [],
    );
    const draftId = reviewRequest.upload?.ClientID;
    const requestedAssetId = reviewRequest.item.assetId ?? reviewRequest.item.id;
    assetStore.updateDraft(reviewRequest.shotId, (current) =>
      current.map((item) => {
        const matches = draftId
          ? item.id === draftId || item.draftId === draftId
          : item.id === reviewRequest.item.id || item.assetId === requestedAssetId;
        return matches
          ? {
              ...item,
              assetId: latest.AssetID,
              blobId: draftId ? undefined : item.blobId,
              draftId: draftId ?? item.draftId,
              // 已持久化素材的 id 是 CanvasNodeID；只有本地草稿送审后才切到 AssetID。
              id: draftId ? latest.AssetID : item.id,
              pendingFile: draftId ? undefined : item.pendingFile,
              review: latestAssetReview(reviews) ?? latest.Review,
              reviews,
              syncStatus: "ready" as const,
              uploading: false,
            }
          : item;
      }),
    );
    reviewRequest.onUpdated(latest.Review);
    setReviewRequest((current) =>
      current
        ? {
            ...current,
            item: {
              ...current.item,
              assetId: latest.AssetID,
              draftId: draftId ?? current.item.draftId,
              id: latest.AssetID,
              review: latest.Review,
            },
            upload: undefined,
          }
        : current,
    );
  };

  const handleExport = async () => {
    if (exporting) {
      return;
    }
    setExporting(true);
    try {
      await canvasCreateArchive(projectId, canvasId);
      Message.success(t("已开始导出"));
      setExportHistoryOpen(true);
    } catch {
      Message.error(t("发起批量导出失败，请重试"));
    } finally {
      setExporting(false);
    }
  };

  const handleViewChange = async (next: StudioView) => {
    if (next === view || viewChanging) return;
    const previous = view;
    setViewChanging(true);
    const canChange = await waitForCanvasEditingBeforeViewChange(view, next, canvasBoardRef.current?.finishEditing);
    if (!canChange) {
      setViewChanging(false);
      return;
    }
    stopPlayback();
    canvasBoardRef.current?.pauseMedia();
    // 画布节点编辑器也会切换素材 Store 的 activeShotId；回故事版时即使
    // selectedShotId 没变，也必须先恢复当前分镜的素材上下文。
    if (next === "storyboard") {
      assetStore.setActiveShot(selectedShotId);
    }
    setView(next);
    if (!canvas) {
      setViewChanging(false);
      return;
    }
    try {
      await mutationCoordinator.enqueue(() =>
        canvasUpdateCanvasView(
          projectId,
          canvasId,
          { default_view: next === "canvas" ? canvasIDL.CanvasViewMode.CANVAS : canvasIDL.CanvasViewMode.STORYBOARD },
          { skipErrorNotify: true },
        ),
      );
      setCanvas((current) =>
        current
          ? {
              ...current,
              DefaultView: next === "canvas" ? canvasIDL.CanvasViewMode.CANVAS : canvasIDL.CanvasViewMode.STORYBOARD,
            }
          : current,
      );
    } catch {
      setView(previous);
      Message.error(t("视图切换保存失败"));
    } finally {
      setViewChanging(false);
    }
  };

  const handleReorderShots = async (orderedIds: string[]) => {
    if (!canvas || editing || saving) return;
    const previousIds = shots.filter((shot) => !shot.storyboardTaskRunId).map((shot) => shot.id);
    const byId = new Map(shots.map((shot) => [shot.id, shot]));
    const ordered = orderedIds.flatMap((id) => {
      const shot = byId.get(id);
      return shot ? [shot] : [];
    });
    if (ordered.length !== orderedIds.length) return;
    reorderStoryboardNodes(orderedIds);
    try {
      const response = await mutationCoordinator.enqueue(() =>
        ReorderStoryboardNodes(
          {
            ProjectID: projectId,
            CanvasID: canvasId,
            Items: orderedIds.map((nodeId, index) => ({
              NodeID: nodeId,
              StoryboardRank: index + 1,
            })),
          },
          { skipErrorNotify: true },
        ),
      );
      setCanvas((current) => (current ? { ...current, Revision: response.CanvasRevision } : current));
      upsertCanvasNodes(response.Nodes);
    } catch {
      reorderStoryboardNodes(previousIds);
      Message.error(t("分镜排序保存失败，请重试"));
    }
  };

  const handleChatResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    chatResizeCleanupRef.current?.();
    const startX = event.clientX;
    const startWidth = chatWidth;
    const bodyCursor = document.body.style.cursor;
    const bodyUserSelect = document.body.style.userSelect;
    let shouldCollapse = false;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setChatResizing(true);
    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const targetWidth = startWidth + startX - moveEvent.clientX;
      shouldCollapse = targetWidth < CHAT_PANEL_MIN_WIDTH;
      setChatWidth(shouldCollapse ? Math.max(0, targetWidth) : Math.min(CHAT_PANEL_MAX_WIDTH, targetWidth));
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      document.body.style.cursor = bodyCursor;
      document.body.style.userSelect = bodyUserSelect;
      setChatResizing(false);
      if (shouldCollapse) {
        setChatWidth(startWidth);
        setChatOpen(false);
      }
      chatResizeCleanupRef.current = undefined;
    };
    chatResizeCleanupRef.current = handleUp;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  };

  return (
    <main
      className="relative flex h-full min-w-[1440px] min-h-0 flex-col overflow-hidden bg-[#FDFDFD]"
      onPointerDownCapture={(event) => {
        const target = event.target;
        if (
          view !== "storyboard" ||
          !editing ||
          !(target instanceof Element) ||
          isScriptEditorInteractionTarget(storyboardEditorRegionRef.current, target) ||
          target.closest(".canvas-editor-overlay, [data-canvas-editor-overlay]")
        ) {
          return;
        }
        void finishEditing().catch(() => {
          // 请求层已提示保存失败，继续保留编辑态和草稿。
        });
      }}
    >
      <StudioHeader
        composable={hasGeneratableShot && (modelsLoading || hasVideoModels)}
        composing={composing}
        canvasLabel={canvas?.Name ? `《${canvas.Name}》` : t("本剧集")}
        exportable={hasRenderedShot || hasRenderedCanvasVideo}
        exporting={exporting}
        onBack={() => guard(() => navigate(`/platform/canvas/projects/${projectId}/canvases`))}
        onCompose={() => void handleCompose()}
        onExport={() => void handleExport()}
        onOpenExportHistory={() => setExportHistoryOpen(true)}
        onToggleChat={() => setChatOpen((open) => !open)}
        onViewChange={(next) => guard(() => handleViewChange(next))}
        chatOpen={chatOpen}
        shotCount={formalShotCount}
        title={canvas?.Name || t("剧集创作")}
      />

      {!modelsLoading && (!hasVideoModels || !hasStoryboardModels) ? (
        <div
          className={`bg-[color:oklch(0.987 0.022 95.277)] px-6 py-2 text-[13px] text-[color:oklch(0.555 0.163 48.998)] ${
            view === "canvas" ? "absolute inset-x-0 top-[48px] z-20" : "shrink-0"
          }`}
        >
          {!hasVideoModels
            ? t("当前工作空间暂无可用视频模型，请先在管理端配置并启用视频模型。")
            : t("当前工作空间暂无可用分镜推理模型，批量创建分镜暂不可用，请先在管理端配置并启用文本模型。")}
        </div>
      ) : null}

      <ExportHistoryDrawer
        canvasId={canvasId}
        onClose={() => setExportHistoryOpen(false)}
        projectId={projectId}
        visible={exportHistoryOpen}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1">
          <div
            aria-hidden={!assetsOpen}
            className={`box-border flex min-h-0 shrink-0 flex-col overflow-hidden bg-white transition-[width] duration-300 ease-in-out ${
              view === "canvas" ? "absolute inset-y-0 left-0 z-10" : "relative"
            } ${assetsOpen ? "w-[300px]" : "w-0 pointer-events-none"}`}
          >
            <div
              className={`box-border flex w-[300px] min-w-[300px] min-h-0 flex-1 shrink-0 flex-col bg-white ${
                view === "canvas" ? "pt-[48px]" : ""
              }`}
            >
              <StudioAssetPanel
                canvasNodes={canvasPanelNodes}
                onLocateNode={view === "canvas" ? (nodeId) => canvasBoardRef.current?.locateNode(nodeId) : undefined}
                onReview={reviewMentionAsset}
                projectId={projectId}
              />
            </div>
          </div>

          <div className="absolute bottom-2 left-[10px] z-10 flex h-10 w-10 items-center justify-center">
            <Tooltip content={t(assetsOpen ? "折叠项目资产" : "展开项目资产")} position="top">
              <button
                aria-label={t(assetsOpen ? "折叠项目资产" : "展开项目资产")}
                className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-[8px] border-0 ${
                  assetsOpen
                    ? "bg-[transparent]"
                    : "bg-[color-mix(in_srgb,#f6f6f6_70%,transparent)] backdrop-blur-[16px]"
                }`}
                onClick={() => setAssetsOpen((open) => !open)}
                type="button"
              >
                {assetsOpen ? (
                  <PanelLeftClose aria-hidden className="h-4 w-4" strokeWidth={1.5} />
                ) : (
                  <PanelLeftOpen aria-hidden className="h-4 w-4" strokeWidth={1.5} />
                )}
              </button>
            </Tooltip>
          </div>

          <div className="relative flex min-w-0 min-h-0 flex-1 flex-col">
            {studioReady ? (
              <div
                aria-hidden={view !== "canvas"}
                className={`flex min-w-0 min-h-0 flex-1 ${
                  view === "canvas" ? "" : "absolute inset-0 opacity-0 pointer-events-none"
                }`}
              >
                <CanvasBoard
                  nodePubSub={nodePubSub}
                  onDeleteStoryboardDraft={async (nodeId) => {
                    try {
                      await mutationCoordinator.enqueue(() => cancelCanvasNodeDrafts(projectId, canvasId, nodeId));
                      await refreshCanvasGraph();
                      if (storyboardTaskRunId === nodeId) resetStoryboardFlow();
                      return true;
                    } catch {
                      return false;
                    }
                  }}
                  onOpenStoryboardDraft={(nodeId) => {
                    const task = shots.find((shot) => shot.storyboardTaskRunId === nodeId);
                    if (task) openStoryboardTask(task);
                  }}
                  onRefreshGraph={refreshCanvasGraph}
                  ref={canvasBoardRef}
                  statePubSub={statePubSub}
                />
              </div>
            ) : null}

            {!studioReady ? (
              <div className="flex h-full items-center justify-center">
                <Spin size={28} />
              </div>
            ) : view === "canvas" ? null : (
              <>
                <div className="relative flex min-h-0 flex-1">
                  <section
                    className="flex min-w-0 flex-1 flex-col overflow-hidden py-3 pl-5 pr-3"
                    ref={storyboardEditorRegionRef}
                  >
                    {loading ? (
                      <div className="flex min-h-0 flex-1 items-center justify-center">
                        <Spin size={32} />
                      </div>
                    ) : shots.length === 0 ? (
                      <EmptyStoryboard
                        batchDisabled={!modelsLoading && (!hasVideoModels || !hasStoryboardModels)}
                        createDisabled={!modelsLoading && !hasVideoModels}
                        onCreate={() => handleAddShot(0, "single")}
                        onCreateBatch={() => handleAddShot(0, "batch")}
                      />
                    ) : (
                      <>
                        <div className="flex shrink-0 items-center justify-between gap-6">
                          {selectedIndex >= 0 && currentShot ? (
                            <ShotTitle
                              disabled={saving || creating || Boolean(currentShot.storyboardTaskRunId)}
                              index={selectedIndex}
                              name={currentShot.name}
                              onRename={renameShot}
                              shotId={currentShot.id}
                            />
                          ) : (
                            <CEllipsis
                              className="m-0 shrink-0 truncate text-[20px] font-medium leading-7 text-foreground"
                              maxWidth={200}
                            >
                              {t("分镜脚本")}
                            </CEllipsis>
                          )}
                          <StoryboardToolbar
                            dirty={dirty}
                            matching={materialMatching.matching}
                            editable={Boolean(editable && !generating)}
                            editing={editing}
                            generateDisabled={!hasCurrentScript || (!modelsLoading && !hasVideoModels)}
                            generating={Boolean(generating)}
                            modelOptions={videoModels}
                            saving={saving}
                            onCancel={() => {
                              void discardDraft().catch(() => undefined);
                            }}
                            onChange={handleSettingsChange}
                            onEdit={beginEditing}
                            onSettingsEdit={beginEditing}
                            onGenerate={handleGenerate}
                            onVideoInputModeChange={handleVideoInputModeChange}
                            onSave={saveDraft}
                            settings={settings}
                            videoInputMode={videoInputMode}
                          />
                        </div>

                        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
                          <AssetStrip
                            addAssetToLibrary={addMentionAssetToLibrary}
                            editable={assetsEditable && !materialMatching.matching}
                            interactionDisabled={materialMatching.matching}
                            statsPrefix={
                              videoInputMode !== canvasnode.CanvasVideoInputMode.FIRST_LAST_FRAME ? (
                                <MaterialMatchButton
                                  empty={!hasCurrentScript}
                                  disabled={!editable || saving || Boolean(generating)}
                                  matching={materialMatching.matching}
                                  cancelling={materialMatching.cancelling}
                                  onCancel={() => {
                                    void materialMatching.cancel(projectId, canvasId);
                                  }}
                                  onMatch={() => {
                                    if (!currentShot || saving) return;
                                    void materialMatching.run(projectId, canvasId, async () => {
                                      if (editing) await finishEditing();
                                    });
                                  }}
                                />
                              ) : undefined
                            }
                            assetLimits={modelAssetLimits}
                            assets={stripAssets}
                            onRemove={handleRemoveAsset}
                            onSwapFrames={handleSwapFrameAssets}
                            onUpload={handleUpload}
                            reviewAsset={reviewMentionAsset}
                            reserveEmptySpace
                            videoInputMode={videoInputMode}
                          />
                          <div
                            {...(materialMatching.matching ? { inert: "" } : {})}
                            style={
                              materialMatching.matching
                                ? {
                                    opacity: 0.3,
                                    pointerEvents: "none",
                                    flex: 1,
                                    minHeight: 0,
                                  }
                                : { display: "contents" }
                            }
                          >
                            <ScriptEditorActivationRegion
                              editable={Boolean(!editing && editable && !materialMatching.matching)}
                              onEdit={beginEditing}
                            >
                              <ScriptEditor
                                addAssetToLibrary={addMentionAssetToLibrary}
                                editable={Boolean(editing && editable && !materialMatching.matching)}
                                key={selectedShotId}
                                locked={Boolean(generating || materialMatching.matching)}
                                onChange={(value) => {
                                  setDraftScript(value);
                                  if (editing) {
                                    setDirty(true);
                                  }
                                }}
                                queryTree={queryMentionAssets}
                                reviewAsset={reviewMentionAsset}
                                selectAsset={selectMentionAssetWithFeedback}
                                script={editorScript}
                              />
                            </ScriptEditorActivationRegion>
                          </div>
                        </div>
                      </>
                    )}
                  </section>

                  <PreviewPanel
                    cancelDisabled={isVideoGenerationCancellationDisabled(
                      videoProviderStatusForRun(
                        canvasGenerationRuntimeStates,
                        previewShot?.id,
                        previewShot?.activeGenerationRunId,
                      ),
                    )}
                    generatable={Boolean(editable && !editing && hasCurrentScript && (modelsLoading || hasVideoModels))}
                    onEnded={handlePlaybackEnded}
                    nextVideoUrl={playMode === "canvas" && playing ? nextPlaybackShot?.videoUrl : undefined}
                    onGenerate={handleGenerate}
                    onOpenHistory={() => setHistoryOpen(true)}
                    onPause={() => setPlaying(false)}
                    onPlay={() => {
                      if (previewShot?.status !== "ready" || !previewShot.videoUrl) {
                        return;
                      }
                      if (!playingShotId) {
                        setPlayMode("shot");
                        setPlayingShotId(previewShot.id);
                      }
                      setPlaying(true);
                    }}
                    onPlayAll={handlePlayAll}
                    onStopGenerate={handleStopGenerate}
                    playAllEnabled={hasPlayableShot && !editing}
                    playing={playing}
                    shot={previewShot}
                    stoppingGeneration={stoppingGenerationShotId === previewShot?.id}
                  />
                </div>

                <ScriptDesignDialog
                  initialPlot={storyboardPlot}
                  initialSettings={storyboardBatchSettings}
                  initialStoryboardModel={storyboardInferenceModelId}
                  initialShotDuration={storyboardShotDuration}
                  initialVideoDuration={storyboardVideoDuration}
                  modelOptions={videoModels}
                  onCancel={resetStoryboardFlow}
                  onSubmit={handleScriptDesignSubmit}
                  storyboardModelOptions={storyboardModels}
                  visible={storyboardStep === "design"}
                />

                <StoryboardPreviewDialog
                  confirming={previewConfirming}
                  generating={previewGenerating}
                  onAdopt={handleStoryboardAdopt}
                  onDiscard={handleStoryboardDiscard}
                  onMinimize={handleStoryboardMinimize}
                  onTerminate={handleStoryboardTerminate}
                  shots={previewShots}
                  status={storyboardDraftStatus}
                  visible={storyboardStep === "preview"}
                />

                <GenerationHistoryDialog
                  currentHistoryId={currentShot?.selectedOutputId}
                  canvasId={canvasId}
                  canvasTitle={currentShot?.name}
                  onCancel={() => setHistoryOpen(false)}
                  onSelectHistory={handleSelectHistory}
                  projectId={projectId}
                  canvasnodeId={currentShot?.id}
                  selecting={historySelecting}
                  shotIndex={Math.max(0, selectedIndex)}
                  visible={historyOpen}
                />
              </>
            )}

            {reviewRequest ? (
              <AssetReviewDialog
                error={reviewRequest.error}
                items={[
                  {
                    assetId: reviewRequest.upload ? undefined : (reviewRequest.item.assetId ?? reviewRequest.item.id),
                    review: reviewRequest.item.review,
                    upload: reviewRequest.upload,
                  },
                ]}
                loading={reviewRequest.loading}
                materialName={reviewRequest.item.category === "audio" ? t("音频素材") : t("形象素材")}
                onClose={() => {
                  reviewRequestIDRef.current += 1;
                  setReviewRequest(undefined);
                }}
                onPartialSuccess={applyReviewResults}
                onRetry={() => {
                  void prepareReviewRequest(reviewRequest.shotId, reviewRequest.item, reviewRequest.onUpdated);
                }}
                onSuccess={(results) => {
                  applyReviewResults(results);
                  reviewRequestIDRef.current += 1;
                  setReviewRequest(undefined);
                }}
                projectId={projectId}
                visible
              />
            ) : null}
          </div>

          {view === "canvas" && chatOpen ? (
            <aside
              aria-label={t("画布 AI 助手")}
              className={`z-20 min-h-0 shrink-0 overflow-hidden bg-white ${
                view === "canvas" ? "absolute inset-y-0 right-0" : "relative"
              }`}
              style={{ width: chatWidth }}
            >
              <div
                aria-label={t("调整 AI 助手面板宽度")}
                aria-orientation="vertical"
                aria-valuemax={CHAT_PANEL_MAX_WIDTH}
                aria-valuemin={CHAT_PANEL_MIN_WIDTH}
                aria-valuenow={Math.round(chatWidth)}
                className="group absolute inset-y-0 left-0 z-10 flex w-1 -translate-x-1/2 touch-none select-none justify-center cursor-col-resize outline-none"
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const targetWidth = chatWidth + (event.key === "ArrowLeft" ? 16 : -16);
                  if (targetWidth < CHAT_PANEL_MIN_WIDTH) {
                    setChatOpen(false);
                    return;
                  }
                  setChatWidth(Math.min(CHAT_PANEL_MAX_WIDTH, targetWidth));
                }}
                onPointerDown={handleChatResizeStart}
                role="separator"
                tabIndex={0}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none h-full shrink-0 transition-[width,background-color] duration-150 ${
                    chatResizing
                      ? "w-1 bg-ring"
                      : "w-px bg-border/80 group-hover:w-1 group-hover:bg-ring group-focus:w-1 group-focus:bg-ring"
                  }`}
                />
              </div>
              <CanvasConversation
                projectId={projectId}
                canvasId={canvasId}
                onChange={() => {
                  void refreshCanvasGraph();
                }}
              />
            </aside>
          ) : null}
        </div>

        {studioReady && view === "storyboard" ? (
          <ShotTimeline
            addDisabled={creating || (!modelsLoading && !hasVideoModels)}
            adding={creating}
            deleteDisabledReason={editing ? t("编辑中无法删除") : undefined}
            disabled={saving || creating}
            onAdd={(index, mode) => guard(() => handleAddShot(index, mode))}
            onRemove={handleRemoveShot}
            onReorder={(orderedIds) => void handleReorderShots(orderedIds)}
            onSelect={(id) => {
              if (id !== selectedShotId) {
                guard(() => openShot(id));
              }
            }}
            playingId={playing ? playingShotId : undefined}
            selectedId={selectedShotId}
            shots={shots}
          />
        ) : null}
      </div>
    </main>
  );
}
