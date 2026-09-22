// Source presentation model retained for the imported UI. Network calls use @repo/api OpenAPI clients.

import {
  CanvasGenerationStatus,
  CanvasNodeAspectRatio,
  CanvasNodeDraftStatus,
  CanvasNodeMediaType,
  CanvasNodeMentionReferenceType,
  CanvasNodeReferenceStatus,
  CanvasNodeResolution,
  CanvasNodeStatus,
  CanvasNodeTaskType,
  CanvasNodeType,
  CanvasNodeVideoProviderStatus,
  CanvasPort,
  CanvasVideoInputMode,
} from "@repo/api";

import type * as asset from "./asset";
import type * as resource from "./resource";

export {
  CanvasGenerationStatus,
  CanvasNodeAspectRatio,
  CanvasNodeDraftStatus,
  CanvasNodeMediaType,
  CanvasNodeMentionReferenceType,
  CanvasNodeReferenceStatus,
  CanvasNodeResolution,
  CanvasNodeStatus,
  CanvasNodeTaskType,
  CanvasNodeType,
  CanvasNodeVideoProviderStatus,
  CanvasPort,
  CanvasVideoInputMode,
};

export type Int64 = number;

export interface BatchDeleteCanvasNodesRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  /** NodeIDs 最多包含 100 个互不重复的节点标识。 */
  NodeIDs: Array<string>;
}

export interface BatchDeleteCanvasNodesResponse {
  CanvasRevision: Int64;
}

export interface BatchGetCanvasNodeStatesRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  Targets: Array<CanvasNodeStateTarget>;
}

export interface BatchGetCanvasNodeStatesResponse {
  Items: Array<CanvasNodeState>;
  /** Canvas 适配层用于同步图级乐观锁；AgentFrame 原服务使用节点级 Revision。 */
  CanvasRevision?: number;
}

export interface BatchUpdateCanvasNodePositionsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  Items: Array<CanvasNodePositionUpdate>;
}

export interface BatchUpdateCanvasNodePositionsResponse {
  Items: Array<CanvasNode>;
}

export interface CancelCanvasNodeAssetsMatchRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  NodeID: string;
  TaskRunID: string;
}

export interface CancelCanvasNodeDraftsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  TaskRunID: string;
}

export interface CancelCanvasNodeGenerationRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  NodeID: string;
  TaskRunID: string;
}

export interface CancelCanvasNodeTextGenerationRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  NodeID: string;
  TaskRunID: string;
}

export interface CanvasEdge {
  EdgeID: string;
  SourceNodeID: string;
  SourcePort: CanvasPort;
  TargetPort: CanvasPort;
  TargetOrder: number;
}

/** CanvasNode 描述项目剧集下的一个稳定分镜。 */
export interface CanvasNode {
  /** NodeID 是分镜稳定标识。 */
  NodeID: string;
  /** CanvasID 是分镜所属剧集标识。 */
  CanvasID: string;
  /** CanvasNodeNo 是按当前顺序派生的连续展示序号。 */
  CanvasNodeNo: number;
  /** Prompt 是当前分镜的提示词。 */
  Prompt: string;
  /** GenerationConfig 是当前分镜保存的完整生成配置。 */
  GenerationConfig?: CanvasNodeGenerationConfig;
  /** Status 是当前分镜生成结果的展示状态。 */
  Status: CanvasNodeStatus;
  /** SelectedOutputID 是当前内容来自本节点生成历史时对应的 TaskRunID；复制得到的当前内容没有该字段。 */
  SelectedOutputID?: string;
  /** SelectedAssetID 是当前选中的生成结果 Asset 标识。 */
  SelectedAssetID?: string;
  /** CreatedAt 是分镜创建时间。 */
  CreatedAt: string;
  /** UpdatedAt 是分镜最后更新时间。 */
  UpdatedAt: string;
  /** CreatedBy 是分镜创建用户 ID。 */
  CreatedBy: string;
  /** UpdatedBy 是最后一次创建、更新或删除分镜的用户 ID。 */
  UpdatedBy: string;
  /** ActiveTaskRunID 是当前进行中的 TaskRun 标识；调用方据此在重新进入页面后恢复状态订阅与取消。 */
  ActiveTaskRunID?: string;
  /** FirstFrameAssetID 是当前选中生成输出的首帧 Asset 标识。 */
  FirstFrameAssetID?: string;
  /** SelectedOutputDurationSeconds 是当前选中生成输出的实际时长，单位为秒。 */
  SelectedOutputDurationSeconds?: number;
  /** FirstFrameURL 是当前选中生成输出的首帧临时签名地址；签名失败时可为空。 */
  FirstFrameURL?: string;
  /** SelectedOutputURL 是当前选中视频 Asset 的临时签名地址；签名失败时可为空。 */
  SelectedOutputURL?: string;
  Type: CanvasNodeType;
  Name: string;
  Position: CanvasNodePosition;
  StoryboardRank?: Int64;
  Text?: string;
  /** AssetID 仅用于直接上传到画布、没有项目 Resource 的独立素材。 */
  AssetID?: string;
  VideoInputMode?: CanvasVideoInputMode;
  IncomingEdges: Array<CanvasEdge>;
  Revision: Int64;
  /** ResourceAssetID 是项目资产节点的唯一引用事实；读取和生成时始终解析其最新 CurrentAssetID。 */
  ResourceAssetID?: string;
  /** CurrentAssetID 是 ResourceAssetID 在本次读取时解析到的最新 Asset，仅用于渲染，不是持久化引用事实。 */
  CurrentAssetID?: string;
  /** ResourceAssetRevision 是本次读取时的 ResourceAsset 版本，仅用于展示和诊断。 */
  ResourceAssetRevision?: Int64;
  SelectedOutputText?: string;
  /** LastFrameAssetID 是当前选中生成输出的尾帧 Asset 标识。 */
  LastFrameAssetID?: string;
  /** ResourceID 是资源级引用事实；读取和生成时解析该 Resource 当时的主 ResourceAsset。 */
  ResourceID?: string;
  /** ResourceAssetIsPrimary 是本次读取时该节点解析到的 ResourceAsset 是否为所属 Resource 的当前主素材。 */
  ResourceAssetIsPrimary?: boolean;
  /** ReferenceType 是素材节点持久化的唯一活动引用身份；非素材节点不设置。 */
  ReferenceType?: CanvasNodeMentionReferenceType;
  /** ReferenceStatus 仅用于 ResourceID/ResourceAssetID 引用；DELETED 时保留节点与 Edge，由用户自行处理。 */
  ReferenceStatus: CanvasNodeReferenceStatus;
  /** PreviewURL 是当前业务引用对应素材的临时展示地址。 */
  PreviewURL?: string;
  /** Reviews 是当前业务引用对应素材的全部有效审核记录，按创建时间升序返回。 */
  Reviews?: Array<asset.AssetReview>;
  /** LatestGenerationFailure 仅在最近一次生成尝试失败时返回；历史面板仍按需调用历史接口。 */
  LatestGenerationFailure?: CanvasNodeGenerationFailure;
  ActiveTaskType?: CanvasNodeTaskType;
}

/** CanvasNodeAssetMentionNode 是 @ 面板直接消费的通用树节点。
 顶层来源分组、项目素材组和素材叶子共用此结构；Children 为空不改变节点语义。 */
export interface CanvasNodeAssetMentionNode {
  ID: string;
  Label: string;
  Children: Array<CanvasNodeAssetMentionNode>;
  URL?: string;
  MediaType?: asset.AssetMediaType;
  Description?: string;
  /** CanvasNodeID 表示该叶子已经是当前画布上的节点；选择时直接建立节点连线。 */
  CanvasNodeID?: string;
  /** AssetID 是素材节点或生成节点当前输出对应的底层素材；项目资产叶子也使用该字段。 */
  AssetID?: string;
  /** NodeType 仅在画布节点叶子上返回，用于前端区分文本与媒体输出。 */
  NodeType?: CanvasNodeType;
  /** ResourceAssetID 是项目资产叶子的稳定身份；选择后画布节点始终解析其最新 CurrentAssetID。 */
  ResourceAssetID?: string;
  /** Reviews 按审核创建时间升序返回素材的全部当前有效记录。 */
  Reviews?: Array<asset.AssetReview>;
  /** ResourceID 表示项目资源级叶子；选择后画布节点动态解析该 Resource 的主素材。 */
  ResourceID?: string;
  /** ReferenceType 是该叶子的唯一活动引用身份类型；分组节点不设置。 */
  ReferenceType?: CanvasNodeMentionReferenceType;
  /** ResourceType 仅用于项目资产缺省封面展示，不参与引用身份判断。 */
  ResourceType?: resource.ResourceType;
  /** 项目素材槽位始终可见；Available=false 时禁止确认消费，不能以 URL 是否存在推断。 */
  Available?: boolean;
  /** 来自生成草稿的活动任务；用于区分生成中与暂无可用产物。 */
  Generating?: boolean;
}

/** CanvasNodeDraft 是 SSE 与待确认详情返回、尚未转为正式 CanvasNode 的候选分镜。 */
export interface CanvasNodeDraft {
  DraftID: string;
  CanvasNodeNo: number;
  /** Prompt 在草稿预览阶段保持纯文本；确认创建正式节点时才由服务端插入素材 mention。 */
  Prompt: string;
  /** DurationSeconds 是分镜规划结果；其余视频生成参数由本次批量任务的 ModelConfig 固定。 */
  DurationSeconds: number;
  AssetReferences: Array<CanvasNodeDraftAssetReference>;
}

/** CanvasNodeDraftAssetReference 是草稿 Prompt 的结构化素材引用；草稿 Prompt 自身保持纯文本。
 ResourceAssetID 用于确认时绑定项目素材；AssetID 用于读取当前审核和预览信息。 */
export interface CanvasNodeDraftAssetReference {
  ResourceAssetID: string;
  AssetID?: string;
  Label?: string;
  MediaType?: asset.AssetMediaType;
  TargetField: string;
  AnchorText: string;
}

/** CanvasNodeDraftConfirmInput 只允许覆盖已持久化草稿的生成参数；Prompt 始终取自服务端草稿记录。 */
export interface CanvasNodeDraftConfirmInput {
  DraftID: string;
  GenerationConfig: CanvasNodeGenerationConfig;
}

/** CanvasNodeDraftSession 是由 TaskRunID 精确选择的一次批量分镜任务详情。 */
export interface CanvasNodeDraftSession {
  TaskRunID: string;
  Plot: string;
  Status: CanvasNodeDraftStatus;
  /** CanvasNodes 在普通列表/Get 恢复已完成任务时一次性返回；SSE session 首事件可以为空。 */
  CanvasNodes?: Array<CanvasNodeDraft>;
  ModelConfig?: StoryboardModelConfig;
  PlanningConfig?: StoryboardPlanningConfig;
}

/** CanvasNodeGenerationConfig 是单个分镜保存的完整生成配置。 */
export interface CanvasNodeGenerationConfig {
  /** ModelServiceID 是生成模型服务的稳定标识。 */
  ModelServiceID: string;
  /** Resolution 是生成输出的分辨率。 */
  Resolution: CanvasNodeResolution;
  /** AspectRatio 是生成输出的画幅比例。 */
  AspectRatio: CanvasNodeAspectRatio;
  /** DurationSeconds 是生成时长；-1 表示自动时长，且仅在模型能力明确支持时有效。 */
  DurationSeconds: number;
  /** GenerateAudio 表示是否同时生成声音。 */
  GenerateAudio: boolean;
  /** Watermark 表示是否在生成结果中保留水印。 */
  Watermark: boolean;
}

/** CanvasNodeGenerationConfigPatch 是分镜生成配置的按需更新内容；未传字段保持原值。 */
export interface CanvasNodeGenerationConfigPatch {
  /** ModelServiceID 更新生成模型服务的稳定标识。 */
  ModelServiceID?: string;
  /** Resolution 更新生成输出的分辨率。 */
  Resolution?: CanvasNodeResolution;
  /** AspectRatio 更新生成输出的画幅比例。 */
  AspectRatio?: CanvasNodeAspectRatio;
  /** DurationSeconds 更新生成时长；-1 表示自动时长，且仅在模型能力明确支持时有效。 */
  DurationSeconds?: number;
  /** GenerateAudio 更新是否同时生成声音。 */
  GenerateAudio?: boolean;
  /** Watermark 更新是否在生成结果中保留水印。 */
  Watermark?: boolean;
}

/** CanvasNodeGenerationFailure 是节点最近一次生成尝试失败时的轻量投影。 */
export interface CanvasNodeGenerationFailure {
  TaskRunID: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  /** SeedanceTaskID 仅在 Seedance 视频生成失败时存在，供火山侧问题复现与豁免操作使用。 */
  SeedanceTaskID?: string;
}

/** CanvasNodeGenerationResourceAssetSnapshot 只记录某次生成实际解析到的 ResourceAsset 版本与 Asset，
 不参与画布节点的后续读取和生成决策。 */
export interface CanvasNodeGenerationResourceAssetSnapshot {
  SourceNodeID: string;
  ResourceAssetID: string;
  ResourceAssetRevision: Int64;
  AssetID: string;
}

export interface CanvasNodeGenerationStart {
  NodeID: string;
  TaskRunID: string;
}

/** CanvasNodeHistory 是一次文本、图片或视频生成的持久化历史。 */
export interface CanvasNodeHistory {
  /** HistoryID 与对应生成操作的 TaskRunID 相同。 */
  HistoryID: string;
  Status: CanvasGenerationStatus;
  ModelServiceID: string;
  Resolution?: CanvasNodeResolution;
  AspectRatio?: CanvasNodeAspectRatio;
  DurationSeconds?: number;
  GenerateAudio?: boolean;
  Watermark?: boolean;
  /** Prompt 是实际提交给模型的提示词快照。 */
  Prompt: string;
  /** VideoURL 是成功结果的临时签名地址，不持久化。 */
  VideoURL?: string;
  ErrorMessage?: string;
  CompletedAt?: string;
  CreatedAt: string;
  /** ProviderStatus 是该历史最近一次持久化的 provider 状态。 */
  ProviderStatus: CanvasNodeVideoProviderStatus;
  FirstFrameAssetID?: string;
  LastFrameAssetID?: string;
  FirstFrameURL?: string;
  LastFrameURL?: string;
  ResourceAssetSnapshots: Array<CanvasNodeGenerationResourceAssetSnapshot>;
  Type: CanvasNodeType;
  OutputAssetID?: string;
  OutputURL?: string;
  OutputText?: string;
  /** ErrorCode 保留 provider 返回的原始错误码，不做服务端 i18n。 */
  ErrorCode?: string;
  /** SeedanceTaskID 仅在 Seedance 失败终态返回，供火山侧问题复现与豁免操作使用。 */
  SeedanceTaskID?: string;
}

/** CanvasNodePosition 是客户端计算并持久化的画布位置。 */
export interface CanvasNodePosition {
  PositionX: number;
  PositionY: number;
}

export interface CanvasNodePositionUpdate {
  NodeID: string;
  Position: CanvasNodePosition;
}

/** Node 与 RelatedNodes 是已持久化业务数据；匹配与生成使用不同 TaskType。 */
export interface CanvasNodeState {
  NodeID: string;
  TaskRunID: string;
  Status: CanvasGenerationStatus;
  TaskType: CanvasNodeTaskType;
  Node: CanvasNode;
  RelatedNodes: Array<CanvasNode>;
  ErrorCode?: string;
  ErrorMessage?: string;
  SeedanceTaskID?: string;
  VideoProviderStatus?: CanvasNodeVideoProviderStatus;
}

export interface CanvasNodeStateTarget {
  NodeID: string;
  TaskRunID: string;
}

export interface CanvasNodeTextGenerationResponse {
  Session?: CanvasTextGenerationSession;
  Delta?: CanvasTextGenerationDelta;
  Completed?: CanvasTextGenerationCompleted;
}

export interface CanvasTextGenerationCompleted {
  TaskRunID: string;
  Content: string;
}

export interface CanvasTextGenerationDelta {
  Delta: string;
  Offset: Int64;
}

export interface CanvasTextGenerationSession {
  TaskRunID: string;
  NodeID: string;
  Status: CanvasGenerationStatus;
  Content: string;
  ErrorCode?: string;
  ErrorMessage?: string;
}

/** CanvasUploadedAsset 是由节点创建或素材物化直接消费的临时 Blob。 */
export interface CanvasUploadedAsset {
  BlobID: string;
  FileName: string;
}

export interface ConfirmCanvasNodeDraftsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  Items: Array<CanvasNodeDraftConfirmInput>;
  TaskRunID: string;
}

export interface ConfirmCanvasNodeDraftsResponse {
  /** CanvasNodeIDs 只标识本次确认创建的正式分镜；完整图必须通过 GetCanvasGraph 读取。 */
  CanvasNodeIDs: Array<string>;
  CanvasRevision: Int64;
}

export interface ConnectCanvasNodesRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  SourceNodeID: string;
  TargetNodeID: string;
  TargetPort: CanvasPort;
  TargetOrder?: number;
}

export interface ConnectCanvasNodesResponse {
  TargetNode: CanvasNode;
  CanvasRevision: Int64;
}

export interface CopyCanvasNodeRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  SourceNodeID: string;
  Position: CanvasNodePosition;
  /** Name 是滚动升级兼容字段；Server 复制节点时忽略该值并继承源节点的命名模式。 */
  Name?: string;
}

export interface CopyCanvasNodeResponse {
  CanvasNode: CanvasNode;
  CanvasRevision: Int64;
}

export interface CreateCanvasAssetRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  BlobID: string;
  FileName: string;
}

export interface CreateCanvasAssetResponse {
  Asset: asset.Asset;
}

export interface CreateCanvasNodeRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是所属项目标识。 */
  ProjectID: string;
  /** CanvasID 是所属剧集标识。 */
  CanvasID: string;
  /** AfterNodeID 指定插入位置；未传时追加到末尾。 */
  AfterNodeID?: string;
  /** ModelServiceID 是前端从当前环境模型列表选择的视频生成模型服务标识。 */
  ModelServiceID?: string;
  Type: CanvasNodeType;
  /** Name 是滚动升级兼容字段；Server 创建节点时忽略该值并根据节点类型或素材来源确定名称。 */
  Name?: string;
  Position: CanvasNodePosition;
  Text?: string;
  AssetID?: string;
  ResourceAssetID?: string;
  /** ResourceID 创建会持续跟踪 Resource 的主素材；与 AssetID、ResourceAssetID 互斥。 */
  ResourceID?: string;
  /** UploadedAsset 创建 Project Asset 并立即绑定素材节点；与 AssetID、ResourceID、ResourceAssetID 互斥。 */
  UploadedAsset?: CanvasUploadedAsset;
}

export interface CreateCanvasNodeResponse {
  /** CanvasNode 是新创建的分镜。 */
  CanvasNode: CanvasNode;
  CanvasRevision: Int64;
}

/** CreateCanvasNodesCompleted 是 SSE completed 事件的数据。 */
export interface CreateCanvasNodesCompleted {
  Count: number;
}

/** CreateCanvasNodesError 是 SSE error 事件的安全错误数据。 */
export interface CreateCanvasNodesError {
  Code: string;
  Message: string;
}

export interface CreateCanvasNodesRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  Plot: string;
  /** MaxCanvasNodes 保留用于滚动发布兼容；新任务的分镜数量由剧情自然节拍决定，客户端值会被忽略。 */
  MaxCanvasNodes?: number;
  ModelConfig: StoryboardModelConfig;
  PlanningConfig: StoryboardPlanningConfig;
}

export interface CreateCanvasNodesResponse {
  CanvasNode?: CanvasNodeDraft;
  Completed?: CreateCanvasNodesCompleted;
  Error?: CreateCanvasNodesError;
  Session?: CanvasNodeDraftSession;
}

export interface DeleteCanvasEdgeRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  TargetNodeID: string;
  EdgeID: string;
}

export interface DeleteCanvasEdgeResponse {
  TargetNode: CanvasNode;
  CanvasRevision: Int64;
}

export interface DeleteCanvasNodeRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是所属项目标识。 */
  ProjectID: string;
  /** CanvasID 是所属剧集标识。 */
  CanvasID: string;
  /** NodeID 是待删除的分镜标识。 */
  NodeID: string;
}

export interface DeleteCanvasNodeResponse {
  CanvasRevision: Int64;
}

export interface GetCanvasGraphRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
}

export interface GetCanvasGraphResponse {
  Nodes: Array<CanvasNode>;
}

export interface GetCanvasNodeDraftsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  TaskRunID: string;
}

export interface ListCanvasNodeDraftSessionsRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是所属项目标识。 */
  ProjectID: string;
  /** CanvasID 是所属剧集标识。 */
  CanvasID: string;
}

export interface ListCanvasNodeDraftSessionsResponse {
  Items: Array<CanvasNodeDraftSession>;
}

export interface ListCanvasNodeHistoriesRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  NodeID: string;
}

export interface ListCanvasNodeHistoriesResponse {
  Items: Array<CanvasNodeHistory>;
}

export interface MaterializeCanvasResourceAssetReferenceRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  TargetNodeID: string;
  /** ResourceAssetID 固定跟随一个素材槽位；与 ResourceID 必须且只能提供一个。 */
  ResourceAssetID?: string;
  TargetPort: CanvasPort;
  /** ResourceID 动态跟随资源的主素材；当前仅用于音频资源。 */
  ResourceID?: string;
  ResourceAssetNodePosition: CanvasNodePosition;
  /** ReferenceType 显式声明活动引用身份；旧客户端可省略，由 Server 根据唯一 ID 推断。 */
  ReferenceType?: CanvasNodeMentionReferenceType;
}

export interface MaterializeCanvasResourceAssetReferenceResponse {
  ResourceAssetNode: CanvasNode;
  TargetNode: CanvasNode;
  CanvasRevision: Int64;
  CreatedResourceAssetNode: boolean;
}

export interface MaterializeCanvasStandaloneAssetReferenceRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  TargetNodeID: string;
  AssetID?: string;
  TargetPort: CanvasPort;
  /** ReferenceType 新客户端固定传 ASSET；旧客户端可省略。 */
  ReferenceType?: CanvasNodeMentionReferenceType;
  AssetNodePosition: CanvasNodePosition;
  /** UploadedAsset 创建 Project Asset 并在同一业务调用内物化、连接；与 AssetID 互斥。 */
  UploadedAsset?: CanvasUploadedAsset;
}

export interface MaterializeCanvasStandaloneAssetReferenceResponse {
  AssetNode: CanvasNode;
  TargetNode: CanvasNode;
  CanvasRevision: Int64;
  CreatedAssetNode: boolean;
}

export interface ReorderStoryboardNodesRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  Items: Array<StoryboardRankUpdate>;
}

export interface ReorderStoryboardNodesResponse {
  Nodes: Array<CanvasNode>;
  CanvasRevision: Int64;
}

export interface SearchCanvasNodeAssetsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  NodeID: string;
  Keyword?: string;
  Cursor?: string;
  Limit: number;
  MediaTypes?: Array<CanvasNodeMediaType>;
}

export interface SearchCanvasNodeAssetsResponse {
  Items: Array<CanvasNodeAssetMentionNode>;
  NextCursor?: string;
}

export interface SelectCanvasNodeHistoryRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  NodeID: string;
  HistoryID: string;
}

export interface SelectCanvasNodeHistoryResponse {
  History: CanvasNodeHistory;
}

export interface StartCanvasGenerationRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
}

export interface StartCanvasGenerationResponse {
  /** Items 只包含成功启动或已经在运行的分镜；不满足生成条件的分镜由服务端跳过。 */
  Items: Array<CanvasNodeGenerationStart>;
  SkippedCount: number;
}

export interface StartCanvasNodeAssetsMatchRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  NodeID: string;
  Revision: Int64;
}

export interface StartCanvasNodeAssetsMatchResponse {
  TaskRunID: string;
}

export interface StartCanvasNodeGenerationRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  NodeID: string;
}

export interface StartCanvasNodeGenerationResponse {
  TaskRunID: string;
}

export interface StartCanvasNodeTextGenerationRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  NodeID: string;
}

/** StoryboardModelConfig 保存批量分镜任务使用的模型与视频生成参数。
 模型字段为空时使用应用级默认模型；VideoParameters 必须由调用方明确提交。 */
export interface StoryboardModelConfig {
  InferenceModelServiceID?: string;
  VideoModelServiceID?: string;
  VideoParameters: StoryboardVideoParameters;
}

export interface StoryboardPlanningConfig {
  /** 单分镜时长范围必须位于所选视频模型能力内；都不传时默认使用模型的完整能力范围。 */
  CanvasNodeDurationMinSeconds?: number;
  CanvasNodeDurationMaxSeconds?: number;
  /** 总视频时长范围两个字段必须同时传入，取值为 60 至 3000 秒；都不传时保留旧客户端的无目标时长语义。 */
  TotalDurationMinSeconds?: number;
  TotalDurationMaxSeconds?: number;
}

export interface StoryboardRankUpdate {
  NodeID: string;
  StoryboardRank: Int64;
}

/** StoryboardVideoParameters 是批量分镜规划和后续视频生成共同使用的固定参数。 */
export interface StoryboardVideoParameters {
  Resolution: CanvasNodeResolution;
  AspectRatio: CanvasNodeAspectRatio;
  GenerateAudio: boolean;
  Watermark: boolean;
}

export interface UpdateCanvasNodeRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是所属项目标识。 */
  ProjectID: string;
  /** CanvasID 是所属剧集标识。 */
  CanvasID: string;
  /** NodeID 是待更新的分镜标识。 */
  NodeID: string;
  /** Prompt 更新提示词；未传时保持原值，空字符串表示清空提示词。 */
  Prompt?: string;
  /** GenerationConfig 按字段更新生成配置；未传字段保持原值。 */
  GenerationConfig?: CanvasNodeGenerationConfigPatch;
  Name?: string;
  Text?: string;
  Position?: CanvasNodePosition;
  VideoInputMode?: CanvasVideoInputMode;
}

export interface UpdateCanvasNodeResponse {
  /** CanvasNode 是更新后的分镜。 */
  CanvasNode: CanvasNode;
}
/* eslint-enable */
