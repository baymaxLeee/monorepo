// Source presentation model retained for the imported UI. Network calls use @repo/api OpenAPI clients.

import {
  CanvasProjectCanvasSortField as ProjectCanvasSortField,
  CanvasProjectCanvasVideoArchiveExportSortField as ProjectCanvasVideoArchiveExportSortField,
  CanvasVideoArchiveExportStatus,
  CanvasViewMode,
} from "@repo/api";

import type * as common from "./common";

export {
  CanvasVideoArchiveExportStatus,
  CanvasViewMode,
  ProjectCanvasSortField,
  ProjectCanvasVideoArchiveExportSortField,
};

export type Int64 = number;

export interface BatchGetProjectCanvasesRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是剧集所属项目的唯一标识。 */
  ProjectID: string;
  /** CanvasIDs 最多包含 100 个剧集 ID。 */
  CanvasIDs: Array<string>;
}

export interface BatchGetProjectCanvasesResponse {
  /** Items 按请求 ID 首次出现顺序返回实际命中的剧集，不存在或不可见的剧集不返回。 */
  Items: Array<ProjectCanvasSummary>;
}

export interface BatchGetProjectCanvasVideoArchiveExportsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  /** TaskRunIDs 最多包含 100 个导出任务 ID。 */
  TaskRunIDs: Array<string>;
}

export interface BatchGetProjectCanvasVideoArchiveExportsResponse {
  Items: Array<ProjectCanvasVideoArchiveExport>;
}

export interface CancelProjectCanvasVideoArchiveExportRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  TaskRunID: string;
}

export interface CreateProjectCanvasRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是剧集所属项目的唯一标识。 */
  ProjectID: string;
  /** Name 是剧集名称，在所属项目内唯一。 */
  Name: string;
  CoverImageAssetID?: string;
  CoverImageRevisionID?: string;
}

export interface CreateProjectCanvasResponse {
  /** Canvas 是新创建的剧集。 */
  Canvas: ProjectCanvasSummary;
}

export interface DeleteProjectCanvasRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是剧集所属项目的唯一标识。 */
  ProjectID: string;
  /** CanvasID 是待删除的剧集唯一标识。 */
  CanvasID: string;
}

export interface GetProjectCanvasRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是剧集所属项目的唯一标识。 */
  ProjectID: string;
  /** CanvasID 是待查询的剧集唯一标识。 */
  CanvasID: string;
}

export interface GetProjectCanvasResponse {
  /** Canvas 是当前 scope 下命中的剧集。 */
  Canvas: ProjectCanvasSummary;
}

export interface GetProjectCanvasVideoArchiveExportRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  TaskRunID: string;
}

export interface GetProjectCanvasVideoArchiveExportResponse {
  Export: ProjectCanvasVideoArchiveExport;
}

export interface ListProjectCanvasesRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是所属项目的唯一标识。 */
  ProjectID: string;
  /** Sort 指定排序字段与方向；省略时默认按更新时间倒序。 */
  Sort?: ProjectCanvasSort;
  /** Page 是标准分页参数。 */
  Page: common.Page;
  /** Filter 是项目剧集列表的过滤条件。 */
  Filter?: ProjectCanvasFilter;
}

export interface ListProjectCanvasesResponse {
  /** Items 是当前页的剧集摘要。 */
  Items: Array<ProjectCanvasSummary>;
  /** Page 是当前查询的分页信息。 */
  Page: common.PageOutput;
}

export interface ListProjectCanvasVideoArchiveExportsRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  /** Sort 指定排序字段与方向；省略时默认按发起时间倒序。 */
  Sort?: ProjectCanvasVideoArchiveExportSort;
  Page: common.Page;
}

export interface ListProjectCanvasVideoArchiveExportsResponse {
  Items: Array<ProjectCanvasVideoArchiveExport>;
  Page: common.PageOutput;
}

/** ProjectCanvasFilter 是项目剧集列表的过滤条件。 */
export interface ProjectCanvasFilter {
  /** Keyword 按剧集名称进行模糊查询。 */
  Keyword?: string;
  /** CreatedByMe 为 true 时只返回当前用户创建的剧集。 */
  CreatedByMe?: boolean;
}

/** ProjectCanvasSort 定义剧集列表的排序参数。 */
export interface ProjectCanvasSort {
  Field?: ProjectCanvasSortField;
  Direction?: common.SortDirection;
}

/** ProjectCanvasStats 汇总项目剧集下的业务统计信息。 */
export interface ProjectCanvasStats {
  /** CanvasNodeCount 是剧集内的视频片段数量。 */
  CanvasNodeCount: number;
  /** SelectedVideoDurationMillis 是已选视频片段的总时长，单位为毫秒。 */
  SelectedVideoDurationMillis: Int64;
}

/** ProjectCanvasSummary 描述项目剧集的基本信息与统计信息。 */
export interface ProjectCanvasSummary {
  /** CanvasID 是剧集唯一标识。 */
  CanvasID: string;
  /** ProjectID 是剧集所属项目的唯一标识。 */
  ProjectID: string;
  /** Name 是剧集名称，在所属项目内唯一。 */
  Name: string;
  CoverImageAssetID?: string;
  CoverImageRevisionID?: string;
  /** CoverImageURL 是只用于展示的短期签名 URL。 */
  CoverImageURL?: string;
  /** CreatedBy 是剧集创建用户 ID。 */
  CreatedBy: string;
  /** CreatedAt 是剧集创建时间。 */
  CreatedAt: string;
  /** UpdatedAt 是剧集最后更新时间。 */
  UpdatedAt: string;
  /** Stats 是剧集统计信息。 */
  Stats: ProjectCanvasStats;
  /** FallbackCoverImageURL 是 ListProjectCanvases 在没有人工封面时返回的临时首帧 URL。 */
  FallbackCoverImageURL?: string;
  DefaultView: CanvasViewMode;
  Revision: Int64;
}

/** ProjectCanvasVideoArchiveExport 描述一次剧集视频压缩包导出。 */
export interface ProjectCanvasVideoArchiveExport {
  TaskRunID: string;
  ProjectID: string;
  CanvasID: string;
  Status: CanvasVideoArchiveExportStatus;
  InputCount: number;
  OutputFilename: string;
  OutputSize: Int64;
  /** Path 仅在最低留存承诺期内返回；省略不改变 SUCCEEDED 状态。 */
  Path?: string;
  RetentionGuaranteedUntil?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  CreatedAt: string;
  StartedAt?: string;
  FinishedAt?: string;
}

/** ProjectCanvasVideoArchiveExportSort 定义视频压缩包导出列表的排序参数。 */
export interface ProjectCanvasVideoArchiveExportSort {
  Field?: ProjectCanvasVideoArchiveExportSortField;
  Direction?: common.SortDirection;
}

export interface StartProjectCanvasVideoArchiveExportRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
}

export interface StartProjectCanvasVideoArchiveExportResponse {
  Export: ProjectCanvasVideoArchiveExport;
}

export interface UpdateCanvasViewRequest {
  WorkspaceID?: string;
  ProjectID: string;
  CanvasID: string;
  DefaultView?: CanvasViewMode;
}

export interface UpdateProjectCanvasRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是剧集所属项目的唯一标识。 */
  ProjectID: string;
  /** CanvasID 是待更新的剧集唯一标识。 */
  CanvasID: string;
  /** Name 是更新后的剧集名称，在所属项目内唯一。 */
  Name: string;
  CoverImageAssetID?: string;
  CoverImageRevisionID?: string;
}

export interface UpdateProjectCanvasResponse {
  /** Canvas 是更新后的剧集。 */
  Canvas: ProjectCanvasSummary;
}
/* eslint-enable */
