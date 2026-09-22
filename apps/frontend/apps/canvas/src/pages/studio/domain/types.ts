import {
  DEFAULT_GENERATION_SETTINGS,
  type GenerationSettings,
} from "@/components/GenerationConfiguration/videoModelConfig";
import type { AssetMentionCategory, MentionReferenceType } from "@/components/promptEditor";
import type { asset, canvasnode } from "@/domain";

export type StoryboardSettings = GenerationSettings;
export const DEFAULT_SETTINGS = DEFAULT_GENERATION_SETTINGS;

export type StudioView = "canvas" | "storyboard";
export const DEFAULT_STUDIO_VIEW: StudioView = "storyboard";

export type AssetCategory = "image" | "video" | "audio";

/** 本地导入资产的后台同步阶段；服务端已绑定的资产视为 ready（可省略）。 */
export type AssetSyncStatus = "uploading" | "uploaded" | "creatingAsset" | "attaching" | "ready" | "failed";

export interface StoryboardAsset {
  /** 编辑器 mention 的事实身份；素材落图后为 CanvasNodeID。 */
  id: string;
  /** 唯一活动引用身份类型。 */
  referenceType?: MentionReferenceType;
  /** 独立上传素材的稳定 AssetID。 */
  assetId?: string;
  /** 图片项目资产叶子的稳定 ResourceAssetID。 */
  resourceAssetId?: string;
  canvasNodeId?: string;
  category: AssetMentionCategory;
  title: string;
  description: string;
  thumbnail?: string;
  /** 图片原图与音视频的可播放地址，提及面板的预览播放器要用。 */
  previewUrl?: string;
  /** 后台同步失败时用于条上提示；正常上传不展示阻塞 Spin。 */
  uploading?: boolean;
  syncStatus?: AssetSyncStatus;
  /** 失败重试用的本地文件。 */
  pendingFile?: File;
  /** 已直传 artifact storage、尚未绑定分镜的临时文件。关页不保存时不会落绑定。 */
  blobId?: string;
  /**
   * 本地 draft id。后台切到 AssetID 后短暂保留，供 mention 双键查找。
   */
  draftId?: string;
  source?: "canvasnode" | "project";
  resourceType?: "character" | "scene" | "prop" | "audio";
  /** 音频项目资产的 ResourceID；节点据此动态跟随 primary 素材。 */
  resourceId?: string;
  review?: asset.AssetReview;
  /** 同一素材在多个权益包下的审核投影。 */
  reviews?: asset.AssetReview[];
  /** 当前素材连接到视频节点的输入端口。 */
  targetPort?: canvasnode.CanvasPort;
}

/** failed 是最近一次生成尝试失败；节点已选中的旧结果仍单独保留。 */
export type ShotStatus = "empty" | "ready" | "generating" | "failed";

export interface CanvasGenerationFailure {
  taskRunId?: string;
  errorCode?: string;
  requestId?: string;
  errorMessage?: string;
  seedanceTaskId?: string;
}

export interface Shot {
  id: string;
  /** 正式分镜直接展示对应画布节点名称。 */
  name?: string;
  revision?: number;
  /** 正式分镜占位项在 GetCanvasNode 返回前为 false，避免用默认值产生覆盖写。 */
  detailLoaded?: boolean;
  /** 服务端统一时间线状态；草稿任务与正式分镜共用同一 items 数组。 */
  timelineStatus: "creating" | "generating" | "pending-confirmation" | "completed" | "failed";
  /** 草稿任务的稳定身份；点击时统一通过 Fetch SSE 查询最新 DB 状态。 */
  storyboardTaskRunId?: string;
  /** 仅用于未持久化分镜草稿按模型给出的镜号稳定排序。 */
  draftCanvasNodeNo?: number;
  /** 未确认草稿 Prompt 中的结构化项目资产引用。 */
  assetReferences?: StoryboardAsset[];
  /** 单分镜创建请求期间的纯 UI 乐观项。 */
  optimisticCreate?: boolean;
  /** 单分镜创建请求返回前用于时间轴定位；不是正式 CanvasNode 事实。 */
  optimisticAfterNodeId?: string;
  duration: string;
  status: ShotStatus;
  script: string;
  settings: StoryboardSettings;
  thumbnail?: string;
  /** 视频生成完成后服务端返回的可播放地址。 */
  videoUrl?: string;
  /** 当前选中视频的首帧 Asset，用于分镜卡片缩略图。 */
  firstFrameAssetId?: string;
  /** 当前选中视频的首帧临时签名地址。 */
  firstFrameUrl?: string;
  /** 列表已批量尝试换取首帧地址，避免卡片再次逐项请求。 */
  firstFramePreviewResolved?: boolean;
  /** 服务端持久化的当前生成 RunID，用于刷新页面后恢复轮询与取消。 */
  activeGenerationRunId?: string;
  /** 服务端持久化的当前选中生成历史 ID。 */
  selectedOutputId?: string;
  /** 最近一次生成尝试的失败原因，不覆盖当前已选中的历史结果。 */
  generationErrorCode?: string;
  generationErrorMessage?: string;
  /** Canvas 内部失败使用 TaskRunID 作为跨请求、轮询与日志的追踪标识。 */
  generationRequestId?: string;
  /** 仅 Seedance 返回失败终态时存在。 */
  generationSeedanceTaskId?: string;
  videoInputMode?: canvasnode.CanvasVideoInputMode;
}

export type GenerationHistoryStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface GenerationHistoryItem {
  id: string;
  shotId: string;
  status: GenerationHistoryStatus;
  model: string;
  /** 生成节点类型；历史记录始终归属于同类型生成节点。 */
  type?: canvasnode.CanvasNodeType;
  resolution: string;
  duration: string;
  script: string;
  outputText?: string;
  videoUrl?: string;
  outputAssetId?: string;
  /** 生成视频的首帧 Asset，用于列表缩略图。 */
  firstFrameAssetId?: string;
  /** 生成视频的首帧临时签名地址。 */
  firstFrameUrl?: string;
  /** 生成视频的尾帧 Asset，当前仅保留供后续展示场景使用。 */
  lastFrameAssetId?: string;
  /** 生成视频的尾帧临时签名地址。 */
  lastFrameUrl?: string;
  completedAt?: number;
  createdAt: number;
  errorCode?: string;
  errorMessage?: string;
  /** 仅 Seedance 返回失败终态时存在。 */
  seedanceTaskId?: string;
}

/** shot 只循环当前分镜；canvas 按时间轴顺序连播整集。 */
export type PlayMode = "shot" | "canvas";

export const ASSET_ACCEPT: Record<AssetCategory, string> = {
  image: ".jpeg,.jpg,.png,.webp,.bmp,.tiff,.gif,.heic,.heif",
  video: ".mp4,.mov",
  audio: ".wav,.mp3",
};
