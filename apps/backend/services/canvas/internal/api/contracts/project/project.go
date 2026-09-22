package project

import (
	"database/sql"
	"database/sql/driver"
	"fmt"
	"github.com/example/monorepo/canvas/internal/api/contracts/aigw_model_types"
	"github.com/example/monorepo/canvas/internal/api/contracts/base"
	"github.com/example/monorepo/canvas/internal/api/contracts/common"
)

// ProjectSortField 定义项目列表支持的排序字段。
type ProjectSortField int64

const (
	ProjectSortField_UPDATED_AT ProjectSortField = 1
)

func (p ProjectSortField) String() string {
	switch p {
	case ProjectSortField_UPDATED_AT:
		return "UPDATED_AT"
	}
	return "<UNSET>"
}

func ProjectSortFieldFromString(s string) (ProjectSortField, error) {
	switch s {
	case "UPDATED_AT":
		return ProjectSortField_UPDATED_AT, nil
	}
	return ProjectSortField(0), fmt.Errorf("not a valid ProjectSortField string")
}

func ProjectSortFieldPtr(v ProjectSortField) *ProjectSortField { return &v }
func (p *ProjectSortField) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = ProjectSortField(result.Int64)
	return
}

func (p *ProjectSortField) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// ProjectStats 汇总项目下的业务统计信息。
type ProjectStats struct {
	// CanvasCount 是项目内的剧集数量。
	CanvasCount int32 `json:"CanvasCount"`
	// SelectedVideoDurationMillis 是已选视频片段的总时长，单位为毫秒。
	SelectedVideoDurationMillis int64 `json:"SelectedVideoDurationMillis"`
	// ResourceCount 是项目资产库中由该项目拥有的资产数量，不包含预置资产。
	ResourceCount int32 `json:"ResourceCount"`
}

func NewProjectStats() *ProjectStats {
	return &ProjectStats{}
}

func (p *ProjectStats) InitDefault() {
}

func (p *ProjectStats) GetCanvasCount() (v int32) {
	return p.CanvasCount
}

func (p *ProjectStats) GetSelectedVideoDurationMillis() (v int64) {
	return p.SelectedVideoDurationMillis
}

func (p *ProjectStats) GetResourceCount() (v int32) {
	return p.ResourceCount
}

func (p *ProjectStats) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectStats(%+v)", *p)
}

// ProjectSummary 是项目列表返回的摘要信息。
type ProjectSummary struct {
	// ProjectID 是项目唯一标识。
	ProjectID string `json:"ProjectID"`
	// Name 是项目名称，在相同 scope 下唯一。
	Name string `json:"Name"`
	// CoverImagePath 是已通过 Up 长期化的封面图片 path。
	CoverImagePath *string `json:"CoverImagePath,omitempty"`
	// CreatedBy 是项目创建用户 ID。
	CreatedBy string `json:"CreatedBy"`
	// CreatedAt 是项目创建时间。
	CreatedAt common.Timestamp `json:"CreatedAt"`
	// UpdatedAt 是项目最后更新时间。
	UpdatedAt common.Timestamp `json:"UpdatedAt"`
	// Stats 是项目统计信息。
	Stats *ProjectStats `json:"Stats"`
	// MemberUserIDs 是项目成员用户 ID 列表；仅管理接口返回。
	MemberUserIDs []string `json:"MemberUserIDs"`
}

func NewProjectSummary() *ProjectSummary {
	return &ProjectSummary{}
}

func (p *ProjectSummary) InitDefault() {
}

func (p *ProjectSummary) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *ProjectSummary) GetName() (v string) {
	return p.Name
}

var ProjectSummary_CoverImagePath_DEFAULT string

func (p *ProjectSummary) GetCoverImagePath() (v string) {
	if !p.IsSetCoverImagePath() {
		return ProjectSummary_CoverImagePath_DEFAULT
	}
	return *p.CoverImagePath
}

func (p *ProjectSummary) GetCreatedBy() (v string) {
	return p.CreatedBy
}

func (p *ProjectSummary) GetCreatedAt() (v common.Timestamp) {
	return p.CreatedAt
}

func (p *ProjectSummary) GetUpdatedAt() (v common.Timestamp) {
	return p.UpdatedAt
}

var ProjectSummary_Stats_DEFAULT *ProjectStats

func (p *ProjectSummary) GetStats() (v *ProjectStats) {
	if !p.IsSetStats() {
		return ProjectSummary_Stats_DEFAULT
	}
	return p.Stats
}

func (p *ProjectSummary) GetMemberUserIDs() (v []string) {
	return p.MemberUserIDs
}

func (p *ProjectSummary) IsSetCoverImagePath() bool {
	return p.CoverImagePath != nil
}

func (p *ProjectSummary) IsSetStats() bool {
	return p.Stats != nil
}

func (p *ProjectSummary) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectSummary(%+v)", *p)
}

// ProjectDetail 是项目详情信息。
type ProjectDetail struct {
	// ProjectID 是项目唯一标识。
	ProjectID string `json:"ProjectID"`
	// Name 是项目名称，在相同 scope 下唯一。
	Name string `json:"Name"`
	// CoverImagePath 是已通过 Up 长期化的封面图片 path。
	CoverImagePath *string `json:"CoverImagePath,omitempty"`
	// CreatedBy 是项目创建用户 ID。
	CreatedBy string `json:"CreatedBy"`
	// CreatedAt 是项目创建时间。
	CreatedAt common.Timestamp `json:"CreatedAt"`
	// UpdatedAt 是项目最后更新时间。
	UpdatedAt common.Timestamp `json:"UpdatedAt"`
	// Stats 是项目统计信息。
	Stats *ProjectStats `json:"Stats"`
	// MemberUserIDs 是项目成员用户 ID 列表；受限成员写接口使用该列表进行准入检查。
	MemberUserIDs []string `json:"MemberUserIDs"`
	// UsageLimit 是项目总金额限额，单位元；未传表示无上限。
	UsageLimit *int64 `json:"UsageLimit,omitempty"`
	// UsedAmount 是 AIGW 返回的项目当前已用金额，单位元。
	UsedAmount *float64 `json:"UsedAmount,omitempty"`
}

func NewProjectDetail() *ProjectDetail {
	return &ProjectDetail{}
}

func (p *ProjectDetail) InitDefault() {
}

func (p *ProjectDetail) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *ProjectDetail) GetName() (v string) {
	return p.Name
}

var ProjectDetail_CoverImagePath_DEFAULT string

func (p *ProjectDetail) GetCoverImagePath() (v string) {
	if !p.IsSetCoverImagePath() {
		return ProjectDetail_CoverImagePath_DEFAULT
	}
	return *p.CoverImagePath
}

func (p *ProjectDetail) GetCreatedBy() (v string) {
	return p.CreatedBy
}

func (p *ProjectDetail) GetCreatedAt() (v common.Timestamp) {
	return p.CreatedAt
}

func (p *ProjectDetail) GetUpdatedAt() (v common.Timestamp) {
	return p.UpdatedAt
}

var ProjectDetail_Stats_DEFAULT *ProjectStats

func (p *ProjectDetail) GetStats() (v *ProjectStats) {
	if !p.IsSetStats() {
		return ProjectDetail_Stats_DEFAULT
	}
	return p.Stats
}

func (p *ProjectDetail) GetMemberUserIDs() (v []string) {
	return p.MemberUserIDs
}

var ProjectDetail_UsageLimit_DEFAULT int64

func (p *ProjectDetail) GetUsageLimit() (v int64) {
	if !p.IsSetUsageLimit() {
		return ProjectDetail_UsageLimit_DEFAULT
	}
	return *p.UsageLimit
}

var ProjectDetail_UsedAmount_DEFAULT float64

func (p *ProjectDetail) GetUsedAmount() (v float64) {
	if !p.IsSetUsedAmount() {
		return ProjectDetail_UsedAmount_DEFAULT
	}
	return *p.UsedAmount
}

func (p *ProjectDetail) IsSetCoverImagePath() bool {
	return p.CoverImagePath != nil
}

func (p *ProjectDetail) IsSetStats() bool {
	return p.Stats != nil
}

func (p *ProjectDetail) IsSetUsageLimit() bool {
	return p.UsageLimit != nil
}

func (p *ProjectDetail) IsSetUsedAmount() bool {
	return p.UsedAmount != nil
}

func (p *ProjectDetail) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectDetail(%+v)", *p)
}

// MemberProjectSummary 是成员项目列表返回的摘要信息，不包含项目成员列表。
type MemberProjectSummary struct {
	ProjectID      string           `json:"ProjectID"`
	Name           string           `json:"Name"`
	CoverImagePath *string          `json:"CoverImagePath,omitempty"`
	CreatedBy      string           `json:"CreatedBy"`
	CreatedAt      common.Timestamp `json:"CreatedAt"`
	UpdatedAt      common.Timestamp `json:"UpdatedAt"`
	Stats          *ProjectStats    `json:"Stats"`
}

func NewMemberProjectSummary() *MemberProjectSummary {
	return &MemberProjectSummary{}
}

func (p *MemberProjectSummary) InitDefault() {
}

func (p *MemberProjectSummary) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *MemberProjectSummary) GetName() (v string) {
	return p.Name
}

var MemberProjectSummary_CoverImagePath_DEFAULT string

func (p *MemberProjectSummary) GetCoverImagePath() (v string) {
	if !p.IsSetCoverImagePath() {
		return MemberProjectSummary_CoverImagePath_DEFAULT
	}
	return *p.CoverImagePath
}

func (p *MemberProjectSummary) GetCreatedBy() (v string) {
	return p.CreatedBy
}

func (p *MemberProjectSummary) GetCreatedAt() (v common.Timestamp) {
	return p.CreatedAt
}

func (p *MemberProjectSummary) GetUpdatedAt() (v common.Timestamp) {
	return p.UpdatedAt
}

var MemberProjectSummary_Stats_DEFAULT *ProjectStats

func (p *MemberProjectSummary) GetStats() (v *ProjectStats) {
	if !p.IsSetStats() {
		return MemberProjectSummary_Stats_DEFAULT
	}
	return p.Stats
}

func (p *MemberProjectSummary) IsSetCoverImagePath() bool {
	return p.CoverImagePath != nil
}

func (p *MemberProjectSummary) IsSetStats() bool {
	return p.Stats != nil
}

func (p *MemberProjectSummary) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("MemberProjectSummary(%+v)", *p)
}

// MemberProjectDetail 是成员项目详情，不包含项目成员列表。
type MemberProjectDetail struct {
	ProjectID      string           `json:"ProjectID"`
	Name           string           `json:"Name"`
	CoverImagePath *string          `json:"CoverImagePath,omitempty"`
	CreatedBy      string           `json:"CreatedBy"`
	CreatedAt      common.Timestamp `json:"CreatedAt"`
	UpdatedAt      common.Timestamp `json:"UpdatedAt"`
	Stats          *ProjectStats    `json:"Stats"`
}

func NewMemberProjectDetail() *MemberProjectDetail {
	return &MemberProjectDetail{}
}

func (p *MemberProjectDetail) InitDefault() {
}

func (p *MemberProjectDetail) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *MemberProjectDetail) GetName() (v string) {
	return p.Name
}

var MemberProjectDetail_CoverImagePath_DEFAULT string

func (p *MemberProjectDetail) GetCoverImagePath() (v string) {
	if !p.IsSetCoverImagePath() {
		return MemberProjectDetail_CoverImagePath_DEFAULT
	}
	return *p.CoverImagePath
}

func (p *MemberProjectDetail) GetCreatedBy() (v string) {
	return p.CreatedBy
}

func (p *MemberProjectDetail) GetCreatedAt() (v common.Timestamp) {
	return p.CreatedAt
}

func (p *MemberProjectDetail) GetUpdatedAt() (v common.Timestamp) {
	return p.UpdatedAt
}

var MemberProjectDetail_Stats_DEFAULT *ProjectStats

func (p *MemberProjectDetail) GetStats() (v *ProjectStats) {
	if !p.IsSetStats() {
		return MemberProjectDetail_Stats_DEFAULT
	}
	return p.Stats
}

func (p *MemberProjectDetail) IsSetCoverImagePath() bool {
	return p.CoverImagePath != nil
}

func (p *MemberProjectDetail) IsSetStats() bool {
	return p.Stats != nil
}

func (p *MemberProjectDetail) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("MemberProjectDetail(%+v)", *p)
}

// ProjectFilter 是项目列表的过滤条件。
type ProjectFilter struct {
	// Keyword 按项目名称进行模糊查询。
	Keyword *string `json:"Keyword,omitempty"`
}

func NewProjectFilter() *ProjectFilter {
	return &ProjectFilter{}
}

func (p *ProjectFilter) InitDefault() {
}

var ProjectFilter_Keyword_DEFAULT string

func (p *ProjectFilter) GetKeyword() (v string) {
	if !p.IsSetKeyword() {
		return ProjectFilter_Keyword_DEFAULT
	}
	return *p.Keyword
}

func (p *ProjectFilter) IsSetKeyword() bool {
	return p.Keyword != nil
}

func (p *ProjectFilter) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectFilter(%+v)", *p)
}

// ProjectSort 定义项目列表的排序参数。
type ProjectSort struct {
	Field     *ProjectSortField     `json:"Field,omitempty"`
	Direction *common.SortDirection `json:"Direction,omitempty"`
}

func NewProjectSort() *ProjectSort {
	return &ProjectSort{}
}

func (p *ProjectSort) InitDefault() {
}

var ProjectSort_Field_DEFAULT ProjectSortField

func (p *ProjectSort) GetField() (v ProjectSortField) {
	if !p.IsSetField() {
		return ProjectSort_Field_DEFAULT
	}
	return *p.Field
}

var ProjectSort_Direction_DEFAULT common.SortDirection

func (p *ProjectSort) GetDirection() (v common.SortDirection) {
	if !p.IsSetDirection() {
		return ProjectSort_Direction_DEFAULT
	}
	return *p.Direction
}

func (p *ProjectSort) IsSetField() bool {
	return p.Field != nil
}

func (p *ProjectSort) IsSetDirection() bool {
	return p.Direction != nil
}

func (p *ProjectSort) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectSort(%+v)", *p)
}

// ListProjectsRequest 是查询项目列表的请求。
type ListProjectsRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// Filter 是项目列表的过滤条件。
	Filter *ProjectFilter `json:"Filter,omitempty"`
	// Sort 指定排序字段与方向；省略时默认按更新时间倒序。
	Sort *ProjectSort `json:"Sort,omitempty"`
	// Page 是标准分页参数。
	Page *common.Page `json:"Page"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewListProjectsRequest() *ListProjectsRequest {
	return &ListProjectsRequest{}
}

func (p *ListProjectsRequest) InitDefault() {
}

var ListProjectsRequest_WorkspaceID_DEFAULT string

func (p *ListProjectsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return ListProjectsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

var ListProjectsRequest_Filter_DEFAULT *ProjectFilter

func (p *ListProjectsRequest) GetFilter() (v *ProjectFilter) {
	if !p.IsSetFilter() {
		return ListProjectsRequest_Filter_DEFAULT
	}
	return p.Filter
}

var ListProjectsRequest_Sort_DEFAULT *ProjectSort

func (p *ListProjectsRequest) GetSort() (v *ProjectSort) {
	if !p.IsSetSort() {
		return ListProjectsRequest_Sort_DEFAULT
	}
	return p.Sort
}

var ListProjectsRequest_Page_DEFAULT *common.Page

func (p *ListProjectsRequest) GetPage() (v *common.Page) {
	if !p.IsSetPage() {
		return ListProjectsRequest_Page_DEFAULT
	}
	return p.Page
}

var ListProjectsRequest_Top_DEFAULT *base.TopParam

func (p *ListProjectsRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return ListProjectsRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *ListProjectsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *ListProjectsRequest) IsSetFilter() bool {
	return p.Filter != nil
}

func (p *ListProjectsRequest) IsSetSort() bool {
	return p.Sort != nil
}

func (p *ListProjectsRequest) IsSetPage() bool {
	return p.Page != nil
}

func (p *ListProjectsRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *ListProjectsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListProjectsRequest(%+v)", *p)
}

// ListProjectsResponse 是查询项目列表的响应。
type ListProjectsResponse struct {
	// Items 是当前页的项目摘要。
	Items []*ProjectSummary `json:"Items"`
	// Page 是当前查询的分页信息。
	Page *common.PageOutput `json:"Page"`
}

func NewListProjectsResponse() *ListProjectsResponse {
	return &ListProjectsResponse{}
}

func (p *ListProjectsResponse) InitDefault() {
}

func (p *ListProjectsResponse) GetItems() (v []*ProjectSummary) {
	return p.Items
}

var ListProjectsResponse_Page_DEFAULT *common.PageOutput

func (p *ListProjectsResponse) GetPage() (v *common.PageOutput) {
	if !p.IsSetPage() {
		return ListProjectsResponse_Page_DEFAULT
	}
	return p.Page
}

func (p *ListProjectsResponse) IsSetPage() bool {
	return p.Page != nil
}

func (p *ListProjectsResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListProjectsResponse(%+v)", *p)
}

// GetProjectRequest 是获取单个项目的请求。
type GetProjectRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是待查询的项目唯一标识。
	ProjectID string `json:"ProjectID"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewGetProjectRequest() *GetProjectRequest {
	return &GetProjectRequest{}
}

func (p *GetProjectRequest) InitDefault() {
}

var GetProjectRequest_WorkspaceID_DEFAULT string

func (p *GetProjectRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return GetProjectRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *GetProjectRequest) GetProjectID() (v string) {
	return p.ProjectID
}

var GetProjectRequest_Top_DEFAULT *base.TopParam

func (p *GetProjectRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return GetProjectRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *GetProjectRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *GetProjectRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *GetProjectRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetProjectRequest(%+v)", *p)
}

// GetProjectResponse 是获取单个项目的响应。
type GetProjectResponse struct {
	// Project 是当前 scope 下命中的项目详情。
	Project *ProjectDetail `json:"Project"`
}

func NewGetProjectResponse() *GetProjectResponse {
	return &GetProjectResponse{}
}

func (p *GetProjectResponse) InitDefault() {
}

var GetProjectResponse_Project_DEFAULT *ProjectDetail

func (p *GetProjectResponse) GetProject() (v *ProjectDetail) {
	if !p.IsSetProject() {
		return GetProjectResponse_Project_DEFAULT
	}
	return p.Project
}

func (p *GetProjectResponse) IsSetProject() bool {
	return p.Project != nil
}

func (p *GetProjectResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetProjectResponse(%+v)", *p)
}

// BatchGetProjectsRequest 是批量获取项目的请求。
type BatchGetProjectsRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectIDs 最多包含 100 个项目 ID。
	ProjectIDs []string `json:"ProjectIDs"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewBatchGetProjectsRequest() *BatchGetProjectsRequest {
	return &BatchGetProjectsRequest{}
}

func (p *BatchGetProjectsRequest) InitDefault() {
}

var BatchGetProjectsRequest_WorkspaceID_DEFAULT string

func (p *BatchGetProjectsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchGetProjectsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchGetProjectsRequest) GetProjectIDs() (v []string) {
	return p.ProjectIDs
}

var BatchGetProjectsRequest_Top_DEFAULT *base.TopParam

func (p *BatchGetProjectsRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return BatchGetProjectsRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *BatchGetProjectsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchGetProjectsRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *BatchGetProjectsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetProjectsRequest(%+v)", *p)
}

// BatchGetProjectsResponse 是批量获取项目的响应。
type BatchGetProjectsResponse struct {
	// Items 按请求 ID 首次出现顺序返回实际命中的项目，不存在或不可见的项目不返回。
	Items []*ProjectDetail `json:"Items"`
}

func NewBatchGetProjectsResponse() *BatchGetProjectsResponse {
	return &BatchGetProjectsResponse{}
}

func (p *BatchGetProjectsResponse) InitDefault() {
}

func (p *BatchGetProjectsResponse) GetItems() (v []*ProjectDetail) {
	return p.Items
}

func (p *BatchGetProjectsResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetProjectsResponse(%+v)", *p)
}

// ListProjectsByMemberRequest 是按当前调用者成员关系查询项目列表的请求。
type ListProjectsByMemberRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	Filter      *ProjectFilter `json:"Filter,omitempty"`
	Sort        *ProjectSort   `json:"Sort,omitempty"`
	Page        *common.Page   `json:"Page"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewListProjectsByMemberRequest() *ListProjectsByMemberRequest {
	return &ListProjectsByMemberRequest{}
}

func (p *ListProjectsByMemberRequest) InitDefault() {
}

var ListProjectsByMemberRequest_WorkspaceID_DEFAULT string

func (p *ListProjectsByMemberRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return ListProjectsByMemberRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

var ListProjectsByMemberRequest_Filter_DEFAULT *ProjectFilter

func (p *ListProjectsByMemberRequest) GetFilter() (v *ProjectFilter) {
	if !p.IsSetFilter() {
		return ListProjectsByMemberRequest_Filter_DEFAULT
	}
	return p.Filter
}

var ListProjectsByMemberRequest_Sort_DEFAULT *ProjectSort

func (p *ListProjectsByMemberRequest) GetSort() (v *ProjectSort) {
	if !p.IsSetSort() {
		return ListProjectsByMemberRequest_Sort_DEFAULT
	}
	return p.Sort
}

var ListProjectsByMemberRequest_Page_DEFAULT *common.Page

func (p *ListProjectsByMemberRequest) GetPage() (v *common.Page) {
	if !p.IsSetPage() {
		return ListProjectsByMemberRequest_Page_DEFAULT
	}
	return p.Page
}

var ListProjectsByMemberRequest_Top_DEFAULT *base.TopParam

func (p *ListProjectsByMemberRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return ListProjectsByMemberRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *ListProjectsByMemberRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *ListProjectsByMemberRequest) IsSetFilter() bool {
	return p.Filter != nil
}

func (p *ListProjectsByMemberRequest) IsSetSort() bool {
	return p.Sort != nil
}

func (p *ListProjectsByMemberRequest) IsSetPage() bool {
	return p.Page != nil
}

func (p *ListProjectsByMemberRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *ListProjectsByMemberRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListProjectsByMemberRequest(%+v)", *p)
}

// ListProjectsByMemberResponse 只返回当前调用者作为成员加入的项目。
type ListProjectsByMemberResponse struct {
	Items []*MemberProjectSummary `json:"Items"`
	Page  *common.PageOutput      `json:"Page"`
}

func NewListProjectsByMemberResponse() *ListProjectsByMemberResponse {
	return &ListProjectsByMemberResponse{}
}

func (p *ListProjectsByMemberResponse) InitDefault() {
}

func (p *ListProjectsByMemberResponse) GetItems() (v []*MemberProjectSummary) {
	return p.Items
}

var ListProjectsByMemberResponse_Page_DEFAULT *common.PageOutput

func (p *ListProjectsByMemberResponse) GetPage() (v *common.PageOutput) {
	if !p.IsSetPage() {
		return ListProjectsByMemberResponse_Page_DEFAULT
	}
	return p.Page
}

func (p *ListProjectsByMemberResponse) IsSetPage() bool {
	return p.Page != nil
}

func (p *ListProjectsByMemberResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListProjectsByMemberResponse(%+v)", *p)
}

// GetProjectByMemberRequest 是按当前调用者成员关系获取项目的请求。
type GetProjectByMemberRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	ProjectID   string         `json:"ProjectID"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewGetProjectByMemberRequest() *GetProjectByMemberRequest {
	return &GetProjectByMemberRequest{}
}

func (p *GetProjectByMemberRequest) InitDefault() {
}

var GetProjectByMemberRequest_WorkspaceID_DEFAULT string

func (p *GetProjectByMemberRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return GetProjectByMemberRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *GetProjectByMemberRequest) GetProjectID() (v string) {
	return p.ProjectID
}

var GetProjectByMemberRequest_Top_DEFAULT *base.TopParam

func (p *GetProjectByMemberRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return GetProjectByMemberRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *GetProjectByMemberRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *GetProjectByMemberRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *GetProjectByMemberRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetProjectByMemberRequest(%+v)", *p)
}

// GetProjectByMemberResponse 返回不包含成员列表的项目详情。
type GetProjectByMemberResponse struct {
	Project *MemberProjectDetail `json:"Project"`
}

func NewGetProjectByMemberResponse() *GetProjectByMemberResponse {
	return &GetProjectByMemberResponse{}
}

func (p *GetProjectByMemberResponse) InitDefault() {
}

var GetProjectByMemberResponse_Project_DEFAULT *MemberProjectDetail

func (p *GetProjectByMemberResponse) GetProject() (v *MemberProjectDetail) {
	if !p.IsSetProject() {
		return GetProjectByMemberResponse_Project_DEFAULT
	}
	return p.Project
}

func (p *GetProjectByMemberResponse) IsSetProject() bool {
	return p.Project != nil
}

func (p *GetProjectByMemberResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetProjectByMemberResponse(%+v)", *p)
}

// BatchGetProjectsByMemberRequest 是按当前调用者成员关系批量获取项目的请求。
type BatchGetProjectsByMemberRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	ProjectIDs  []string       `json:"ProjectIDs"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewBatchGetProjectsByMemberRequest() *BatchGetProjectsByMemberRequest {
	return &BatchGetProjectsByMemberRequest{}
}

func (p *BatchGetProjectsByMemberRequest) InitDefault() {
}

var BatchGetProjectsByMemberRequest_WorkspaceID_DEFAULT string

func (p *BatchGetProjectsByMemberRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchGetProjectsByMemberRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchGetProjectsByMemberRequest) GetProjectIDs() (v []string) {
	return p.ProjectIDs
}

var BatchGetProjectsByMemberRequest_Top_DEFAULT *base.TopParam

func (p *BatchGetProjectsByMemberRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return BatchGetProjectsByMemberRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *BatchGetProjectsByMemberRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchGetProjectsByMemberRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *BatchGetProjectsByMemberRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetProjectsByMemberRequest(%+v)", *p)
}

// BatchGetProjectsByMemberResponse 只返回当前调用者可见的项目。
type BatchGetProjectsByMemberResponse struct {
	Items []*MemberProjectDetail `json:"Items"`
}

func NewBatchGetProjectsByMemberResponse() *BatchGetProjectsByMemberResponse {
	return &BatchGetProjectsByMemberResponse{}
}

func (p *BatchGetProjectsByMemberResponse) InitDefault() {
}

func (p *BatchGetProjectsByMemberResponse) GetItems() (v []*MemberProjectDetail) {
	return p.Items
}

func (p *BatchGetProjectsByMemberResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetProjectsByMemberResponse(%+v)", *p)
}

// CreateProjectRequest 是创建项目的请求。
type CreateProjectRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// Name 是项目名称，在相同 scope 下唯一。
	Name string `json:"Name"`
	// MemberUserIDs 是项目成员用户 ID 列表。
	MemberUserIDs []string `json:"MemberUserIDs"`
	// CoverImagePath 是通过 Up 上传得到的封面图片 path；未传表示不设置封面。
	CoverImagePath *string `json:"CoverImagePath,omitempty"`
	// UsageLimit 是项目总金额限额，单位元；未传表示无上限。
	UsageLimit *int64 `json:"UsageLimit,omitempty"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewCreateProjectRequest() *CreateProjectRequest {
	return &CreateProjectRequest{}
}

func (p *CreateProjectRequest) InitDefault() {
}

var CreateProjectRequest_WorkspaceID_DEFAULT string

func (p *CreateProjectRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CreateProjectRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CreateProjectRequest) GetName() (v string) {
	return p.Name
}

func (p *CreateProjectRequest) GetMemberUserIDs() (v []string) {
	return p.MemberUserIDs
}

var CreateProjectRequest_CoverImagePath_DEFAULT string

func (p *CreateProjectRequest) GetCoverImagePath() (v string) {
	if !p.IsSetCoverImagePath() {
		return CreateProjectRequest_CoverImagePath_DEFAULT
	}
	return *p.CoverImagePath
}

var CreateProjectRequest_UsageLimit_DEFAULT int64

func (p *CreateProjectRequest) GetUsageLimit() (v int64) {
	if !p.IsSetUsageLimit() {
		return CreateProjectRequest_UsageLimit_DEFAULT
	}
	return *p.UsageLimit
}

var CreateProjectRequest_Top_DEFAULT *base.TopParam

func (p *CreateProjectRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return CreateProjectRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *CreateProjectRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CreateProjectRequest) IsSetCoverImagePath() bool {
	return p.CoverImagePath != nil
}

func (p *CreateProjectRequest) IsSetUsageLimit() bool {
	return p.UsageLimit != nil
}

func (p *CreateProjectRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *CreateProjectRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateProjectRequest(%+v)", *p)
}

// CreateProjectResponse 是创建项目的响应。
type CreateProjectResponse struct {
	// Project 是新创建的项目详情。
	Project *ProjectDetail `json:"Project"`
}

func NewCreateProjectResponse() *CreateProjectResponse {
	return &CreateProjectResponse{}
}

func (p *CreateProjectResponse) InitDefault() {
}

var CreateProjectResponse_Project_DEFAULT *ProjectDetail

func (p *CreateProjectResponse) GetProject() (v *ProjectDetail) {
	if !p.IsSetProject() {
		return CreateProjectResponse_Project_DEFAULT
	}
	return p.Project
}

func (p *CreateProjectResponse) IsSetProject() bool {
	return p.Project != nil
}

func (p *CreateProjectResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateProjectResponse(%+v)", *p)
}

// UpdateProjectRequest 是更新项目的请求。
type UpdateProjectRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是待更新的项目唯一标识。
	ProjectID string `json:"ProjectID"`
	// Name 是更新后的项目名称，在相同 scope 下唯一。
	Name string `json:"Name"`
	// MemberUserIDs 是更新后的项目成员用户 ID 列表。
	MemberUserIDs []string `json:"MemberUserIDs"`
	// CoverImagePath 未传时保持不变，空字符串表示清除封面。
	CoverImagePath *string `json:"CoverImagePath,omitempty"`
	// UsageLimit 是项目总金额限额，单位元；未传表示取消限制。
	UsageLimit *int64 `json:"UsageLimit,omitempty"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewUpdateProjectRequest() *UpdateProjectRequest {
	return &UpdateProjectRequest{}
}

func (p *UpdateProjectRequest) InitDefault() {
}

var UpdateProjectRequest_WorkspaceID_DEFAULT string

func (p *UpdateProjectRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return UpdateProjectRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *UpdateProjectRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *UpdateProjectRequest) GetName() (v string) {
	return p.Name
}

func (p *UpdateProjectRequest) GetMemberUserIDs() (v []string) {
	return p.MemberUserIDs
}

var UpdateProjectRequest_CoverImagePath_DEFAULT string

func (p *UpdateProjectRequest) GetCoverImagePath() (v string) {
	if !p.IsSetCoverImagePath() {
		return UpdateProjectRequest_CoverImagePath_DEFAULT
	}
	return *p.CoverImagePath
}

var UpdateProjectRequest_UsageLimit_DEFAULT int64

func (p *UpdateProjectRequest) GetUsageLimit() (v int64) {
	if !p.IsSetUsageLimit() {
		return UpdateProjectRequest_UsageLimit_DEFAULT
	}
	return *p.UsageLimit
}

var UpdateProjectRequest_Top_DEFAULT *base.TopParam

func (p *UpdateProjectRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return UpdateProjectRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *UpdateProjectRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *UpdateProjectRequest) IsSetCoverImagePath() bool {
	return p.CoverImagePath != nil
}

func (p *UpdateProjectRequest) IsSetUsageLimit() bool {
	return p.UsageLimit != nil
}

func (p *UpdateProjectRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *UpdateProjectRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateProjectRequest(%+v)", *p)
}

// UpdateProjectResponse 是更新项目的响应。
type UpdateProjectResponse struct {
	// Project 是更新后的项目详情。
	Project *ProjectDetail `json:"Project"`
}

func NewUpdateProjectResponse() *UpdateProjectResponse {
	return &UpdateProjectResponse{}
}

func (p *UpdateProjectResponse) InitDefault() {
}

var UpdateProjectResponse_Project_DEFAULT *ProjectDetail

func (p *UpdateProjectResponse) GetProject() (v *ProjectDetail) {
	if !p.IsSetProject() {
		return UpdateProjectResponse_Project_DEFAULT
	}
	return p.Project
}

func (p *UpdateProjectResponse) IsSetProject() bool {
	return p.Project != nil
}

func (p *UpdateProjectResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateProjectResponse(%+v)", *p)
}

// UpdateProjectByMemberRequest 是项目成员更新允许字段的请求。
type UpdateProjectByMemberRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是待更新的项目唯一标识。
	ProjectID string `json:"ProjectID"`
	// CoverImagePath 未传时保持不变，空字符串表示清除封面。
	CoverImagePath *string `json:"CoverImagePath,omitempty"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewUpdateProjectByMemberRequest() *UpdateProjectByMemberRequest {
	return &UpdateProjectByMemberRequest{}
}

func (p *UpdateProjectByMemberRequest) InitDefault() {
}

var UpdateProjectByMemberRequest_WorkspaceID_DEFAULT string

func (p *UpdateProjectByMemberRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return UpdateProjectByMemberRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *UpdateProjectByMemberRequest) GetProjectID() (v string) {
	return p.ProjectID
}

var UpdateProjectByMemberRequest_CoverImagePath_DEFAULT string

func (p *UpdateProjectByMemberRequest) GetCoverImagePath() (v string) {
	if !p.IsSetCoverImagePath() {
		return UpdateProjectByMemberRequest_CoverImagePath_DEFAULT
	}
	return *p.CoverImagePath
}

var UpdateProjectByMemberRequest_Top_DEFAULT *base.TopParam

func (p *UpdateProjectByMemberRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return UpdateProjectByMemberRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *UpdateProjectByMemberRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *UpdateProjectByMemberRequest) IsSetCoverImagePath() bool {
	return p.CoverImagePath != nil
}

func (p *UpdateProjectByMemberRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *UpdateProjectByMemberRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateProjectByMemberRequest(%+v)", *p)
}

// UpdateProjectByMemberResponse 是项目成员更新允许字段的响应。
type UpdateProjectByMemberResponse struct {
	// Project 是更新后的项目详情。
	Project *MemberProjectDetail `json:"Project"`
}

func NewUpdateProjectByMemberResponse() *UpdateProjectByMemberResponse {
	return &UpdateProjectByMemberResponse{}
}

func (p *UpdateProjectByMemberResponse) InitDefault() {
}

var UpdateProjectByMemberResponse_Project_DEFAULT *MemberProjectDetail

func (p *UpdateProjectByMemberResponse) GetProject() (v *MemberProjectDetail) {
	if !p.IsSetProject() {
		return UpdateProjectByMemberResponse_Project_DEFAULT
	}
	return p.Project
}

func (p *UpdateProjectByMemberResponse) IsSetProject() bool {
	return p.Project != nil
}

func (p *UpdateProjectByMemberResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateProjectByMemberResponse(%+v)", *p)
}

// DeleteProjectRequest 是删除项目的请求。
type DeleteProjectRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是待删除的项目唯一标识。
	ProjectID string `json:"ProjectID"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewDeleteProjectRequest() *DeleteProjectRequest {
	return &DeleteProjectRequest{}
}

func (p *DeleteProjectRequest) InitDefault() {
}

var DeleteProjectRequest_WorkspaceID_DEFAULT string

func (p *DeleteProjectRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return DeleteProjectRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *DeleteProjectRequest) GetProjectID() (v string) {
	return p.ProjectID
}

var DeleteProjectRequest_Top_DEFAULT *base.TopParam

func (p *DeleteProjectRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return DeleteProjectRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *DeleteProjectRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *DeleteProjectRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *DeleteProjectRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DeleteProjectRequest(%+v)", *p)
}

// GrantProjectModelsRequest 全量替换项目模型授权。
// ModelIDs 是前端当前全量选中模型 ID；可包含公开/默认模型，空数组取消全部显式授权。
type GrantProjectModelsRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	ProjectID   string         `json:"ProjectID"`
	ModelIDs    []string       `json:"ModelIDs"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewGrantProjectModelsRequest() *GrantProjectModelsRequest {
	return &GrantProjectModelsRequest{}
}

func (p *GrantProjectModelsRequest) InitDefault() {
}

var GrantProjectModelsRequest_WorkspaceID_DEFAULT string

func (p *GrantProjectModelsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return GrantProjectModelsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *GrantProjectModelsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *GrantProjectModelsRequest) GetModelIDs() (v []string) {
	return p.ModelIDs
}

var GrantProjectModelsRequest_Top_DEFAULT *base.TopParam

func (p *GrantProjectModelsRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return GrantProjectModelsRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *GrantProjectModelsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *GrantProjectModelsRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *GrantProjectModelsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GrantProjectModelsRequest(%+v)", *p)
}

type ProjectModelListOption struct {
	PageNumber int32 `json:"PageNumber"`
	PageSize   int32 `json:"PageSize"`
}

func NewProjectModelListOption() *ProjectModelListOption {
	return &ProjectModelListOption{}
}

func (p *ProjectModelListOption) InitDefault() {
}

func (p *ProjectModelListOption) GetPageNumber() (v int32) {
	return p.PageNumber
}

func (p *ProjectModelListOption) GetPageSize() (v int32) {
	return p.PageSize
}

func (p *ProjectModelListOption) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectModelListOption(%+v)", *p)
}

type ProjectModelFilter struct {
	Types     []string `json:"Types,omitempty"`
	Features  []string `json:"Features,omitempty"`
	Statuses  []string `json:"Statuses,omitempty"`
	IsGranted *bool    `json:"IsGranted,omitempty"`
}

func NewProjectModelFilter() *ProjectModelFilter {
	return &ProjectModelFilter{}
}

func (p *ProjectModelFilter) InitDefault() {
}

var ProjectModelFilter_Types_DEFAULT []string

func (p *ProjectModelFilter) GetTypes() (v []string) {
	if !p.IsSetTypes() {
		return ProjectModelFilter_Types_DEFAULT
	}
	return p.Types
}

var ProjectModelFilter_Features_DEFAULT []string

func (p *ProjectModelFilter) GetFeatures() (v []string) {
	if !p.IsSetFeatures() {
		return ProjectModelFilter_Features_DEFAULT
	}
	return p.Features
}

var ProjectModelFilter_Statuses_DEFAULT []string

func (p *ProjectModelFilter) GetStatuses() (v []string) {
	if !p.IsSetStatuses() {
		return ProjectModelFilter_Statuses_DEFAULT
	}
	return p.Statuses
}

var ProjectModelFilter_IsGranted_DEFAULT bool

func (p *ProjectModelFilter) GetIsGranted() (v bool) {
	if !p.IsSetIsGranted() {
		return ProjectModelFilter_IsGranted_DEFAULT
	}
	return *p.IsGranted
}

func (p *ProjectModelFilter) IsSetTypes() bool {
	return p.Types != nil
}

func (p *ProjectModelFilter) IsSetFeatures() bool {
	return p.Features != nil
}

func (p *ProjectModelFilter) IsSetStatuses() bool {
	return p.Statuses != nil
}

func (p *ProjectModelFilter) IsSetIsGranted() bool {
	return p.IsGranted != nil
}

func (p *ProjectModelFilter) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectModelFilter(%+v)", *p)
}

type ProjectModelDuration struct {
	Min *int32 `json:"Min,omitempty"`
	Max *int32 `json:"Max,omitempty"`
	// Default 是模型的默认固定生成时长，单位为秒。
	Default *int32 `json:"Default,omitempty"`
	// Recommends 是模型推荐时长；-1 表示模型支持自动选择生成时长。
	Recommends []int32 `json:"Recommends,omitempty"`
	// RecommendDefault 是推荐项中的默认值；-1 表示默认使用自动时长。
	RecommendDefault *int32 `json:"RecommendDefault,omitempty"`
}

func NewProjectModelDuration() *ProjectModelDuration {
	return &ProjectModelDuration{}
}

func (p *ProjectModelDuration) InitDefault() {
}

var ProjectModelDuration_Min_DEFAULT int32

func (p *ProjectModelDuration) GetMin() (v int32) {
	if !p.IsSetMin() {
		return ProjectModelDuration_Min_DEFAULT
	}
	return *p.Min
}

var ProjectModelDuration_Max_DEFAULT int32

func (p *ProjectModelDuration) GetMax() (v int32) {
	if !p.IsSetMax() {
		return ProjectModelDuration_Max_DEFAULT
	}
	return *p.Max
}

var ProjectModelDuration_Default_DEFAULT int32

func (p *ProjectModelDuration) GetDefault() (v int32) {
	if !p.IsSetDefault() {
		return ProjectModelDuration_Default_DEFAULT
	}
	return *p.Default
}

var ProjectModelDuration_Recommends_DEFAULT []int32

func (p *ProjectModelDuration) GetRecommends() (v []int32) {
	if !p.IsSetRecommends() {
		return ProjectModelDuration_Recommends_DEFAULT
	}
	return p.Recommends
}

var ProjectModelDuration_RecommendDefault_DEFAULT int32

func (p *ProjectModelDuration) GetRecommendDefault() (v int32) {
	if !p.IsSetRecommendDefault() {
		return ProjectModelDuration_RecommendDefault_DEFAULT
	}
	return *p.RecommendDefault
}

func (p *ProjectModelDuration) IsSetMin() bool {
	return p.Min != nil
}

func (p *ProjectModelDuration) IsSetMax() bool {
	return p.Max != nil
}

func (p *ProjectModelDuration) IsSetDefault() bool {
	return p.Default != nil
}

func (p *ProjectModelDuration) IsSetRecommends() bool {
	return p.Recommends != nil
}

func (p *ProjectModelDuration) IsSetRecommendDefault() bool {
	return p.RecommendDefault != nil
}

func (p *ProjectModelDuration) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectModelDuration(%+v)", *p)
}

type ProjectModelRatio struct {
	// Values 是模型支持的固定画幅比例。
	Values []string `json:"Values,omitempty"`
	// Adaptive 表示模型是否接受 adaptive 自动画幅协议值。
	Adaptive *bool `json:"Adaptive,omitempty"`
	// Default 是模型默认画幅，可能是固定比例或 adaptive。
	Default *string `json:"Default,omitempty"`
}

func NewProjectModelRatio() *ProjectModelRatio {
	return &ProjectModelRatio{}
}

func (p *ProjectModelRatio) InitDefault() {
}

var ProjectModelRatio_Values_DEFAULT []string

func (p *ProjectModelRatio) GetValues() (v []string) {
	if !p.IsSetValues() {
		return ProjectModelRatio_Values_DEFAULT
	}
	return p.Values
}

var ProjectModelRatio_Adaptive_DEFAULT bool

func (p *ProjectModelRatio) GetAdaptive() (v bool) {
	if !p.IsSetAdaptive() {
		return ProjectModelRatio_Adaptive_DEFAULT
	}
	return *p.Adaptive
}

var ProjectModelRatio_Default_DEFAULT string

func (p *ProjectModelRatio) GetDefault() (v string) {
	if !p.IsSetDefault() {
		return ProjectModelRatio_Default_DEFAULT
	}
	return *p.Default
}

func (p *ProjectModelRatio) IsSetValues() bool {
	return p.Values != nil
}

func (p *ProjectModelRatio) IsSetAdaptive() bool {
	return p.Adaptive != nil
}

func (p *ProjectModelRatio) IsSetDefault() bool {
	return p.Default != nil
}

func (p *ProjectModelRatio) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectModelRatio(%+v)", *p)
}

type ProjectModelVideoProperty struct {
	Duration       *ProjectModelDuration              `json:"Duration,omitempty"`
	Ratio          *ProjectModelRatio                 `json:"Ratio,omitempty"`
	Resolutions    []string                           `json:"Resolutions,omitempty"`
	CameraFixed    *aigw_model_types.CommonSwitch     `json:"CameraFixed,omitempty"`
	Features       []*aigw_model_types.VisionFeature  `json:"Features,omitempty"`
	GenerateAudio  *aigw_model_types.CommonSwitch     `json:"GenerateAudio,omitempty"`
	NegativePrompt *aigw_model_types.CommonSwitch     `json:"NegativePrompt,omitempty"`
	Watermark      *aigw_model_types.CommonBoolSwitch `json:"Watermark,omitempty"`
	Reference      *aigw_model_types.ReferenceConfig  `json:"Reference,omitempty"`
	Tools          *aigw_model_types.ToolConfig       `json:"Tools,omitempty"`
}

func NewProjectModelVideoProperty() *ProjectModelVideoProperty {
	return &ProjectModelVideoProperty{}
}

func (p *ProjectModelVideoProperty) InitDefault() {
}

var ProjectModelVideoProperty_Duration_DEFAULT *ProjectModelDuration

func (p *ProjectModelVideoProperty) GetDuration() (v *ProjectModelDuration) {
	if !p.IsSetDuration() {
		return ProjectModelVideoProperty_Duration_DEFAULT
	}
	return p.Duration
}

var ProjectModelVideoProperty_Ratio_DEFAULT *ProjectModelRatio

func (p *ProjectModelVideoProperty) GetRatio() (v *ProjectModelRatio) {
	if !p.IsSetRatio() {
		return ProjectModelVideoProperty_Ratio_DEFAULT
	}
	return p.Ratio
}

var ProjectModelVideoProperty_Resolutions_DEFAULT []string

func (p *ProjectModelVideoProperty) GetResolutions() (v []string) {
	if !p.IsSetResolutions() {
		return ProjectModelVideoProperty_Resolutions_DEFAULT
	}
	return p.Resolutions
}

var ProjectModelVideoProperty_CameraFixed_DEFAULT *aigw_model_types.CommonSwitch

func (p *ProjectModelVideoProperty) GetCameraFixed() (v *aigw_model_types.CommonSwitch) {
	if !p.IsSetCameraFixed() {
		return ProjectModelVideoProperty_CameraFixed_DEFAULT
	}
	return p.CameraFixed
}

var ProjectModelVideoProperty_Features_DEFAULT []*aigw_model_types.VisionFeature

func (p *ProjectModelVideoProperty) GetFeatures() (v []*aigw_model_types.VisionFeature) {
	if !p.IsSetFeatures() {
		return ProjectModelVideoProperty_Features_DEFAULT
	}
	return p.Features
}

var ProjectModelVideoProperty_GenerateAudio_DEFAULT *aigw_model_types.CommonSwitch

func (p *ProjectModelVideoProperty) GetGenerateAudio() (v *aigw_model_types.CommonSwitch) {
	if !p.IsSetGenerateAudio() {
		return ProjectModelVideoProperty_GenerateAudio_DEFAULT
	}
	return p.GenerateAudio
}

var ProjectModelVideoProperty_NegativePrompt_DEFAULT *aigw_model_types.CommonSwitch

func (p *ProjectModelVideoProperty) GetNegativePrompt() (v *aigw_model_types.CommonSwitch) {
	if !p.IsSetNegativePrompt() {
		return ProjectModelVideoProperty_NegativePrompt_DEFAULT
	}
	return p.NegativePrompt
}

var ProjectModelVideoProperty_Watermark_DEFAULT *aigw_model_types.CommonBoolSwitch

func (p *ProjectModelVideoProperty) GetWatermark() (v *aigw_model_types.CommonBoolSwitch) {
	if !p.IsSetWatermark() {
		return ProjectModelVideoProperty_Watermark_DEFAULT
	}
	return p.Watermark
}

var ProjectModelVideoProperty_Reference_DEFAULT *aigw_model_types.ReferenceConfig

func (p *ProjectModelVideoProperty) GetReference() (v *aigw_model_types.ReferenceConfig) {
	if !p.IsSetReference() {
		return ProjectModelVideoProperty_Reference_DEFAULT
	}
	return p.Reference
}

var ProjectModelVideoProperty_Tools_DEFAULT *aigw_model_types.ToolConfig

func (p *ProjectModelVideoProperty) GetTools() (v *aigw_model_types.ToolConfig) {
	if !p.IsSetTools() {
		return ProjectModelVideoProperty_Tools_DEFAULT
	}
	return p.Tools
}

func (p *ProjectModelVideoProperty) IsSetDuration() bool {
	return p.Duration != nil
}

func (p *ProjectModelVideoProperty) IsSetRatio() bool {
	return p.Ratio != nil
}

func (p *ProjectModelVideoProperty) IsSetResolutions() bool {
	return p.Resolutions != nil
}

func (p *ProjectModelVideoProperty) IsSetCameraFixed() bool {
	return p.CameraFixed != nil
}

func (p *ProjectModelVideoProperty) IsSetFeatures() bool {
	return p.Features != nil
}

func (p *ProjectModelVideoProperty) IsSetGenerateAudio() bool {
	return p.GenerateAudio != nil
}

func (p *ProjectModelVideoProperty) IsSetNegativePrompt() bool {
	return p.NegativePrompt != nil
}

func (p *ProjectModelVideoProperty) IsSetWatermark() bool {
	return p.Watermark != nil
}

func (p *ProjectModelVideoProperty) IsSetReference() bool {
	return p.Reference != nil
}

func (p *ProjectModelVideoProperty) IsSetTools() bool {
	return p.Tools != nil
}

func (p *ProjectModelVideoProperty) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectModelVideoProperty(%+v)", *p)
}

type ProjectModelVisionProperty struct {
	Video         *ProjectModelVideoProperty    `json:"Video,omitempty"`
	GuidanceScale *aigw_model_types.DoubleRange `json:"GuidanceScale,omitempty"`
	Seed          *aigw_model_types.IntRange    `json:"Seed,omitempty"`
	Image         *aigw_model_types.ImageConfig `json:"Image,omitempty"`
}

func NewProjectModelVisionProperty() *ProjectModelVisionProperty {
	return &ProjectModelVisionProperty{}
}

func (p *ProjectModelVisionProperty) InitDefault() {
}

var ProjectModelVisionProperty_Video_DEFAULT *ProjectModelVideoProperty

func (p *ProjectModelVisionProperty) GetVideo() (v *ProjectModelVideoProperty) {
	if !p.IsSetVideo() {
		return ProjectModelVisionProperty_Video_DEFAULT
	}
	return p.Video
}

var ProjectModelVisionProperty_GuidanceScale_DEFAULT *aigw_model_types.DoubleRange

func (p *ProjectModelVisionProperty) GetGuidanceScale() (v *aigw_model_types.DoubleRange) {
	if !p.IsSetGuidanceScale() {
		return ProjectModelVisionProperty_GuidanceScale_DEFAULT
	}
	return p.GuidanceScale
}

var ProjectModelVisionProperty_Seed_DEFAULT *aigw_model_types.IntRange

func (p *ProjectModelVisionProperty) GetSeed() (v *aigw_model_types.IntRange) {
	if !p.IsSetSeed() {
		return ProjectModelVisionProperty_Seed_DEFAULT
	}
	return p.Seed
}

var ProjectModelVisionProperty_Image_DEFAULT *aigw_model_types.ImageConfig

func (p *ProjectModelVisionProperty) GetImage() (v *aigw_model_types.ImageConfig) {
	if !p.IsSetImage() {
		return ProjectModelVisionProperty_Image_DEFAULT
	}
	return p.Image
}

func (p *ProjectModelVisionProperty) IsSetVideo() bool {
	return p.Video != nil
}

func (p *ProjectModelVisionProperty) IsSetGuidanceScale() bool {
	return p.GuidanceScale != nil
}

func (p *ProjectModelVisionProperty) IsSetSeed() bool {
	return p.Seed != nil
}

func (p *ProjectModelVisionProperty) IsSetImage() bool {
	return p.Image != nil
}

func (p *ProjectModelVisionProperty) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectModelVisionProperty(%+v)", *p)
}

type ProjectModelProperty struct {
	Vision    *ProjectModelVisionProperty         `json:"Vision,omitempty"`
	Common    *aigw_model_types.CommonModelConfig `json:"Common,omitempty"`
	LLM       *aigw_model_types.LLMConfig         `json:"LLM,omitempty"`
	Embedding *aigw_model_types.EmbeddingConfig   `json:"Embedding,omitempty"`
	Audio     *aigw_model_types.AudioConfig       `json:"Audio,omitempty"`
}

func NewProjectModelProperty() *ProjectModelProperty {
	return &ProjectModelProperty{}
}

func (p *ProjectModelProperty) InitDefault() {
}

var ProjectModelProperty_Vision_DEFAULT *ProjectModelVisionProperty

func (p *ProjectModelProperty) GetVision() (v *ProjectModelVisionProperty) {
	if !p.IsSetVision() {
		return ProjectModelProperty_Vision_DEFAULT
	}
	return p.Vision
}

var ProjectModelProperty_Common_DEFAULT *aigw_model_types.CommonModelConfig

func (p *ProjectModelProperty) GetCommon() (v *aigw_model_types.CommonModelConfig) {
	if !p.IsSetCommon() {
		return ProjectModelProperty_Common_DEFAULT
	}
	return p.Common
}

var ProjectModelProperty_LLM_DEFAULT *aigw_model_types.LLMConfig

func (p *ProjectModelProperty) GetLLM() (v *aigw_model_types.LLMConfig) {
	if !p.IsSetLLM() {
		return ProjectModelProperty_LLM_DEFAULT
	}
	return p.LLM
}

var ProjectModelProperty_Embedding_DEFAULT *aigw_model_types.EmbeddingConfig

func (p *ProjectModelProperty) GetEmbedding() (v *aigw_model_types.EmbeddingConfig) {
	if !p.IsSetEmbedding() {
		return ProjectModelProperty_Embedding_DEFAULT
	}
	return p.Embedding
}

var ProjectModelProperty_Audio_DEFAULT *aigw_model_types.AudioConfig

func (p *ProjectModelProperty) GetAudio() (v *aigw_model_types.AudioConfig) {
	if !p.IsSetAudio() {
		return ProjectModelProperty_Audio_DEFAULT
	}
	return p.Audio
}

func (p *ProjectModelProperty) IsSetVision() bool {
	return p.Vision != nil
}

func (p *ProjectModelProperty) IsSetCommon() bool {
	return p.Common != nil
}

func (p *ProjectModelProperty) IsSetLLM() bool {
	return p.LLM != nil
}

func (p *ProjectModelProperty) IsSetEmbedding() bool {
	return p.Embedding != nil
}

func (p *ProjectModelProperty) IsSetAudio() bool {
	return p.Audio != nil
}

func (p *ProjectModelProperty) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectModelProperty(%+v)", *p)
}

// ProjectModelInfo 保留原字段 1-9 的 wire layout，并扩展 AIGW 的其余非敏感模型字段。
type ProjectModelInfo struct {
	ID                    string                                         `json:"ID"`
	Name                  string                                         `json:"Name"`
	Type                  string                                         `json:"Type"`
	FeaturesConfig        []string                                       `json:"FeaturesConfig,omitempty"`
	Status                *string                                        `json:"Status,omitempty"`
	IsPublic              bool                                           `json:"IsPublic"`
	IsDefault             bool                                           `json:"IsDefault"`
	Granted               bool                                           `json:"Granted"`
	Property              *ProjectModelProperty                          `json:"Property,omitempty"`
	Description           *string                                        `json:"Description,omitempty"`
	PublishSourceType     *string                                        `json:"PublishSourceType"`
	CreateUserName        *string                                        `json:"CreateUserName"`
	CreateTime            *string                                        `json:"CreateTime"`
	Version               *string                                        `json:"Version,omitempty"`
	Source                *string                                        `json:"Source"`
	DeleteAt              *string                                        `json:"DeleteAt"`
	TenantId              *string                                        `json:"TenantId"`
	DistributeType        *string                                        `json:"DistributeType,omitempty"`
	FromID                *string                                        `json:"FromID,omitempty"`
	UpdateUserName        *string                                        `json:"UpdateUserName,omitempty"`
	UpdateTime            *string                                        `json:"UpdateTime,omitempty"`
	IsPublished           *bool                                          `json:"IsPublished,omitempty"`
	PublishTime           *string                                        `json:"PublishTime,omitempty"`
	PublishUserName       *string                                        `json:"PublishUserName,omitempty"`
	Icon                  *string                                        `json:"Icon,omitempty"`
	WorkspaceName         *string                                        `json:"WorkspaceName,omitempty"`
	CustomMarker          *aigw_model_types.MarkerDetails                `json:"CustomMarker,omitempty"`
	ServiceIntroduction   *string                                        `json:"ServiceIntroduction,omitempty"`
	BusinessLabels        []*aigw_model_types.LabelInfo                  `json:"BusinessLabels,omitempty"`
	IsCustomMarkerEnabled *bool                                          `json:"IsCustomMarkerEnabled,omitempty"`
	IsPreset              *bool                                          `json:"IsPreset,omitempty"`
	IsBilling             *bool                                          `json:"IsBilling,omitempty"`
	IsDefaultLTM          *bool                                          `json:"IsDefaultLTM,omitempty"`
	DefaultType           *string                                        `json:"DefaultType,omitempty"`
	DefaultTypes          []string                                       `json:"DefaultTypes,omitempty"`
	CustomParameters      *string                                        `json:"CustomParameters,omitempty"`
	PriceConfig           *aigw_model_types.PriceConfig                  `json:"PriceConfig,omitempty"`
	PromptConfig          *aigw_model_types.PromptConfig                 `json:"PromptConfig,omitempty"`
	StrategiesConfig      []string                                       `json:"StrategiesConfig"`
	PolicyConfig          *aigw_model_types.PolicyConfig                 `json:"PolicyConfig,omitempty"`
	Parameter             *aigw_model_types.ModelParameter               `json:"Parameter,omitempty"`
	CredentialSchema      *aigw_model_types.ModelCredentialSchema        `json:"CredentialSchema,omitempty"`
	ProductCode           *string                                        `json:"ProductCode,omitempty"`
	WorkspaceID           *string                                        `json:"WorkspaceID,omitempty"`
	Provider              *string                                        `json:"Provider"`
	Spec                  *string                                        `json:"Spec,omitempty"`
	ModelName             *string                                        `json:"ModelName"`
	DLVersion             *string                                        `json:"DLVersion,omitempty"`
	DeployConfig          *aigw_model_types.MaaSModelServiceDeployConfig `json:"DeployConfig,omitempty"`
}

func NewProjectModelInfo() *ProjectModelInfo {
	return &ProjectModelInfo{}
}

func (p *ProjectModelInfo) InitDefault() {
}

func (p *ProjectModelInfo) GetID() (v string) {
	return p.ID
}

func (p *ProjectModelInfo) GetName() (v string) {
	return p.Name
}

func (p *ProjectModelInfo) GetType() (v string) {
	return p.Type
}

var ProjectModelInfo_FeaturesConfig_DEFAULT []string

func (p *ProjectModelInfo) GetFeaturesConfig() (v []string) {
	if !p.IsSetFeaturesConfig() {
		return ProjectModelInfo_FeaturesConfig_DEFAULT
	}
	return p.FeaturesConfig
}

var ProjectModelInfo_Status_DEFAULT string

func (p *ProjectModelInfo) GetStatus() (v string) {
	if !p.IsSetStatus() {
		return ProjectModelInfo_Status_DEFAULT
	}
	return *p.Status
}

func (p *ProjectModelInfo) GetIsPublic() (v bool) {
	return p.IsPublic
}

func (p *ProjectModelInfo) GetIsDefault() (v bool) {
	return p.IsDefault
}

func (p *ProjectModelInfo) GetGranted() (v bool) {
	return p.Granted
}

var ProjectModelInfo_Property_DEFAULT *ProjectModelProperty

func (p *ProjectModelInfo) GetProperty() (v *ProjectModelProperty) {
	if !p.IsSetProperty() {
		return ProjectModelInfo_Property_DEFAULT
	}
	return p.Property
}

var ProjectModelInfo_Description_DEFAULT string

func (p *ProjectModelInfo) GetDescription() (v string) {
	if !p.IsSetDescription() {
		return ProjectModelInfo_Description_DEFAULT
	}
	return *p.Description
}

var ProjectModelInfo_PublishSourceType_DEFAULT string

func (p *ProjectModelInfo) GetPublishSourceType() (v string) {
	if !p.IsSetPublishSourceType() {
		return ProjectModelInfo_PublishSourceType_DEFAULT
	}
	return *p.PublishSourceType
}

var ProjectModelInfo_CreateUserName_DEFAULT string

func (p *ProjectModelInfo) GetCreateUserName() (v string) {
	if !p.IsSetCreateUserName() {
		return ProjectModelInfo_CreateUserName_DEFAULT
	}
	return *p.CreateUserName
}

var ProjectModelInfo_CreateTime_DEFAULT string

func (p *ProjectModelInfo) GetCreateTime() (v string) {
	if !p.IsSetCreateTime() {
		return ProjectModelInfo_CreateTime_DEFAULT
	}
	return *p.CreateTime
}

var ProjectModelInfo_Version_DEFAULT string

func (p *ProjectModelInfo) GetVersion() (v string) {
	if !p.IsSetVersion() {
		return ProjectModelInfo_Version_DEFAULT
	}
	return *p.Version
}

var ProjectModelInfo_Source_DEFAULT string

func (p *ProjectModelInfo) GetSource() (v string) {
	if !p.IsSetSource() {
		return ProjectModelInfo_Source_DEFAULT
	}
	return *p.Source
}

var ProjectModelInfo_DeleteAt_DEFAULT string

func (p *ProjectModelInfo) GetDeleteAt() (v string) {
	if !p.IsSetDeleteAt() {
		return ProjectModelInfo_DeleteAt_DEFAULT
	}
	return *p.DeleteAt
}

var ProjectModelInfo_TenantId_DEFAULT string

func (p *ProjectModelInfo) GetTenantId() (v string) {
	if !p.IsSetTenantId() {
		return ProjectModelInfo_TenantId_DEFAULT
	}
	return *p.TenantId
}

var ProjectModelInfo_DistributeType_DEFAULT string

func (p *ProjectModelInfo) GetDistributeType() (v string) {
	if !p.IsSetDistributeType() {
		return ProjectModelInfo_DistributeType_DEFAULT
	}
	return *p.DistributeType
}

var ProjectModelInfo_FromID_DEFAULT string

func (p *ProjectModelInfo) GetFromID() (v string) {
	if !p.IsSetFromID() {
		return ProjectModelInfo_FromID_DEFAULT
	}
	return *p.FromID
}

var ProjectModelInfo_UpdateUserName_DEFAULT string

func (p *ProjectModelInfo) GetUpdateUserName() (v string) {
	if !p.IsSetUpdateUserName() {
		return ProjectModelInfo_UpdateUserName_DEFAULT
	}
	return *p.UpdateUserName
}

var ProjectModelInfo_UpdateTime_DEFAULT string

func (p *ProjectModelInfo) GetUpdateTime() (v string) {
	if !p.IsSetUpdateTime() {
		return ProjectModelInfo_UpdateTime_DEFAULT
	}
	return *p.UpdateTime
}

var ProjectModelInfo_IsPublished_DEFAULT bool

func (p *ProjectModelInfo) GetIsPublished() (v bool) {
	if !p.IsSetIsPublished() {
		return ProjectModelInfo_IsPublished_DEFAULT
	}
	return *p.IsPublished
}

var ProjectModelInfo_PublishTime_DEFAULT string

func (p *ProjectModelInfo) GetPublishTime() (v string) {
	if !p.IsSetPublishTime() {
		return ProjectModelInfo_PublishTime_DEFAULT
	}
	return *p.PublishTime
}

var ProjectModelInfo_PublishUserName_DEFAULT string

func (p *ProjectModelInfo) GetPublishUserName() (v string) {
	if !p.IsSetPublishUserName() {
		return ProjectModelInfo_PublishUserName_DEFAULT
	}
	return *p.PublishUserName
}

var ProjectModelInfo_Icon_DEFAULT string

func (p *ProjectModelInfo) GetIcon() (v string) {
	if !p.IsSetIcon() {
		return ProjectModelInfo_Icon_DEFAULT
	}
	return *p.Icon
}

var ProjectModelInfo_WorkspaceName_DEFAULT string

func (p *ProjectModelInfo) GetWorkspaceName() (v string) {
	if !p.IsSetWorkspaceName() {
		return ProjectModelInfo_WorkspaceName_DEFAULT
	}
	return *p.WorkspaceName
}

var ProjectModelInfo_CustomMarker_DEFAULT *aigw_model_types.MarkerDetails

func (p *ProjectModelInfo) GetCustomMarker() (v *aigw_model_types.MarkerDetails) {
	if !p.IsSetCustomMarker() {
		return ProjectModelInfo_CustomMarker_DEFAULT
	}
	return p.CustomMarker
}

var ProjectModelInfo_ServiceIntroduction_DEFAULT string

func (p *ProjectModelInfo) GetServiceIntroduction() (v string) {
	if !p.IsSetServiceIntroduction() {
		return ProjectModelInfo_ServiceIntroduction_DEFAULT
	}
	return *p.ServiceIntroduction
}

var ProjectModelInfo_BusinessLabels_DEFAULT []*aigw_model_types.LabelInfo

func (p *ProjectModelInfo) GetBusinessLabels() (v []*aigw_model_types.LabelInfo) {
	if !p.IsSetBusinessLabels() {
		return ProjectModelInfo_BusinessLabels_DEFAULT
	}
	return p.BusinessLabels
}

var ProjectModelInfo_IsCustomMarkerEnabled_DEFAULT bool

func (p *ProjectModelInfo) GetIsCustomMarkerEnabled() (v bool) {
	if !p.IsSetIsCustomMarkerEnabled() {
		return ProjectModelInfo_IsCustomMarkerEnabled_DEFAULT
	}
	return *p.IsCustomMarkerEnabled
}

var ProjectModelInfo_IsPreset_DEFAULT bool

func (p *ProjectModelInfo) GetIsPreset() (v bool) {
	if !p.IsSetIsPreset() {
		return ProjectModelInfo_IsPreset_DEFAULT
	}
	return *p.IsPreset
}

var ProjectModelInfo_IsBilling_DEFAULT bool

func (p *ProjectModelInfo) GetIsBilling() (v bool) {
	if !p.IsSetIsBilling() {
		return ProjectModelInfo_IsBilling_DEFAULT
	}
	return *p.IsBilling
}

var ProjectModelInfo_IsDefaultLTM_DEFAULT bool

func (p *ProjectModelInfo) GetIsDefaultLTM() (v bool) {
	if !p.IsSetIsDefaultLTM() {
		return ProjectModelInfo_IsDefaultLTM_DEFAULT
	}
	return *p.IsDefaultLTM
}

var ProjectModelInfo_DefaultType_DEFAULT string

func (p *ProjectModelInfo) GetDefaultType() (v string) {
	if !p.IsSetDefaultType() {
		return ProjectModelInfo_DefaultType_DEFAULT
	}
	return *p.DefaultType
}

var ProjectModelInfo_DefaultTypes_DEFAULT []string

func (p *ProjectModelInfo) GetDefaultTypes() (v []string) {
	if !p.IsSetDefaultTypes() {
		return ProjectModelInfo_DefaultTypes_DEFAULT
	}
	return p.DefaultTypes
}

var ProjectModelInfo_CustomParameters_DEFAULT string

func (p *ProjectModelInfo) GetCustomParameters() (v string) {
	if !p.IsSetCustomParameters() {
		return ProjectModelInfo_CustomParameters_DEFAULT
	}
	return *p.CustomParameters
}

var ProjectModelInfo_PriceConfig_DEFAULT *aigw_model_types.PriceConfig

func (p *ProjectModelInfo) GetPriceConfig() (v *aigw_model_types.PriceConfig) {
	if !p.IsSetPriceConfig() {
		return ProjectModelInfo_PriceConfig_DEFAULT
	}
	return p.PriceConfig
}

var ProjectModelInfo_PromptConfig_DEFAULT *aigw_model_types.PromptConfig

func (p *ProjectModelInfo) GetPromptConfig() (v *aigw_model_types.PromptConfig) {
	if !p.IsSetPromptConfig() {
		return ProjectModelInfo_PromptConfig_DEFAULT
	}
	return p.PromptConfig
}

var ProjectModelInfo_StrategiesConfig_DEFAULT []string

func (p *ProjectModelInfo) GetStrategiesConfig() (v []string) {
	if !p.IsSetStrategiesConfig() {
		return ProjectModelInfo_StrategiesConfig_DEFAULT
	}
	return p.StrategiesConfig
}

var ProjectModelInfo_PolicyConfig_DEFAULT *aigw_model_types.PolicyConfig

func (p *ProjectModelInfo) GetPolicyConfig() (v *aigw_model_types.PolicyConfig) {
	if !p.IsSetPolicyConfig() {
		return ProjectModelInfo_PolicyConfig_DEFAULT
	}
	return p.PolicyConfig
}

var ProjectModelInfo_Parameter_DEFAULT *aigw_model_types.ModelParameter

func (p *ProjectModelInfo) GetParameter() (v *aigw_model_types.ModelParameter) {
	if !p.IsSetParameter() {
		return ProjectModelInfo_Parameter_DEFAULT
	}
	return p.Parameter
}

var ProjectModelInfo_CredentialSchema_DEFAULT *aigw_model_types.ModelCredentialSchema

func (p *ProjectModelInfo) GetCredentialSchema() (v *aigw_model_types.ModelCredentialSchema) {
	if !p.IsSetCredentialSchema() {
		return ProjectModelInfo_CredentialSchema_DEFAULT
	}
	return p.CredentialSchema
}

var ProjectModelInfo_ProductCode_DEFAULT string

func (p *ProjectModelInfo) GetProductCode() (v string) {
	if !p.IsSetProductCode() {
		return ProjectModelInfo_ProductCode_DEFAULT
	}
	return *p.ProductCode
}

var ProjectModelInfo_WorkspaceID_DEFAULT string

func (p *ProjectModelInfo) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return ProjectModelInfo_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

var ProjectModelInfo_Provider_DEFAULT string

func (p *ProjectModelInfo) GetProvider() (v string) {
	if !p.IsSetProvider() {
		return ProjectModelInfo_Provider_DEFAULT
	}
	return *p.Provider
}

var ProjectModelInfo_Spec_DEFAULT string

func (p *ProjectModelInfo) GetSpec() (v string) {
	if !p.IsSetSpec() {
		return ProjectModelInfo_Spec_DEFAULT
	}
	return *p.Spec
}

var ProjectModelInfo_ModelName_DEFAULT string

func (p *ProjectModelInfo) GetModelName() (v string) {
	if !p.IsSetModelName() {
		return ProjectModelInfo_ModelName_DEFAULT
	}
	return *p.ModelName
}

var ProjectModelInfo_DLVersion_DEFAULT string

func (p *ProjectModelInfo) GetDLVersion() (v string) {
	if !p.IsSetDLVersion() {
		return ProjectModelInfo_DLVersion_DEFAULT
	}
	return *p.DLVersion
}

var ProjectModelInfo_DeployConfig_DEFAULT *aigw_model_types.MaaSModelServiceDeployConfig

func (p *ProjectModelInfo) GetDeployConfig() (v *aigw_model_types.MaaSModelServiceDeployConfig) {
	if !p.IsSetDeployConfig() {
		return ProjectModelInfo_DeployConfig_DEFAULT
	}
	return p.DeployConfig
}

func (p *ProjectModelInfo) IsSetFeaturesConfig() bool {
	return p.FeaturesConfig != nil
}

func (p *ProjectModelInfo) IsSetStatus() bool {
	return p.Status != nil
}

func (p *ProjectModelInfo) IsSetProperty() bool {
	return p.Property != nil
}

func (p *ProjectModelInfo) IsSetDescription() bool {
	return p.Description != nil
}

func (p *ProjectModelInfo) IsSetPublishSourceType() bool {
	return p.PublishSourceType != nil
}

func (p *ProjectModelInfo) IsSetCreateUserName() bool {
	return p.CreateUserName != nil
}

func (p *ProjectModelInfo) IsSetCreateTime() bool {
	return p.CreateTime != nil
}

func (p *ProjectModelInfo) IsSetVersion() bool {
	return p.Version != nil
}

func (p *ProjectModelInfo) IsSetSource() bool {
	return p.Source != nil
}

func (p *ProjectModelInfo) IsSetDeleteAt() bool {
	return p.DeleteAt != nil
}

func (p *ProjectModelInfo) IsSetTenantId() bool {
	return p.TenantId != nil
}

func (p *ProjectModelInfo) IsSetDistributeType() bool {
	return p.DistributeType != nil
}

func (p *ProjectModelInfo) IsSetFromID() bool {
	return p.FromID != nil
}

func (p *ProjectModelInfo) IsSetUpdateUserName() bool {
	return p.UpdateUserName != nil
}

func (p *ProjectModelInfo) IsSetUpdateTime() bool {
	return p.UpdateTime != nil
}

func (p *ProjectModelInfo) IsSetIsPublished() bool {
	return p.IsPublished != nil
}

func (p *ProjectModelInfo) IsSetPublishTime() bool {
	return p.PublishTime != nil
}

func (p *ProjectModelInfo) IsSetPublishUserName() bool {
	return p.PublishUserName != nil
}

func (p *ProjectModelInfo) IsSetIcon() bool {
	return p.Icon != nil
}

func (p *ProjectModelInfo) IsSetWorkspaceName() bool {
	return p.WorkspaceName != nil
}

func (p *ProjectModelInfo) IsSetCustomMarker() bool {
	return p.CustomMarker != nil
}

func (p *ProjectModelInfo) IsSetServiceIntroduction() bool {
	return p.ServiceIntroduction != nil
}

func (p *ProjectModelInfo) IsSetBusinessLabels() bool {
	return p.BusinessLabels != nil
}

func (p *ProjectModelInfo) IsSetIsCustomMarkerEnabled() bool {
	return p.IsCustomMarkerEnabled != nil
}

func (p *ProjectModelInfo) IsSetIsPreset() bool {
	return p.IsPreset != nil
}

func (p *ProjectModelInfo) IsSetIsBilling() bool {
	return p.IsBilling != nil
}

func (p *ProjectModelInfo) IsSetIsDefaultLTM() bool {
	return p.IsDefaultLTM != nil
}

func (p *ProjectModelInfo) IsSetDefaultType() bool {
	return p.DefaultType != nil
}

func (p *ProjectModelInfo) IsSetDefaultTypes() bool {
	return p.DefaultTypes != nil
}

func (p *ProjectModelInfo) IsSetCustomParameters() bool {
	return p.CustomParameters != nil
}

func (p *ProjectModelInfo) IsSetPriceConfig() bool {
	return p.PriceConfig != nil
}

func (p *ProjectModelInfo) IsSetPromptConfig() bool {
	return p.PromptConfig != nil
}

func (p *ProjectModelInfo) IsSetStrategiesConfig() bool {
	return p.StrategiesConfig != nil
}

func (p *ProjectModelInfo) IsSetPolicyConfig() bool {
	return p.PolicyConfig != nil
}

func (p *ProjectModelInfo) IsSetParameter() bool {
	return p.Parameter != nil
}

func (p *ProjectModelInfo) IsSetCredentialSchema() bool {
	return p.CredentialSchema != nil
}

func (p *ProjectModelInfo) IsSetProductCode() bool {
	return p.ProductCode != nil
}

func (p *ProjectModelInfo) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *ProjectModelInfo) IsSetProvider() bool {
	return p.Provider != nil
}

func (p *ProjectModelInfo) IsSetSpec() bool {
	return p.Spec != nil
}

func (p *ProjectModelInfo) IsSetModelName() bool {
	return p.ModelName != nil
}

func (p *ProjectModelInfo) IsSetDLVersion() bool {
	return p.DLVersion != nil
}

func (p *ProjectModelInfo) IsSetDeployConfig() bool {
	return p.DeployConfig != nil
}

func (p *ProjectModelInfo) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectModelInfo(%+v)", *p)
}

type ListProjectModelsRequest struct {
	WorkspaceID *string                 `json:"WorkspaceID,omitempty"`
	ProjectID   string                  `json:"ProjectID"`
	ListOpt     *ProjectModelListOption `json:"ListOpt,omitempty"`
	Filter      *ProjectModelFilter     `json:"Filter,omitempty"`
	Top         *base.TopParam          `json:"Top,omitempty"`
}

func NewListProjectModelsRequest() *ListProjectModelsRequest {
	return &ListProjectModelsRequest{}
}

func (p *ListProjectModelsRequest) InitDefault() {
}

var ListProjectModelsRequest_WorkspaceID_DEFAULT string

func (p *ListProjectModelsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return ListProjectModelsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *ListProjectModelsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

var ListProjectModelsRequest_ListOpt_DEFAULT *ProjectModelListOption

func (p *ListProjectModelsRequest) GetListOpt() (v *ProjectModelListOption) {
	if !p.IsSetListOpt() {
		return ListProjectModelsRequest_ListOpt_DEFAULT
	}
	return p.ListOpt
}

var ListProjectModelsRequest_Filter_DEFAULT *ProjectModelFilter

func (p *ListProjectModelsRequest) GetFilter() (v *ProjectModelFilter) {
	if !p.IsSetFilter() {
		return ListProjectModelsRequest_Filter_DEFAULT
	}
	return p.Filter
}

var ListProjectModelsRequest_Top_DEFAULT *base.TopParam

func (p *ListProjectModelsRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return ListProjectModelsRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *ListProjectModelsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *ListProjectModelsRequest) IsSetListOpt() bool {
	return p.ListOpt != nil
}

func (p *ListProjectModelsRequest) IsSetFilter() bool {
	return p.Filter != nil
}

func (p *ListProjectModelsRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *ListProjectModelsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListProjectModelsRequest(%+v)", *p)
}

type ListProjectModelsResponse struct {
	Items []*ProjectModelInfo `json:"Items"`
	Total int32               `json:"Total"`
}

func NewListProjectModelsResponse() *ListProjectModelsResponse {
	return &ListProjectModelsResponse{}
}

func (p *ListProjectModelsResponse) InitDefault() {
}

func (p *ListProjectModelsResponse) GetItems() (v []*ProjectModelInfo) {
	return p.Items
}

func (p *ListProjectModelsResponse) GetTotal() (v int32) {
	return p.Total
}

func (p *ListProjectModelsResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListProjectModelsResponse(%+v)", *p)
}
