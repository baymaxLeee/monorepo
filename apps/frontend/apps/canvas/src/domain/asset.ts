// Source presentation model retained for the imported UI. Network calls use @repo/api OpenAPI clients.

import {
  CanvasAssetMediaType as AssetMediaType,
  CanvasAssetOwnerType as AssetOwnerType,
  CanvasAssetReviewStatus as AssetReviewStatus,
} from "@repo/api";

export { AssetMediaType, AssetOwnerType, AssetReviewStatus };

export type Int64 = number;

/** Asset 描述已完成持久化注册的素材。 */
export interface Asset {
  /** AssetID 是素材唯一标识。 */
  AssetID: string;
  /** OwnerType 是素材的范围归属类型。 */
  OwnerType: AssetOwnerType;
  /** OwnerID 是对应归属对象的唯一标识。 */
  OwnerID: string;
  /** FileName 是用户上传时提供的文件名。 */
  FileName: string;
  /** MediaType 由服务端根据文件内容识别。 */
  MediaType: AssetMediaType;
  /** SizeBytes 是文件字节数。 */
  SizeBytes: Int64;
  /** CreatedBy 是上传用户 ID。 */
  CreatedBy: string;
  /** CreatedAt 是素材创建时间。 */
  CreatedAt: string;
  /** Reviews 按审核创建时间升序返回全部当前有效记录。 */
  Reviews?: Array<AssetReview>;
}

/** AssetReview 是素材一次送审的展示投影；每次送审均独立持久化。 */
export interface AssetReview {
  PackageID: string;
  PackageName: string;
  Status: AssetReviewStatus;
  FailureReason?: string;
  SubmittedAt?: string;
  UpdatedAt: string;
}

/** AssetReviews 是单个素材的审核状态集合，不包含素材详情。 */
export interface AssetReviews {
  AssetID: string;
  Reviews: Array<AssetReview>;
}

/** AssetReviewUpload 描述送审时需要物化为项目素材的 artifact storage 临时文件。 */
export interface AssetReviewUpload {
  /** ClientID 是调用方为本地草稿分配的稳定标识，用于幂等物化。 */
  ClientID: string;
  /** BlobID 是 artifact storage 临时上传返回的文件标识。 */
  BlobID: string;
  /** FileName 是用户上传时提供的文件名。 */
  FileName: string;
}

export interface BatchGetAssetReviewsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  AssetIDs: Array<string>;
}

export interface BatchGetAssetReviewsResponse {
  /** Items 按 AssetIDs 首次出现顺序返回；尚未送审的素材返回空 Reviews。 */
  Items: Array<AssetReviews>;
}

export interface BatchSubmitAssetReviewsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  /** Items 最多包含 100 个素材与权益包组合。 */
  Items: Array<SubmitAssetReviewItem>;
}

export interface BatchSubmitAssetReviewsResponse {
  Items: Array<SubmitAssetReviewResult>;
}

/** SubmitAssetReviewItem 描述一次批量送审中的素材与权益包组合。
 AssetID 与 Upload 必须且只能提供一个。 */
export interface SubmitAssetReviewItem {
  AssetID?: string;
  PackageID: string;
  Upload?: AssetReviewUpload;
}

export interface SubmitAssetReviewRequest {
  WorkspaceID?: string;
  ProjectID: string;
  AssetID?: string;
  PackageID: string;
  Upload?: AssetReviewUpload;
}

export interface SubmitAssetReviewResponse {
  /** AssetID 是送审使用的正式素材 ID；Upload 输入完成物化后由服务端返回。 */
  AssetID: string;
  Review: AssetReview;
}

/** SubmitAssetReviewResult 按请求顺序返回成功结果或安全的逐项错误。 */
export interface SubmitAssetReviewResult {
  AssetID?: string;
  PackageID: string;
  Review?: AssetReview;
  ErrorCode?: string;
  ErrorMessage?: string;
}
/* eslint-enable */
