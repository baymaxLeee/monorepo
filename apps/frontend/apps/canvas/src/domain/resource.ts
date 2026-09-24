// Source presentation model retained for the imported UI. Network calls use @repo/api OpenAPI clients.

import {
  CanvasResourceAssetGenerationAspectRatio as ResourceAssetGenerationAspectRatio,
  CanvasResourceAssetGenerationInputSourceType as ResourceAssetGenerationInputSourceType,
  CanvasResourceAssetGenerationResolution as ResourceAssetGenerationResolution,
  CanvasResourceAssetGenerationRunStatus as ResourceAssetGenerationRunStatus,
  CanvasResourceAssetSourceType as ResourceAssetSourceType,
  CanvasResourceOwnerType as ResourceOwnerType,
  CanvasResourceSortField as ResourceSortField,
  CanvasResourceType as ResourceType,
} from "@repo/api";

import type * as asset from "./asset";
import type * as common from "./common";

export {
  ResourceAssetGenerationAspectRatio,
  ResourceAssetGenerationInputSourceType,
  ResourceAssetGenerationResolution,
  ResourceAssetGenerationRunStatus,
  ResourceAssetSourceType,
  ResourceOwnerType,
  ResourceSortField,
  ResourceType,
};

export type Int64 = number;

export interface BatchDeleteResourceAssetsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  Targets: Array<DeleteResourceAssetTarget>;
}

export interface BatchDeleteResourcesRequest {
  WorkspaceID?: string;
  ProjectID: string;
  Targets: Array<DeleteResourceTarget>;
}

export interface BatchGetResourceAssetGenerationStatesRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  /** ResourceAssetIDs 接受 1 至 100 个资源素材 ID；重复 ID 按首次出现位置去重。 */
  ResourceAssetIDs: Array<string>;
}

export interface BatchGetResourceAssetGenerationStatesResponse {
  /** Items 按 ResourceAssetIDs 首次出现的顺序返回；不存在、不可见、非生成型或尚无运行的素材不返回。 */
  Items: Array<ResourceAssetGenerationState>;
}

export interface BatchGetResourcesRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceIDs: Array<string>;
}

export interface BatchGetResourcesResponse {
  Items: Array<Resource>;
}

export interface BatchListResourceAssetsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceIDs: Array<string>;
}

export interface BatchListResourceAssetsResponse {
  Groups: Array<ResourceAssetGroup>;
}

export interface CancelResourceAssetGenerationRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  ResourceAssetID: string;
  TaskRunID: string;
}

export interface CanvasNodeResourceAssetBinding {
  CanvasID: string;
  CanvasNodeID: string;
  ResourceAssetID: string;
  CurrentAssetID: string;
  CanvasNodeRevision: Int64;
}

export interface CreateGeneratedResourceAssetRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  ExpectedResourceRevision: Int64;
}

export interface CreateGeneratedResourceAssetResponse {
  ResourceAsset: ResourceAsset;
}

export interface CreateResourceAssetRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  AssetID?: string;
  Name?: string;
  ExpectedResourceRevision: Int64;
  SourceAssetID?: string;
  SourceRevisionID?: string;
  FileName?: string;
}

export interface CreateResourceAssetResponse {
  ResourceAsset: ResourceAsset;
}

export interface CreateResourceFromAssetRequest {
  WorkspaceID?: string;
  ProjectID: string;
  AssetID: string;
  Type: ResourceType;
  Name: string;
  Description?: string;
  CanvasID?: string;
  CanvasNodeID?: string;
}

export interface CreateResourceFromAssetResponse {
  Resource: Resource;
  ResourceAsset: ResourceAsset;
  CanvasNodeBinding?: CanvasNodeResourceAssetBinding;
}

export interface CreateResourceInitialAsset {
  SourceAssetID: string;
  SourceRevisionID: string;
  FileName: string;
  Name?: string;
}

export interface CreateResourceRequest {
  WorkspaceID?: string;
  ProjectID: string;
  Type: ResourceType;
  Name: string;
  Description?: string;
  InitialAssets?: Array<CreateResourceInitialAsset>;
}

export interface CreateResourceResponse {
  Resource: Resource;
  ResourceAssets: Array<ResourceAsset>;
}

export interface DeleteResourceAssetRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  ResourceAssetID: string;
  ExpectedResourceRevision: Int64;
  ExpectedResourceAssetRevision: Int64;
}

export interface DeleteResourceAssetTarget {
  ResourceAssetID: string;
  ExpectedResourceRevision: Int64;
  ExpectedResourceAssetRevision: Int64;
}

export interface DeleteResourceRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  ExpectedRevision: Int64;
}

export interface DeleteResourceTarget {
  ResourceID: string;
  ExpectedRevision: Int64;
}

export interface GetProjectResourceStatsRequest {
  WorkspaceID?: string;
  ProjectID: string;
}

export interface GetProjectResourceStatsResponse {
  Stats: ProjectResourceStats;
}

export interface GetResourceAssetGenerationRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  ResourceAssetID: string;
}

export interface GetResourceAssetGenerationResponse {
  Generation: ResourceAssetGeneration;
}

export interface GetResourceAssetGenerationRunRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  ResourceAssetID: string;
  TaskRunID: string;
}

export interface GetResourceAssetGenerationRunResponse {
  Run: ResourceAssetGenerationRun;
}

export interface GetResourceRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
}

export interface GetResourceResponse {
  Resource: Resource;
}

export interface ListResourceAssetsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  Page: common.Page;
}

export interface ListResourceAssetsResponse {
  Items: Array<ResourceAsset>;
  Page: common.PageOutput;
}

export interface ListResourcesRequest {
  WorkspaceID?: string;
  ProjectID: string;
  Type?: ResourceType;
  Keyword?: string;
  Sort?: ResourceSort;
  Page: common.Page;
}

export interface ListResourcesResponse {
  Items: Array<Resource>;
  Page: common.PageOutput;
}

export interface ProjectResourceStats {
  CharacterCount: number;
  SceneCount: number;
  PropCount: number;
  AudioCount: number;
}

export interface ReplaceUploadedResourceAssetRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  ResourceAssetID: string;
  SourceAssetID: string;
  SourceRevisionID: string;
  FileName: string;
  ExpectedResourceRevision: Int64;
  ExpectedResourceAssetRevision: Int64;
}

export interface ReplaceUploadedResourceAssetResponse {
  ResourceAsset: ResourceAsset;
}

export interface Resource {
  ResourceID: string;
  ProjectID: string;
  Type: ResourceType;
  Name: string;
  Description: string;
  PrimaryResourceAsset?: ResourceAssetSummary;
  ResourceAssetCount: number;
  Revision: Int64;
  CreatedBy: string;
  CreatedAt: string;
  UpdatedAt: string;
  /** OwnerType 是所有权归属；OFFICIAL 表示官方只读资源（预置音色）。 */
  OwnerType: ResourceOwnerType;
  /** ApprovedResourceAssetCount 是当前素材中至少存在一条有效 APPROVED 审核记录的去重数量。 */
  ApprovedResourceAssetCount: number;
}

export interface ResourceAsset {
  ResourceAssetID: string;
  ResourceID: string;
  Name: string;
  SequenceNo: Int64;
  CurrentAssetID?: string;
  IsPrimary: boolean;
  Revision: Int64;
  CreatedAt: string;
  UpdatedAt: string;
  /** PreviewURL 是 CurrentAssetID 对应 Asset 的临时签名地址；非 Artifact 或预签名失败时不返回。 */
  PreviewURL?: string;
  /** ExpiresAt 是 PreviewURL 的 UTC 到期时间；PreviewURL 未返回时也不返回。 */
  ExpiresAt?: string;
  /** MediaType 是当前 Asset 的媒体类型投影。 */
  MediaType: asset.AssetMediaType;
  SourceType: ResourceAssetSourceType;
  /** Reviews 按审核创建时间升序返回当前 Asset 的全部有效记录。 */
  Reviews?: Array<asset.AssetReview>;
  /** GenerationState 是生成素材最近一次运行的轻量状态；上传素材不返回。 */
  GenerationState?: ResourceAssetGenerationState;
}

export interface ResourceAssetGeneration {
  Prompt: string;
  ModelID: string;
  Resolution?: ResourceAssetGenerationResolution;
  AspectRatio?: ResourceAssetGenerationAspectRatio;
  Watermark: boolean;
  UploadedReferences: Array<ResourceAssetGenerationUploadedReference>;
  ResourceReferences: Array<ResourceAssetGenerationResourceReference>;
  Revision: Int64;
  ActiveTaskRunID?: string;
  /** LatestRun 用于页面重载后恢复最近一次生成的终态；旧调用方可忽略该扩展字段。 */
  LatestRun?: ResourceAssetGenerationRun;
}

export interface ResourceAssetGenerationPatch {
  Prompt?: string;
  ModelID?: string;
  Resolution?: ResourceAssetGenerationResolution;
  AspectRatio?: ResourceAssetGenerationAspectRatio;
  Watermark?: boolean;
  UploadedReferences?: Array<ResourceAssetGenerationUploadedReferenceInput>;
  ResourceReferences?: Array<ResourceAssetGenerationResourceReference>;
}

export interface ResourceAssetGenerationResourceReference {
  ResourceID: string;
  SequenceNo: Int64;
}

export interface ResourceAssetGenerationRun {
  TaskRunID: string;
  Status: ResourceAssetGenerationRunStatus;
  Prompt: string;
  ModelID: string;
  Resolution: ResourceAssetGenerationResolution;
  AspectRatio: ResourceAssetGenerationAspectRatio;
  Watermark: boolean;
  Inputs: Array<ResourceAssetGenerationRunInput>;
  OutputAssetID?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  StartedAt?: string;
  FinishedAt?: string;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface ResourceAssetGenerationRunInput {
  Position: number;
  SourceType: ResourceAssetGenerationInputSourceType;
  AssetID: string;
}

/** ResourceAssetGenerationState 是生成型资源素材最近一次运行的轻量状态，用于列表展示和批量轮询。 */
export interface ResourceAssetGenerationState {
  /** ResourceAssetID 是该状态所属的资源素材 ID。 */
  ResourceAssetID: string;
  /** TaskRunID 是最近一次生成任务运行 ID。 */
  TaskRunID: string;
  /** Status 是最近一次生成任务的运行状态。 */
  Status: ResourceAssetGenerationRunStatus;
  /** ErrorCode 是生成失败时供应方返回的原始错误码；供应方未返回或任务未失败时不返回。 */
  ErrorCode?: string;
  /** ErrorMessage 是生成失败时供应方返回的原始错误信息；供应方未返回或任务未失败时不返回。 */
  ErrorMessage?: string;
}

export interface ResourceAssetGenerationUploadedReference {
  AssetID: string;
  FileName: string;
  PreviewURL?: string;
}

/** Patch 输入允许复用既有 Canvas Asset，或提交平台 Asset revision；Server 负责建立 Resource Owner Asset。 */
export interface ResourceAssetGenerationUploadedReferenceInput {
  AssetID?: string;
  SourceAssetID?: string;
  SourceRevisionID?: string;
  FileName?: string;
}

export interface ResourceAssetGroup {
  ResourceID: string;
  Items: Array<ResourceAsset>;
}

export interface ResourceAssetSummary {
  ResourceAssetID: string;
  Name: string;
  CurrentAssetID?: string;
  /** PreviewURL 是 CurrentAssetID 对应 Asset 的临时签名地址；非 Artifact 或预签名失败时不返回。 */
  PreviewURL?: string;
  /** ExpiresAt 是 PreviewURL 的 UTC 到期时间；PreviewURL 未返回时也不返回。 */
  ExpiresAt?: string;
  /** MediaType 是当前 Asset 的媒体类型投影。 */
  MediaType: asset.AssetMediaType;
  SourceType: ResourceAssetSourceType;
  /** Reviews 按审核创建时间升序返回当前 Asset 的全部有效记录。 */
  Reviews?: Array<asset.AssetReview>;
}

export interface ResourceSort {
  Field?: ResourceSortField;
  Direction?: common.SortDirection;
}

export interface SetPrimaryResourceAssetRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  ResourceAssetID: string;
  ExpectedResourceRevision: Int64;
}

export interface SetPrimaryResourceAssetResponse {
  Resource: Resource;
}

export interface StartResourceAssetGenerationRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  ResourceAssetID: string;
  ExpectedRevision: Int64;
}

export interface StartResourceAssetGenerationResponse {
  TaskRunID: string;
}

export interface UpdateResourceAssetGenerationRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  ResourceAssetID: string;
  Patch: ResourceAssetGenerationPatch;
  ExpectedRevision: Int64;
}

export interface UpdateResourceAssetGenerationResponse {
  Generation: ResourceAssetGeneration;
}

export interface UpdateResourceAssetRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  ResourceAssetID: string;
  Name: string;
  ExpectedResourceRevision: Int64;
  ExpectedResourceAssetRevision: Int64;
}

export interface UpdateResourceAssetResponse {
  ResourceAsset: ResourceAsset;
}

export interface UpdateResourceRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ResourceID: string;
  Name?: string;
  Description?: string;
  ExpectedRevision: Int64;
}

export interface UpdateResourceResponse {
  Resource: Resource;
}
/* eslint-enable */
