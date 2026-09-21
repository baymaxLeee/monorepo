// Source presentation model retained for the imported UI. Network calls use @repo/api OpenAPI clients.

import type * as aigw_model_types from "./aigw_model_types";
import type * as common from "./common";

export type Int64 = number;

/** ProjectSortField 定义项目列表支持的排序字段。 */
export const enum ProjectSortField {
  UPDATED_AT = 1,
}

export interface BatchGetProjectsByMemberRequest {
  WorkspaceID?: string;
  ProjectIDs: Array<string>;
}

export interface BatchGetProjectsByMemberResponse {
  Items: Array<MemberProjectDetail>;
}

export interface BatchGetProjectsRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectIDs 最多包含 100 个项目 ID。 */
  ProjectIDs: Array<string>;
}

export interface BatchGetProjectsResponse {
  /** Items 按请求 ID 首次出现顺序返回实际命中的项目，不存在或不可见的项目不返回。 */
  Items: Array<ProjectDetail>;
}

export interface CreateProjectRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** Name 是项目名称，在相同 scope 下唯一。 */
  Name: string;
  /** MemberUserIDs 是项目成员用户 ID 列表。 */
  MemberUserIDs: Array<string>;
  /** CoverImagePath 是通过 Up 上传得到的封面图片 path；未传表示不设置封面。 */
  CoverImagePath?: string;
  /** UsageLimit 是项目总金额限额，单位元；未传表示无上限。 */
  UsageLimit?: Int64;
}

export interface CreateProjectResponse {
  /** Project 是新创建的项目详情。 */
  Project: ProjectDetail;
}

export interface DeleteProjectRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是待删除的项目唯一标识。 */
  ProjectID: string;
}

export interface GetProjectByMemberRequest {
  WorkspaceID?: string;
  ProjectID: string;
}

export interface GetProjectByMemberResponse {
  Project: MemberProjectDetail;
}

export interface GetProjectRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是待查询的项目唯一标识。 */
  ProjectID: string;
}

export interface GetProjectResponse {
  /** Project 是当前 scope 下命中的项目详情。 */
  Project: ProjectDetail;
}

export interface GrantProjectModelsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ModelIDs: Array<string>;
}

export interface ListProjectModelsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  ListOpt?: ProjectModelListOption;
  Filter?: ProjectModelFilter;
}

export interface ListProjectModelsResponse {
  Items: Array<ProjectModelInfo>;
  Total: number;
}

export interface ListProjectsByMemberRequest {
  WorkspaceID?: string;
  Filter?: ProjectFilter;
  Sort?: ProjectSort;
  Page: common.Page;
}

export interface ListProjectsByMemberResponse {
  Items: Array<MemberProjectSummary>;
  Page: common.PageOutput;
}

export interface ListProjectsRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** Filter 是项目列表的过滤条件。 */
  Filter?: ProjectFilter;
  /** Sort 指定排序字段与方向；省略时默认按更新时间倒序。 */
  Sort?: ProjectSort;
  /** Page 是标准分页参数。 */
  Page: common.Page;
}

export interface ListProjectsResponse {
  /** Items 是当前页的项目摘要。 */
  Items: Array<ProjectSummary>;
  /** Page 是当前查询的分页信息。 */
  Page: common.PageOutput;
}

/** MemberProjectDetail 是成员项目详情，不包含项目成员列表。 */
export interface MemberProjectDetail {
  ProjectID: string;
  Name: string;
  CoverImagePath?: string;
  CreatedBy: string;
  CreatedAt: string;
  UpdatedAt: string;
  Stats: ProjectStats;
}

/** MemberProjectSummary 是成员项目列表返回的摘要信息，不包含项目成员列表。 */
export interface MemberProjectSummary {
  ProjectID: string;
  Name: string;
  CoverImagePath?: string;
  CreatedBy: string;
  CreatedAt: string;
  UpdatedAt: string;
  Stats: ProjectStats;
}

/** ProjectDetail 是项目详情信息。 */
export interface ProjectDetail {
  /** ProjectID 是项目唯一标识。 */
  ProjectID: string;
  /** Name 是项目名称，在相同 scope 下唯一。 */
  Name: string;
  /** CoverImagePath 是已通过 Up 长期化的封面图片 path。 */
  CoverImagePath?: string;
  /** CreatedBy 是项目创建用户 ID。 */
  CreatedBy: string;
  /** CreatedAt 是项目创建时间。 */
  CreatedAt: string;
  /** UpdatedAt 是项目最后更新时间。 */
  UpdatedAt: string;
  /** Stats 是项目统计信息。 */
  Stats: ProjectStats;
  /** MemberUserIDs 是项目成员用户 ID 列表；受限成员写接口使用该列表进行准入检查。 */
  MemberUserIDs: Array<string>;
  /** UsageLimit 是项目总金额限额，单位元；未传表示无上限。 */
  UsageLimit?: Int64;
  /** UsedAmount 是 AIGW 返回的项目当前已用金额，单位元。 */
  UsedAmount?: number;
}

/** ProjectFilter 是项目列表的过滤条件。 */
export interface ProjectFilter {
  /** Keyword 按项目名称进行模糊查询。 */
  Keyword?: string;
}

export interface ProjectModelDuration {
  Min?: number;
  Max?: number;
  /** Default 是模型的默认固定生成时长，单位为秒。 */
  Default?: number;
  /** Recommends 是模型推荐时长；-1 表示模型支持自动选择生成时长。 */
  Recommends?: Array<number>;
  /** RecommendDefault 是推荐项中的默认值；-1 表示默认使用自动时长。 */
  RecommendDefault?: number;
}

export interface ProjectModelFilter {
  Types?: Array<string>;
  Features?: Array<string>;
  Statuses?: Array<string>;
  IsGranted?: boolean;
}

/** ProjectModelInfo 保留原字段 1-9 的 wire layout，并扩展 AIGW 的其余非敏感模型字段。 */
export interface ProjectModelInfo {
  ID: string;
  Name: string;
  Type: string;
  FeaturesConfig?: Array<string>;
  Status?: string;
  IsPublic: boolean;
  IsDefault: boolean;
  Granted: boolean;
  Property?: ProjectModelProperty;
  Description?: string;
  PublishSourceType?: string;
  CreateUserName?: string;
  CreateTime?: string;
  Version?: string;
  Source?: string;
  DeleteAt?: string;
  TenantId?: string;
  DistributeType?: string;
  FromID?: string;
  UpdateUserName?: string;
  UpdateTime?: string;
  IsPublished?: boolean;
  PublishTime?: string;
  PublishUserName?: string;
  Icon?: string;
  WorkspaceName?: string;
  CustomMarker?: aigw_model_types.MarkerDetails;
  ServiceIntroduction?: string;
  BusinessLabels?: Array<aigw_model_types.LabelInfo>;
  IsCustomMarkerEnabled?: boolean;
  IsPreset?: boolean;
  IsBilling?: boolean;
  IsDefaultLTM?: boolean;
  DefaultType?: string;
  DefaultTypes?: Array<string>;
  CustomParameters?: string;
  PriceConfig?: aigw_model_types.PriceConfig;
  PromptConfig?: aigw_model_types.PromptConfig;
  StrategiesConfig?: Array<string>;
  PolicyConfig?: aigw_model_types.PolicyConfig;
  Parameter?: aigw_model_types.ModelParameter;
  CredentialSchema?: aigw_model_types.ModelCredentialSchema;
  ProductCode?: string;
  WorkspaceID?: string;
  Provider?: string;
  Spec?: string;
  ModelName?: string;
  DLVersion?: string;
  DeployConfig?: aigw_model_types.MaaSModelServiceDeployConfig;
}

export interface ProjectModelListOption {
  PageNumber: number;
  PageSize: number;
}

export interface ProjectModelProperty {
  Vision?: ProjectModelVisionProperty;
  LLM?: aigw_model_types.LLMConfig;
  Embedding?: aigw_model_types.EmbeddingConfig;
  Audio?: aigw_model_types.AudioConfig;
  Common?: aigw_model_types.CommonModelConfig;
}

export interface ProjectModelRatio {
  /** Values 是模型支持的固定画幅比例。 */
  Values?: Array<string>;
  /** Adaptive 表示模型是否接受 adaptive 自动画幅协议值。 */
  Adaptive?: boolean;
  /** Default 是模型默认画幅，可能是固定比例或 adaptive。 */
  Default?: string;
}

export interface ProjectModelVideoProperty {
  Duration?: ProjectModelDuration;
  Ratio?: ProjectModelRatio;
  CameraFixed?: aigw_model_types.CommonSwitch;
  Features?: Array<aigw_model_types.VisionFeature>;
  GenerateAudio?: aigw_model_types.CommonSwitch;
  NegativePrompt?: aigw_model_types.CommonSwitch;
  Watermark?: aigw_model_types.CommonBoolSwitch;
  Reference?: aigw_model_types.ReferenceConfig;
  Tools?: aigw_model_types.ToolConfig;
  Resolutions?: Array<string>;
}

export interface ProjectModelVisionProperty {
  Video?: ProjectModelVideoProperty;
  Seed?: aigw_model_types.IntRange;
  Image?: aigw_model_types.ImageConfig;
  GuidanceScale?: aigw_model_types.DoubleRange;
}

/** ProjectSort 定义项目列表的排序参数。 */
export interface ProjectSort {
  Field?: ProjectSortField;
  Direction?: common.SortDirection;
}

/** ProjectStats 汇总项目下的业务统计信息。 */
export interface ProjectStats {
  /** CanvasCount 是项目内的剧集数量。 */
  CanvasCount: number;
  /** SelectedVideoDurationMillis 是已选视频片段的总时长，单位为毫秒。 */
  SelectedVideoDurationMillis: Int64;
  /** ResourceCount 是项目资产库中由该项目拥有的资产数量，不包含预置资产。 */
  ResourceCount: number;
}

/** ProjectSummary 是项目列表返回的摘要信息。 */
export interface ProjectSummary {
  /** ProjectID 是项目唯一标识。 */
  ProjectID: string;
  /** Name 是项目名称，在相同 scope 下唯一。 */
  Name: string;
  /** CoverImagePath 是已通过 Up 长期化的封面图片 path。 */
  CoverImagePath?: string;
  /** CreatedBy 是项目创建用户 ID。 */
  CreatedBy: string;
  /** CreatedAt 是项目创建时间。 */
  CreatedAt: string;
  /** UpdatedAt 是项目最后更新时间。 */
  UpdatedAt: string;
  /** Stats 是项目统计信息。 */
  Stats: ProjectStats;
  /** MemberUserIDs 是项目成员用户 ID 列表；仅管理接口返回。 */
  MemberUserIDs: Array<string>;
}

export interface UpdateProjectByMemberRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是待更新的项目唯一标识。 */
  ProjectID: string;
  /** CoverImagePath 未传时保持不变，空字符串表示清除封面。 */
  CoverImagePath?: string;
}

export interface UpdateProjectByMemberResponse {
  /** Project 是更新后的项目详情。 */
  Project: MemberProjectDetail;
}

export interface UpdateProjectRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是待更新的项目唯一标识。 */
  ProjectID: string;
  /** Name 是更新后的项目名称，在相同 scope 下唯一。 */
  Name: string;
  /** MemberUserIDs 是更新后的项目成员用户 ID 列表。 */
  MemberUserIDs: Array<string>;
  /** CoverImagePath 未传时保持不变，空字符串表示清除封面。 */
  CoverImagePath?: string;
  /** UsageLimit 是项目总金额限额，单位元；未传表示取消限制。 */
  UsageLimit?: Int64;
}

export interface UpdateProjectResponse {
  /** Project 是更新后的项目详情。 */
  Project: ProjectDetail;
}
/* eslint-enable */
