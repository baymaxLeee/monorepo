package canvas

import (
	"database/sql"
	"database/sql/driver"
	"fmt"
	"github.com/example/monorepo/canvas/internal/server/contracts/base"
	"github.com/example/monorepo/canvas/internal/server/contracts/common"
)

type CanvasViewMode int64

const (
	CanvasViewMode_CANVAS     CanvasViewMode = 1
	CanvasViewMode_STORYBOARD CanvasViewMode = 2
)

func (p CanvasViewMode) String() string {
	switch p {
	case CanvasViewMode_CANVAS:
		return "CANVAS"
	case CanvasViewMode_STORYBOARD:
		return "STORYBOARD"
	}
	return "<UNSET>"
}

func CanvasViewModeFromString(s string) (CanvasViewMode, error) {
	switch s {
	case "CANVAS":
		return CanvasViewMode_CANVAS, nil
	case "STORYBOARD":
		return CanvasViewMode_STORYBOARD, nil
	}
	return CanvasViewMode(0), fmt.Errorf("not a valid CanvasViewMode string")
}

func CanvasViewModePtr(v CanvasViewMode) *CanvasViewMode { return &v }
func (p *CanvasViewMode) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasViewMode(result.Int64)
	return
}

func (p *CanvasViewMode) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// ProjectCanvasSortField 定义剧集列表支持的排序字段。
type ProjectCanvasSortField int64

const (
	ProjectCanvasSortField_UPDATED_AT ProjectCanvasSortField = 1
)

func (p ProjectCanvasSortField) String() string {
	switch p {
	case ProjectCanvasSortField_UPDATED_AT:
		return "UPDATED_AT"
	}
	return "<UNSET>"
}

func ProjectCanvasSortFieldFromString(s string) (ProjectCanvasSortField, error) {
	switch s {
	case "UPDATED_AT":
		return ProjectCanvasSortField_UPDATED_AT, nil
	}
	return ProjectCanvasSortField(0), fmt.Errorf("not a valid ProjectCanvasSortField string")
}

func ProjectCanvasSortFieldPtr(v ProjectCanvasSortField) *ProjectCanvasSortField { return &v }
func (p *ProjectCanvasSortField) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = ProjectCanvasSortField(result.Int64)
	return
}

func (p *ProjectCanvasSortField) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// CanvasVideoArchiveExportStatus 是剧集视频压缩包导出的生命周期状态。
type CanvasVideoArchiveExportStatus int64

const (
	CanvasVideoArchiveExportStatus_QUEUED    CanvasVideoArchiveExportStatus = 1
	CanvasVideoArchiveExportStatus_RUNNING   CanvasVideoArchiveExportStatus = 2
	CanvasVideoArchiveExportStatus_SUCCEEDED CanvasVideoArchiveExportStatus = 3
	CanvasVideoArchiveExportStatus_FAILED    CanvasVideoArchiveExportStatus = 4
	CanvasVideoArchiveExportStatus_CANCELLED CanvasVideoArchiveExportStatus = 5
)

func (p CanvasVideoArchiveExportStatus) String() string {
	switch p {
	case CanvasVideoArchiveExportStatus_QUEUED:
		return "QUEUED"
	case CanvasVideoArchiveExportStatus_RUNNING:
		return "RUNNING"
	case CanvasVideoArchiveExportStatus_SUCCEEDED:
		return "SUCCEEDED"
	case CanvasVideoArchiveExportStatus_FAILED:
		return "FAILED"
	case CanvasVideoArchiveExportStatus_CANCELLED:
		return "CANCELLED"
	}
	return "<UNSET>"
}

func CanvasVideoArchiveExportStatusFromString(s string) (CanvasVideoArchiveExportStatus, error) {
	switch s {
	case "QUEUED":
		return CanvasVideoArchiveExportStatus_QUEUED, nil
	case "RUNNING":
		return CanvasVideoArchiveExportStatus_RUNNING, nil
	case "SUCCEEDED":
		return CanvasVideoArchiveExportStatus_SUCCEEDED, nil
	case "FAILED":
		return CanvasVideoArchiveExportStatus_FAILED, nil
	case "CANCELLED":
		return CanvasVideoArchiveExportStatus_CANCELLED, nil
	}
	return CanvasVideoArchiveExportStatus(0), fmt.Errorf("not a valid CanvasVideoArchiveExportStatus string")
}

func CanvasVideoArchiveExportStatusPtr(v CanvasVideoArchiveExportStatus) *CanvasVideoArchiveExportStatus {
	return &v
}
func (p *CanvasVideoArchiveExportStatus) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasVideoArchiveExportStatus(result.Int64)
	return
}

func (p *CanvasVideoArchiveExportStatus) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// ProjectCanvasVideoArchiveExportSortField 定义视频压缩包导出列表支持的排序字段。
type ProjectCanvasVideoArchiveExportSortField int64

const (
	ProjectCanvasVideoArchiveExportSortField_CREATED_AT ProjectCanvasVideoArchiveExportSortField = 1
)

func (p ProjectCanvasVideoArchiveExportSortField) String() string {
	switch p {
	case ProjectCanvasVideoArchiveExportSortField_CREATED_AT:
		return "CREATED_AT"
	}
	return "<UNSET>"
}

func ProjectCanvasVideoArchiveExportSortFieldFromString(s string) (ProjectCanvasVideoArchiveExportSortField, error) {
	switch s {
	case "CREATED_AT":
		return ProjectCanvasVideoArchiveExportSortField_CREATED_AT, nil
	}
	return ProjectCanvasVideoArchiveExportSortField(0), fmt.Errorf("not a valid ProjectCanvasVideoArchiveExportSortField string")
}

func ProjectCanvasVideoArchiveExportSortFieldPtr(v ProjectCanvasVideoArchiveExportSortField) *ProjectCanvasVideoArchiveExportSortField {
	return &v
}
func (p *ProjectCanvasVideoArchiveExportSortField) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = ProjectCanvasVideoArchiveExportSortField(result.Int64)
	return
}

func (p *ProjectCanvasVideoArchiveExportSortField) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// ProjectCanvasStats 汇总项目剧集下的业务统计信息。
type ProjectCanvasStats struct {
	// CanvasNodeCount 是剧集内的视频片段数量。
	CanvasNodeCount int32 `json:"CanvasNodeCount"`
	// SelectedVideoDurationMillis 是已选视频片段的总时长，单位为毫秒。
	SelectedVideoDurationMillis int64 `json:"SelectedVideoDurationMillis"`
}

func NewProjectCanvasStats() *ProjectCanvasStats {
	return &ProjectCanvasStats{}
}

func (p *ProjectCanvasStats) InitDefault() {
}

func (p *ProjectCanvasStats) GetCanvasNodeCount() (v int32) {
	return p.CanvasNodeCount
}

func (p *ProjectCanvasStats) GetSelectedVideoDurationMillis() (v int64) {
	return p.SelectedVideoDurationMillis
}

func (p *ProjectCanvasStats) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectCanvasStats(%+v)", *p)
}

// ProjectCanvasSummary 描述项目剧集的基本信息与统计信息。
type ProjectCanvasSummary struct {
	// CanvasID 是剧集唯一标识。
	CanvasID string `json:"CanvasID"`
	// ProjectID 是剧集所属项目的唯一标识。
	ProjectID string `json:"ProjectID"`
	// Name 是剧集名称，在所属项目内唯一。
	Name string `json:"Name"`
	// CoverImagePath 是已通过 Up 长期化的封面图片 path。
	CoverImagePath *string `json:"CoverImagePath,omitempty"`
	// CreatedBy 是剧集创建用户 ID。
	CreatedBy string `json:"CreatedBy"`
	// CreatedAt 是剧集创建时间。
	CreatedAt common.Timestamp `json:"CreatedAt"`
	// UpdatedAt 是剧集最后更新时间。
	UpdatedAt common.Timestamp `json:"UpdatedAt"`
	// Stats 是剧集统计信息。
	Stats *ProjectCanvasStats `json:"Stats"`
	// FallbackCoverImageURL 是 ListProjectCanvases 在没有人工封面时返回的临时首帧 URL。
	FallbackCoverImageURL *string        `json:"FallbackCoverImageURL,omitempty"`
	DefaultView           CanvasViewMode `json:"DefaultView"`
	Revision              int64          `json:"Revision"`
}

func NewProjectCanvasSummary() *ProjectCanvasSummary {
	return &ProjectCanvasSummary{}
}

func (p *ProjectCanvasSummary) InitDefault() {
}

func (p *ProjectCanvasSummary) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *ProjectCanvasSummary) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *ProjectCanvasSummary) GetName() (v string) {
	return p.Name
}

var ProjectCanvasSummary_CoverImagePath_DEFAULT string

func (p *ProjectCanvasSummary) GetCoverImagePath() (v string) {
	if !p.IsSetCoverImagePath() {
		return ProjectCanvasSummary_CoverImagePath_DEFAULT
	}
	return *p.CoverImagePath
}

func (p *ProjectCanvasSummary) GetCreatedBy() (v string) {
	return p.CreatedBy
}

func (p *ProjectCanvasSummary) GetCreatedAt() (v common.Timestamp) {
	return p.CreatedAt
}

func (p *ProjectCanvasSummary) GetUpdatedAt() (v common.Timestamp) {
	return p.UpdatedAt
}

var ProjectCanvasSummary_Stats_DEFAULT *ProjectCanvasStats

func (p *ProjectCanvasSummary) GetStats() (v *ProjectCanvasStats) {
	if !p.IsSetStats() {
		return ProjectCanvasSummary_Stats_DEFAULT
	}
	return p.Stats
}

var ProjectCanvasSummary_FallbackCoverImageURL_DEFAULT string

func (p *ProjectCanvasSummary) GetFallbackCoverImageURL() (v string) {
	if !p.IsSetFallbackCoverImageURL() {
		return ProjectCanvasSummary_FallbackCoverImageURL_DEFAULT
	}
	return *p.FallbackCoverImageURL
}

func (p *ProjectCanvasSummary) GetDefaultView() (v CanvasViewMode) {
	return p.DefaultView
}

func (p *ProjectCanvasSummary) GetRevision() (v int64) {
	return p.Revision
}

func (p *ProjectCanvasSummary) IsSetCoverImagePath() bool {
	return p.CoverImagePath != nil
}

func (p *ProjectCanvasSummary) IsSetStats() bool {
	return p.Stats != nil
}

func (p *ProjectCanvasSummary) IsSetFallbackCoverImageURL() bool {
	return p.FallbackCoverImageURL != nil
}

func (p *ProjectCanvasSummary) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectCanvasSummary(%+v)", *p)
}

// ProjectCanvasFilter 是项目剧集列表的过滤条件。
type ProjectCanvasFilter struct {
	// Keyword 按剧集名称进行模糊查询。
	Keyword *string `json:"Keyword,omitempty"`
	// CreatedByMe 为 true 时只返回当前用户创建的剧集。
	CreatedByMe *bool `json:"CreatedByMe,omitempty"`
}

func NewProjectCanvasFilter() *ProjectCanvasFilter {
	return &ProjectCanvasFilter{}
}

func (p *ProjectCanvasFilter) InitDefault() {
}

var ProjectCanvasFilter_Keyword_DEFAULT string

func (p *ProjectCanvasFilter) GetKeyword() (v string) {
	if !p.IsSetKeyword() {
		return ProjectCanvasFilter_Keyword_DEFAULT
	}
	return *p.Keyword
}

var ProjectCanvasFilter_CreatedByMe_DEFAULT bool

func (p *ProjectCanvasFilter) GetCreatedByMe() (v bool) {
	if !p.IsSetCreatedByMe() {
		return ProjectCanvasFilter_CreatedByMe_DEFAULT
	}
	return *p.CreatedByMe
}

func (p *ProjectCanvasFilter) IsSetKeyword() bool {
	return p.Keyword != nil
}

func (p *ProjectCanvasFilter) IsSetCreatedByMe() bool {
	return p.CreatedByMe != nil
}

func (p *ProjectCanvasFilter) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectCanvasFilter(%+v)", *p)
}

// ProjectCanvasSort 定义剧集列表的排序参数。
type ProjectCanvasSort struct {
	Field     *ProjectCanvasSortField `json:"Field,omitempty"`
	Direction *common.SortDirection   `json:"Direction,omitempty"`
}

func NewProjectCanvasSort() *ProjectCanvasSort {
	return &ProjectCanvasSort{}
}

func (p *ProjectCanvasSort) InitDefault() {
}

var ProjectCanvasSort_Field_DEFAULT ProjectCanvasSortField

func (p *ProjectCanvasSort) GetField() (v ProjectCanvasSortField) {
	if !p.IsSetField() {
		return ProjectCanvasSort_Field_DEFAULT
	}
	return *p.Field
}

var ProjectCanvasSort_Direction_DEFAULT common.SortDirection

func (p *ProjectCanvasSort) GetDirection() (v common.SortDirection) {
	if !p.IsSetDirection() {
		return ProjectCanvasSort_Direction_DEFAULT
	}
	return *p.Direction
}

func (p *ProjectCanvasSort) IsSetField() bool {
	return p.Field != nil
}

func (p *ProjectCanvasSort) IsSetDirection() bool {
	return p.Direction != nil
}

func (p *ProjectCanvasSort) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectCanvasSort(%+v)", *p)
}

// ListProjectCanvasesRequest 是查询项目剧集列表的请求。
type ListProjectCanvasesRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是所属项目的唯一标识。
	ProjectID string `json:"ProjectID"`
	// Sort 指定排序字段与方向；省略时默认按更新时间倒序。
	Sort *ProjectCanvasSort `json:"Sort,omitempty"`
	// Page 是标准分页参数。
	Page *common.Page `json:"Page"`
	// Filter 是项目剧集列表的过滤条件。
	Filter *ProjectCanvasFilter `json:"Filter,omitempty"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewListProjectCanvasesRequest() *ListProjectCanvasesRequest {
	return &ListProjectCanvasesRequest{}
}

func (p *ListProjectCanvasesRequest) InitDefault() {
}

var ListProjectCanvasesRequest_WorkspaceID_DEFAULT string

func (p *ListProjectCanvasesRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return ListProjectCanvasesRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *ListProjectCanvasesRequest) GetProjectID() (v string) {
	return p.ProjectID
}

var ListProjectCanvasesRequest_Sort_DEFAULT *ProjectCanvasSort

func (p *ListProjectCanvasesRequest) GetSort() (v *ProjectCanvasSort) {
	if !p.IsSetSort() {
		return ListProjectCanvasesRequest_Sort_DEFAULT
	}
	return p.Sort
}

var ListProjectCanvasesRequest_Page_DEFAULT *common.Page

func (p *ListProjectCanvasesRequest) GetPage() (v *common.Page) {
	if !p.IsSetPage() {
		return ListProjectCanvasesRequest_Page_DEFAULT
	}
	return p.Page
}

var ListProjectCanvasesRequest_Filter_DEFAULT *ProjectCanvasFilter

func (p *ListProjectCanvasesRequest) GetFilter() (v *ProjectCanvasFilter) {
	if !p.IsSetFilter() {
		return ListProjectCanvasesRequest_Filter_DEFAULT
	}
	return p.Filter
}

var ListProjectCanvasesRequest_Top_DEFAULT *base.TopParam

func (p *ListProjectCanvasesRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return ListProjectCanvasesRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *ListProjectCanvasesRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *ListProjectCanvasesRequest) IsSetSort() bool {
	return p.Sort != nil
}

func (p *ListProjectCanvasesRequest) IsSetPage() bool {
	return p.Page != nil
}

func (p *ListProjectCanvasesRequest) IsSetFilter() bool {
	return p.Filter != nil
}

func (p *ListProjectCanvasesRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *ListProjectCanvasesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListProjectCanvasesRequest(%+v)", *p)
}

// ListProjectCanvasesResponse 是查询项目剧集列表的响应。
type ListProjectCanvasesResponse struct {
	// Items 是当前页的剧集摘要。
	Items []*ProjectCanvasSummary `json:"Items"`
	// Page 是当前查询的分页信息。
	Page *common.PageOutput `json:"Page"`
}

func NewListProjectCanvasesResponse() *ListProjectCanvasesResponse {
	return &ListProjectCanvasesResponse{}
}

func (p *ListProjectCanvasesResponse) InitDefault() {
}

func (p *ListProjectCanvasesResponse) GetItems() (v []*ProjectCanvasSummary) {
	return p.Items
}

var ListProjectCanvasesResponse_Page_DEFAULT *common.PageOutput

func (p *ListProjectCanvasesResponse) GetPage() (v *common.PageOutput) {
	if !p.IsSetPage() {
		return ListProjectCanvasesResponse_Page_DEFAULT
	}
	return p.Page
}

func (p *ListProjectCanvasesResponse) IsSetPage() bool {
	return p.Page != nil
}

func (p *ListProjectCanvasesResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListProjectCanvasesResponse(%+v)", *p)
}

// GetProjectCanvasRequest 是获取单个项目剧集的请求。
type GetProjectCanvasRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是剧集所属项目的唯一标识。
	ProjectID string `json:"ProjectID"`
	// CanvasID 是待查询的剧集唯一标识。
	CanvasID string `json:"CanvasID"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewGetProjectCanvasRequest() *GetProjectCanvasRequest {
	return &GetProjectCanvasRequest{}
}

func (p *GetProjectCanvasRequest) InitDefault() {
}

var GetProjectCanvasRequest_WorkspaceID_DEFAULT string

func (p *GetProjectCanvasRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return GetProjectCanvasRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *GetProjectCanvasRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *GetProjectCanvasRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

var GetProjectCanvasRequest_Top_DEFAULT *base.TopParam

func (p *GetProjectCanvasRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return GetProjectCanvasRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *GetProjectCanvasRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *GetProjectCanvasRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *GetProjectCanvasRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetProjectCanvasRequest(%+v)", *p)
}

// GetProjectCanvasResponse 是获取单个项目剧集的响应。
type GetProjectCanvasResponse struct {
	// Canvas 是当前 scope 下命中的剧集。
	Canvas *ProjectCanvasSummary `json:"Canvas"`
}

func NewGetProjectCanvasResponse() *GetProjectCanvasResponse {
	return &GetProjectCanvasResponse{}
}

func (p *GetProjectCanvasResponse) InitDefault() {
}

var GetProjectCanvasResponse_Canvas_DEFAULT *ProjectCanvasSummary

func (p *GetProjectCanvasResponse) GetCanvas() (v *ProjectCanvasSummary) {
	if !p.IsSetCanvas() {
		return GetProjectCanvasResponse_Canvas_DEFAULT
	}
	return p.Canvas
}

func (p *GetProjectCanvasResponse) IsSetCanvas() bool {
	return p.Canvas != nil
}

func (p *GetProjectCanvasResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetProjectCanvasResponse(%+v)", *p)
}

// BatchGetProjectCanvasesRequest 是批量获取项目剧集的请求。
type BatchGetProjectCanvasesRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是剧集所属项目的唯一标识。
	ProjectID string `json:"ProjectID"`
	// CanvasIDs 最多包含 100 个剧集 ID。
	CanvasIDs []string `json:"CanvasIDs"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewBatchGetProjectCanvasesRequest() *BatchGetProjectCanvasesRequest {
	return &BatchGetProjectCanvasesRequest{}
}

func (p *BatchGetProjectCanvasesRequest) InitDefault() {
}

var BatchGetProjectCanvasesRequest_WorkspaceID_DEFAULT string

func (p *BatchGetProjectCanvasesRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchGetProjectCanvasesRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchGetProjectCanvasesRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *BatchGetProjectCanvasesRequest) GetCanvasIDs() (v []string) {
	return p.CanvasIDs
}

var BatchGetProjectCanvasesRequest_Top_DEFAULT *base.TopParam

func (p *BatchGetProjectCanvasesRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return BatchGetProjectCanvasesRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *BatchGetProjectCanvasesRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchGetProjectCanvasesRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *BatchGetProjectCanvasesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetProjectCanvasesRequest(%+v)", *p)
}

// BatchGetProjectCanvasesResponse 是批量获取项目剧集的响应。
type BatchGetProjectCanvasesResponse struct {
	// Items 按请求 ID 首次出现顺序返回实际命中的剧集，不存在或不可见的剧集不返回。
	Items []*ProjectCanvasSummary `json:"Items"`
}

func NewBatchGetProjectCanvasesResponse() *BatchGetProjectCanvasesResponse {
	return &BatchGetProjectCanvasesResponse{}
}

func (p *BatchGetProjectCanvasesResponse) InitDefault() {
}

func (p *BatchGetProjectCanvasesResponse) GetItems() (v []*ProjectCanvasSummary) {
	return p.Items
}

func (p *BatchGetProjectCanvasesResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetProjectCanvasesResponse(%+v)", *p)
}

// CreateProjectCanvasRequest 是创建项目剧集的请求。
type CreateProjectCanvasRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是剧集所属项目的唯一标识。
	ProjectID string `json:"ProjectID"`
	// Name 是剧集名称，在所属项目内唯一。
	Name string `json:"Name"`
	// CoverImagePath 是通过 Up 上传得到的封面图片 path；未传表示不设置封面。
	CoverImagePath *string `json:"CoverImagePath,omitempty"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewCreateProjectCanvasRequest() *CreateProjectCanvasRequest {
	return &CreateProjectCanvasRequest{}
}

func (p *CreateProjectCanvasRequest) InitDefault() {
}

var CreateProjectCanvasRequest_WorkspaceID_DEFAULT string

func (p *CreateProjectCanvasRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CreateProjectCanvasRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CreateProjectCanvasRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CreateProjectCanvasRequest) GetName() (v string) {
	return p.Name
}

var CreateProjectCanvasRequest_CoverImagePath_DEFAULT string

func (p *CreateProjectCanvasRequest) GetCoverImagePath() (v string) {
	if !p.IsSetCoverImagePath() {
		return CreateProjectCanvasRequest_CoverImagePath_DEFAULT
	}
	return *p.CoverImagePath
}

var CreateProjectCanvasRequest_Top_DEFAULT *base.TopParam

func (p *CreateProjectCanvasRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return CreateProjectCanvasRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *CreateProjectCanvasRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CreateProjectCanvasRequest) IsSetCoverImagePath() bool {
	return p.CoverImagePath != nil
}

func (p *CreateProjectCanvasRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *CreateProjectCanvasRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateProjectCanvasRequest(%+v)", *p)
}

// CreateProjectCanvasResponse 是创建项目剧集的响应。
type CreateProjectCanvasResponse struct {
	// Canvas 是新创建的剧集。
	Canvas *ProjectCanvasSummary `json:"Canvas"`
}

func NewCreateProjectCanvasResponse() *CreateProjectCanvasResponse {
	return &CreateProjectCanvasResponse{}
}

func (p *CreateProjectCanvasResponse) InitDefault() {
}

var CreateProjectCanvasResponse_Canvas_DEFAULT *ProjectCanvasSummary

func (p *CreateProjectCanvasResponse) GetCanvas() (v *ProjectCanvasSummary) {
	if !p.IsSetCanvas() {
		return CreateProjectCanvasResponse_Canvas_DEFAULT
	}
	return p.Canvas
}

func (p *CreateProjectCanvasResponse) IsSetCanvas() bool {
	return p.Canvas != nil
}

func (p *CreateProjectCanvasResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateProjectCanvasResponse(%+v)", *p)
}

// UpdateProjectCanvasRequest 是更新项目剧集的请求。
type UpdateProjectCanvasRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是剧集所属项目的唯一标识。
	ProjectID string `json:"ProjectID"`
	// CanvasID 是待更新的剧集唯一标识。
	CanvasID string `json:"CanvasID"`
	// Name 是更新后的剧集名称，在所属项目内唯一。
	Name string `json:"Name"`
	// CoverImagePath 未传时保持不变，空字符串表示清除封面。
	CoverImagePath *string `json:"CoverImagePath,omitempty"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewUpdateProjectCanvasRequest() *UpdateProjectCanvasRequest {
	return &UpdateProjectCanvasRequest{}
}

func (p *UpdateProjectCanvasRequest) InitDefault() {
}

var UpdateProjectCanvasRequest_WorkspaceID_DEFAULT string

func (p *UpdateProjectCanvasRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return UpdateProjectCanvasRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *UpdateProjectCanvasRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *UpdateProjectCanvasRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *UpdateProjectCanvasRequest) GetName() (v string) {
	return p.Name
}

var UpdateProjectCanvasRequest_CoverImagePath_DEFAULT string

func (p *UpdateProjectCanvasRequest) GetCoverImagePath() (v string) {
	if !p.IsSetCoverImagePath() {
		return UpdateProjectCanvasRequest_CoverImagePath_DEFAULT
	}
	return *p.CoverImagePath
}

var UpdateProjectCanvasRequest_Top_DEFAULT *base.TopParam

func (p *UpdateProjectCanvasRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return UpdateProjectCanvasRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *UpdateProjectCanvasRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *UpdateProjectCanvasRequest) IsSetCoverImagePath() bool {
	return p.CoverImagePath != nil
}

func (p *UpdateProjectCanvasRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *UpdateProjectCanvasRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateProjectCanvasRequest(%+v)", *p)
}

// UpdateProjectCanvasResponse 是更新项目剧集的响应。
type UpdateProjectCanvasResponse struct {
	// Canvas 是更新后的剧集。
	Canvas *ProjectCanvasSummary `json:"Canvas"`
}

func NewUpdateProjectCanvasResponse() *UpdateProjectCanvasResponse {
	return &UpdateProjectCanvasResponse{}
}

func (p *UpdateProjectCanvasResponse) InitDefault() {
}

var UpdateProjectCanvasResponse_Canvas_DEFAULT *ProjectCanvasSummary

func (p *UpdateProjectCanvasResponse) GetCanvas() (v *ProjectCanvasSummary) {
	if !p.IsSetCanvas() {
		return UpdateProjectCanvasResponse_Canvas_DEFAULT
	}
	return p.Canvas
}

func (p *UpdateProjectCanvasResponse) IsSetCanvas() bool {
	return p.Canvas != nil
}

func (p *UpdateProjectCanvasResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateProjectCanvasResponse(%+v)", *p)
}

// DeleteProjectCanvasRequest 是删除项目剧集的请求。
type DeleteProjectCanvasRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是剧集所属项目的唯一标识。
	ProjectID string `json:"ProjectID"`
	// CanvasID 是待删除的剧集唯一标识。
	CanvasID string `json:"CanvasID"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewDeleteProjectCanvasRequest() *DeleteProjectCanvasRequest {
	return &DeleteProjectCanvasRequest{}
}

func (p *DeleteProjectCanvasRequest) InitDefault() {
}

var DeleteProjectCanvasRequest_WorkspaceID_DEFAULT string

func (p *DeleteProjectCanvasRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return DeleteProjectCanvasRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *DeleteProjectCanvasRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *DeleteProjectCanvasRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

var DeleteProjectCanvasRequest_Top_DEFAULT *base.TopParam

func (p *DeleteProjectCanvasRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return DeleteProjectCanvasRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *DeleteProjectCanvasRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *DeleteProjectCanvasRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *DeleteProjectCanvasRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DeleteProjectCanvasRequest(%+v)", *p)
}

type UpdateCanvasViewRequest struct {
	WorkspaceID *string         `json:"WorkspaceID,omitempty"`
	ProjectID   string          `json:"ProjectID"`
	CanvasID    string          `json:"CanvasID"`
	DefaultView *CanvasViewMode `json:"DefaultView,omitempty"`
	Top         *base.TopParam  `json:"Top,omitempty"`
}

func NewUpdateCanvasViewRequest() *UpdateCanvasViewRequest {
	return &UpdateCanvasViewRequest{}
}

func (p *UpdateCanvasViewRequest) InitDefault() {
}

var UpdateCanvasViewRequest_WorkspaceID_DEFAULT string

func (p *UpdateCanvasViewRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return UpdateCanvasViewRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *UpdateCanvasViewRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *UpdateCanvasViewRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

var UpdateCanvasViewRequest_DefaultView_DEFAULT CanvasViewMode

func (p *UpdateCanvasViewRequest) GetDefaultView() (v CanvasViewMode) {
	if !p.IsSetDefaultView() {
		return UpdateCanvasViewRequest_DefaultView_DEFAULT
	}
	return *p.DefaultView
}

var UpdateCanvasViewRequest_Top_DEFAULT *base.TopParam

func (p *UpdateCanvasViewRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return UpdateCanvasViewRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *UpdateCanvasViewRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *UpdateCanvasViewRequest) IsSetDefaultView() bool {
	return p.DefaultView != nil
}

func (p *UpdateCanvasViewRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *UpdateCanvasViewRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateCanvasViewRequest(%+v)", *p)
}

// ProjectCanvasVideoArchiveExport 描述一次剧集视频压缩包导出。
type ProjectCanvasVideoArchiveExport struct {
	TaskRunID      string                         `json:"TaskRunID"`
	ProjectID      string                         `json:"ProjectID"`
	CanvasID       string                         `json:"CanvasID"`
	Status         CanvasVideoArchiveExportStatus `json:"Status"`
	InputCount     int32                          `json:"InputCount"`
	OutputFilename string                         `json:"OutputFilename"`
	OutputSize     int64                          `json:"OutputSize"`
	// Path 仅在最低留存承诺期内返回；省略不改变 SUCCEEDED 状态。
	Path                     *string           `json:"Path,omitempty"`
	RetentionGuaranteedUntil *common.Timestamp `json:"RetentionGuaranteedUntil,omitempty"`
	ErrorCode                *string           `json:"ErrorCode,omitempty"`
	ErrorMessage             *string           `json:"ErrorMessage,omitempty"`
	CreatedAt                common.Timestamp  `json:"CreatedAt"`
	StartedAt                *common.Timestamp `json:"StartedAt,omitempty"`
	FinishedAt               *common.Timestamp `json:"FinishedAt,omitempty"`
}

func NewProjectCanvasVideoArchiveExport() *ProjectCanvasVideoArchiveExport {
	return &ProjectCanvasVideoArchiveExport{}
}

func (p *ProjectCanvasVideoArchiveExport) InitDefault() {
}

func (p *ProjectCanvasVideoArchiveExport) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *ProjectCanvasVideoArchiveExport) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *ProjectCanvasVideoArchiveExport) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *ProjectCanvasVideoArchiveExport) GetStatus() (v CanvasVideoArchiveExportStatus) {
	return p.Status
}

func (p *ProjectCanvasVideoArchiveExport) GetInputCount() (v int32) {
	return p.InputCount
}

func (p *ProjectCanvasVideoArchiveExport) GetOutputFilename() (v string) {
	return p.OutputFilename
}

func (p *ProjectCanvasVideoArchiveExport) GetOutputSize() (v int64) {
	return p.OutputSize
}

var ProjectCanvasVideoArchiveExport_Path_DEFAULT string

func (p *ProjectCanvasVideoArchiveExport) GetPath() (v string) {
	if !p.IsSetPath() {
		return ProjectCanvasVideoArchiveExport_Path_DEFAULT
	}
	return *p.Path
}

var ProjectCanvasVideoArchiveExport_RetentionGuaranteedUntil_DEFAULT common.Timestamp

func (p *ProjectCanvasVideoArchiveExport) GetRetentionGuaranteedUntil() (v common.Timestamp) {
	if !p.IsSetRetentionGuaranteedUntil() {
		return ProjectCanvasVideoArchiveExport_RetentionGuaranteedUntil_DEFAULT
	}
	return *p.RetentionGuaranteedUntil
}

var ProjectCanvasVideoArchiveExport_ErrorCode_DEFAULT string

func (p *ProjectCanvasVideoArchiveExport) GetErrorCode() (v string) {
	if !p.IsSetErrorCode() {
		return ProjectCanvasVideoArchiveExport_ErrorCode_DEFAULT
	}
	return *p.ErrorCode
}

var ProjectCanvasVideoArchiveExport_ErrorMessage_DEFAULT string

func (p *ProjectCanvasVideoArchiveExport) GetErrorMessage() (v string) {
	if !p.IsSetErrorMessage() {
		return ProjectCanvasVideoArchiveExport_ErrorMessage_DEFAULT
	}
	return *p.ErrorMessage
}

func (p *ProjectCanvasVideoArchiveExport) GetCreatedAt() (v common.Timestamp) {
	return p.CreatedAt
}

var ProjectCanvasVideoArchiveExport_StartedAt_DEFAULT common.Timestamp

func (p *ProjectCanvasVideoArchiveExport) GetStartedAt() (v common.Timestamp) {
	if !p.IsSetStartedAt() {
		return ProjectCanvasVideoArchiveExport_StartedAt_DEFAULT
	}
	return *p.StartedAt
}

var ProjectCanvasVideoArchiveExport_FinishedAt_DEFAULT common.Timestamp

func (p *ProjectCanvasVideoArchiveExport) GetFinishedAt() (v common.Timestamp) {
	if !p.IsSetFinishedAt() {
		return ProjectCanvasVideoArchiveExport_FinishedAt_DEFAULT
	}
	return *p.FinishedAt
}

func (p *ProjectCanvasVideoArchiveExport) IsSetPath() bool {
	return p.Path != nil
}

func (p *ProjectCanvasVideoArchiveExport) IsSetRetentionGuaranteedUntil() bool {
	return p.RetentionGuaranteedUntil != nil
}

func (p *ProjectCanvasVideoArchiveExport) IsSetErrorCode() bool {
	return p.ErrorCode != nil
}

func (p *ProjectCanvasVideoArchiveExport) IsSetErrorMessage() bool {
	return p.ErrorMessage != nil
}

func (p *ProjectCanvasVideoArchiveExport) IsSetStartedAt() bool {
	return p.StartedAt != nil
}

func (p *ProjectCanvasVideoArchiveExport) IsSetFinishedAt() bool {
	return p.FinishedAt != nil
}

func (p *ProjectCanvasVideoArchiveExport) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectCanvasVideoArchiveExport(%+v)", *p)
}

type StartProjectCanvasVideoArchiveExportRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	ProjectID   string         `json:"ProjectID"`
	CanvasID    string         `json:"CanvasID"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewStartProjectCanvasVideoArchiveExportRequest() *StartProjectCanvasVideoArchiveExportRequest {
	return &StartProjectCanvasVideoArchiveExportRequest{}
}

func (p *StartProjectCanvasVideoArchiveExportRequest) InitDefault() {
}

var StartProjectCanvasVideoArchiveExportRequest_WorkspaceID_DEFAULT string

func (p *StartProjectCanvasVideoArchiveExportRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return StartProjectCanvasVideoArchiveExportRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *StartProjectCanvasVideoArchiveExportRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *StartProjectCanvasVideoArchiveExportRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

var StartProjectCanvasVideoArchiveExportRequest_Top_DEFAULT *base.TopParam

func (p *StartProjectCanvasVideoArchiveExportRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return StartProjectCanvasVideoArchiveExportRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *StartProjectCanvasVideoArchiveExportRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *StartProjectCanvasVideoArchiveExportRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *StartProjectCanvasVideoArchiveExportRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StartProjectCanvasVideoArchiveExportRequest(%+v)", *p)
}

type StartProjectCanvasVideoArchiveExportResponse struct {
	Export *ProjectCanvasVideoArchiveExport `json:"Export"`
}

func NewStartProjectCanvasVideoArchiveExportResponse() *StartProjectCanvasVideoArchiveExportResponse {
	return &StartProjectCanvasVideoArchiveExportResponse{}
}

func (p *StartProjectCanvasVideoArchiveExportResponse) InitDefault() {
}

var StartProjectCanvasVideoArchiveExportResponse_Export_DEFAULT *ProjectCanvasVideoArchiveExport

func (p *StartProjectCanvasVideoArchiveExportResponse) GetExport() (v *ProjectCanvasVideoArchiveExport) {
	if !p.IsSetExport() {
		return StartProjectCanvasVideoArchiveExportResponse_Export_DEFAULT
	}
	return p.Export
}

func (p *StartProjectCanvasVideoArchiveExportResponse) IsSetExport() bool {
	return p.Export != nil
}

func (p *StartProjectCanvasVideoArchiveExportResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StartProjectCanvasVideoArchiveExportResponse(%+v)", *p)
}

type GetProjectCanvasVideoArchiveExportRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	ProjectID   string         `json:"ProjectID"`
	CanvasID    string         `json:"CanvasID"`
	TaskRunID   string         `json:"TaskRunID"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewGetProjectCanvasVideoArchiveExportRequest() *GetProjectCanvasVideoArchiveExportRequest {
	return &GetProjectCanvasVideoArchiveExportRequest{}
}

func (p *GetProjectCanvasVideoArchiveExportRequest) InitDefault() {
}

var GetProjectCanvasVideoArchiveExportRequest_WorkspaceID_DEFAULT string

func (p *GetProjectCanvasVideoArchiveExportRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return GetProjectCanvasVideoArchiveExportRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *GetProjectCanvasVideoArchiveExportRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *GetProjectCanvasVideoArchiveExportRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *GetProjectCanvasVideoArchiveExportRequest) GetTaskRunID() (v string) {
	return p.TaskRunID
}

var GetProjectCanvasVideoArchiveExportRequest_Top_DEFAULT *base.TopParam

func (p *GetProjectCanvasVideoArchiveExportRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return GetProjectCanvasVideoArchiveExportRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *GetProjectCanvasVideoArchiveExportRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *GetProjectCanvasVideoArchiveExportRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *GetProjectCanvasVideoArchiveExportRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetProjectCanvasVideoArchiveExportRequest(%+v)", *p)
}

type GetProjectCanvasVideoArchiveExportResponse struct {
	Export *ProjectCanvasVideoArchiveExport `json:"Export"`
}

func NewGetProjectCanvasVideoArchiveExportResponse() *GetProjectCanvasVideoArchiveExportResponse {
	return &GetProjectCanvasVideoArchiveExportResponse{}
}

func (p *GetProjectCanvasVideoArchiveExportResponse) InitDefault() {
}

var GetProjectCanvasVideoArchiveExportResponse_Export_DEFAULT *ProjectCanvasVideoArchiveExport

func (p *GetProjectCanvasVideoArchiveExportResponse) GetExport() (v *ProjectCanvasVideoArchiveExport) {
	if !p.IsSetExport() {
		return GetProjectCanvasVideoArchiveExportResponse_Export_DEFAULT
	}
	return p.Export
}

func (p *GetProjectCanvasVideoArchiveExportResponse) IsSetExport() bool {
	return p.Export != nil
}

func (p *GetProjectCanvasVideoArchiveExportResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetProjectCanvasVideoArchiveExportResponse(%+v)", *p)
}

type BatchGetProjectCanvasVideoArchiveExportsRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	// TaskRunIDs 最多包含 100 个导出任务 ID。
	TaskRunIDs []string       `json:"TaskRunIDs"`
	Top        *base.TopParam `json:"Top,omitempty"`
}

func NewBatchGetProjectCanvasVideoArchiveExportsRequest() *BatchGetProjectCanvasVideoArchiveExportsRequest {
	return &BatchGetProjectCanvasVideoArchiveExportsRequest{}
}

func (p *BatchGetProjectCanvasVideoArchiveExportsRequest) InitDefault() {
}

var BatchGetProjectCanvasVideoArchiveExportsRequest_WorkspaceID_DEFAULT string

func (p *BatchGetProjectCanvasVideoArchiveExportsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchGetProjectCanvasVideoArchiveExportsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchGetProjectCanvasVideoArchiveExportsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *BatchGetProjectCanvasVideoArchiveExportsRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *BatchGetProjectCanvasVideoArchiveExportsRequest) GetTaskRunIDs() (v []string) {
	return p.TaskRunIDs
}

var BatchGetProjectCanvasVideoArchiveExportsRequest_Top_DEFAULT *base.TopParam

func (p *BatchGetProjectCanvasVideoArchiveExportsRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return BatchGetProjectCanvasVideoArchiveExportsRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *BatchGetProjectCanvasVideoArchiveExportsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchGetProjectCanvasVideoArchiveExportsRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *BatchGetProjectCanvasVideoArchiveExportsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetProjectCanvasVideoArchiveExportsRequest(%+v)", *p)
}

type BatchGetProjectCanvasVideoArchiveExportsResponse struct {
	Items []*ProjectCanvasVideoArchiveExport `json:"Items"`
}

func NewBatchGetProjectCanvasVideoArchiveExportsResponse() *BatchGetProjectCanvasVideoArchiveExportsResponse {
	return &BatchGetProjectCanvasVideoArchiveExportsResponse{}
}

func (p *BatchGetProjectCanvasVideoArchiveExportsResponse) InitDefault() {
}

func (p *BatchGetProjectCanvasVideoArchiveExportsResponse) GetItems() (v []*ProjectCanvasVideoArchiveExport) {
	return p.Items
}

func (p *BatchGetProjectCanvasVideoArchiveExportsResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetProjectCanvasVideoArchiveExportsResponse(%+v)", *p)
}

// ProjectCanvasVideoArchiveExportSort 定义视频压缩包导出列表的排序参数。
type ProjectCanvasVideoArchiveExportSort struct {
	Field     *ProjectCanvasVideoArchiveExportSortField `json:"Field,omitempty"`
	Direction *common.SortDirection                     `json:"Direction,omitempty"`
}

func NewProjectCanvasVideoArchiveExportSort() *ProjectCanvasVideoArchiveExportSort {
	return &ProjectCanvasVideoArchiveExportSort{}
}

func (p *ProjectCanvasVideoArchiveExportSort) InitDefault() {
}

var ProjectCanvasVideoArchiveExportSort_Field_DEFAULT ProjectCanvasVideoArchiveExportSortField

func (p *ProjectCanvasVideoArchiveExportSort) GetField() (v ProjectCanvasVideoArchiveExportSortField) {
	if !p.IsSetField() {
		return ProjectCanvasVideoArchiveExportSort_Field_DEFAULT
	}
	return *p.Field
}

var ProjectCanvasVideoArchiveExportSort_Direction_DEFAULT common.SortDirection

func (p *ProjectCanvasVideoArchiveExportSort) GetDirection() (v common.SortDirection) {
	if !p.IsSetDirection() {
		return ProjectCanvasVideoArchiveExportSort_Direction_DEFAULT
	}
	return *p.Direction
}

func (p *ProjectCanvasVideoArchiveExportSort) IsSetField() bool {
	return p.Field != nil
}

func (p *ProjectCanvasVideoArchiveExportSort) IsSetDirection() bool {
	return p.Direction != nil
}

func (p *ProjectCanvasVideoArchiveExportSort) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectCanvasVideoArchiveExportSort(%+v)", *p)
}

// ListProjectCanvasVideoArchiveExportsRequest 是分页查询剧集视频压缩包导出的请求。
type ListProjectCanvasVideoArchiveExportsRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	// Sort 指定排序字段与方向；省略时默认按发起时间倒序。
	Sort *ProjectCanvasVideoArchiveExportSort `json:"Sort,omitempty"`
	Page *common.Page                         `json:"Page"`
	Top  *base.TopParam                       `json:"Top,omitempty"`
}

func NewListProjectCanvasVideoArchiveExportsRequest() *ListProjectCanvasVideoArchiveExportsRequest {
	return &ListProjectCanvasVideoArchiveExportsRequest{}
}

func (p *ListProjectCanvasVideoArchiveExportsRequest) InitDefault() {
}

var ListProjectCanvasVideoArchiveExportsRequest_WorkspaceID_DEFAULT string

func (p *ListProjectCanvasVideoArchiveExportsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return ListProjectCanvasVideoArchiveExportsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *ListProjectCanvasVideoArchiveExportsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *ListProjectCanvasVideoArchiveExportsRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

var ListProjectCanvasVideoArchiveExportsRequest_Sort_DEFAULT *ProjectCanvasVideoArchiveExportSort

func (p *ListProjectCanvasVideoArchiveExportsRequest) GetSort() (v *ProjectCanvasVideoArchiveExportSort) {
	if !p.IsSetSort() {
		return ListProjectCanvasVideoArchiveExportsRequest_Sort_DEFAULT
	}
	return p.Sort
}

var ListProjectCanvasVideoArchiveExportsRequest_Page_DEFAULT *common.Page

func (p *ListProjectCanvasVideoArchiveExportsRequest) GetPage() (v *common.Page) {
	if !p.IsSetPage() {
		return ListProjectCanvasVideoArchiveExportsRequest_Page_DEFAULT
	}
	return p.Page
}

var ListProjectCanvasVideoArchiveExportsRequest_Top_DEFAULT *base.TopParam

func (p *ListProjectCanvasVideoArchiveExportsRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return ListProjectCanvasVideoArchiveExportsRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *ListProjectCanvasVideoArchiveExportsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *ListProjectCanvasVideoArchiveExportsRequest) IsSetSort() bool {
	return p.Sort != nil
}

func (p *ListProjectCanvasVideoArchiveExportsRequest) IsSetPage() bool {
	return p.Page != nil
}

func (p *ListProjectCanvasVideoArchiveExportsRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *ListProjectCanvasVideoArchiveExportsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListProjectCanvasVideoArchiveExportsRequest(%+v)", *p)
}

// ListProjectCanvasVideoArchiveExportsResponse 是剧集视频压缩包导出列表响应。
type ListProjectCanvasVideoArchiveExportsResponse struct {
	Items []*ProjectCanvasVideoArchiveExport `json:"Items"`
	Page  *common.PageOutput                 `json:"Page"`
}

func NewListProjectCanvasVideoArchiveExportsResponse() *ListProjectCanvasVideoArchiveExportsResponse {
	return &ListProjectCanvasVideoArchiveExportsResponse{}
}

func (p *ListProjectCanvasVideoArchiveExportsResponse) InitDefault() {
}

func (p *ListProjectCanvasVideoArchiveExportsResponse) GetItems() (v []*ProjectCanvasVideoArchiveExport) {
	return p.Items
}

var ListProjectCanvasVideoArchiveExportsResponse_Page_DEFAULT *common.PageOutput

func (p *ListProjectCanvasVideoArchiveExportsResponse) GetPage() (v *common.PageOutput) {
	if !p.IsSetPage() {
		return ListProjectCanvasVideoArchiveExportsResponse_Page_DEFAULT
	}
	return p.Page
}

func (p *ListProjectCanvasVideoArchiveExportsResponse) IsSetPage() bool {
	return p.Page != nil
}

func (p *ListProjectCanvasVideoArchiveExportsResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListProjectCanvasVideoArchiveExportsResponse(%+v)", *p)
}

type CancelProjectCanvasVideoArchiveExportRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	ProjectID   string         `json:"ProjectID"`
	CanvasID    string         `json:"CanvasID"`
	TaskRunID   string         `json:"TaskRunID"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewCancelProjectCanvasVideoArchiveExportRequest() *CancelProjectCanvasVideoArchiveExportRequest {
	return &CancelProjectCanvasVideoArchiveExportRequest{}
}

func (p *CancelProjectCanvasVideoArchiveExportRequest) InitDefault() {
}

var CancelProjectCanvasVideoArchiveExportRequest_WorkspaceID_DEFAULT string

func (p *CancelProjectCanvasVideoArchiveExportRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CancelProjectCanvasVideoArchiveExportRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CancelProjectCanvasVideoArchiveExportRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CancelProjectCanvasVideoArchiveExportRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *CancelProjectCanvasVideoArchiveExportRequest) GetTaskRunID() (v string) {
	return p.TaskRunID
}

var CancelProjectCanvasVideoArchiveExportRequest_Top_DEFAULT *base.TopParam

func (p *CancelProjectCanvasVideoArchiveExportRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return CancelProjectCanvasVideoArchiveExportRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *CancelProjectCanvasVideoArchiveExportRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CancelProjectCanvasVideoArchiveExportRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *CancelProjectCanvasVideoArchiveExportRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CancelProjectCanvasVideoArchiveExportRequest(%+v)", *p)
}
