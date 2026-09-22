package asset

import (
	"database/sql"
	"database/sql/driver"
	"fmt"
	"github.com/example/monorepo/canvas/internal/api/contracts/base"
	"github.com/example/monorepo/canvas/internal/api/contracts/common"
)

// AssetOwnerType 定义素材的可见范围归属类型。
type AssetOwnerType int64

const (
	// PROJECT 表示素材仅可在指定项目范围内使用。
	AssetOwnerType_PROJECT AssetOwnerType = 1
	// RESOURCE 表示素材归属于公共资源范围。
	AssetOwnerType_RESOURCE AssetOwnerType = 2
)

func (p AssetOwnerType) String() string {
	switch p {
	case AssetOwnerType_PROJECT:
		return "PROJECT"
	case AssetOwnerType_RESOURCE:
		return "RESOURCE"
	}
	return "<UNSET>"
}

func AssetOwnerTypeFromString(s string) (AssetOwnerType, error) {
	switch s {
	case "PROJECT":
		return AssetOwnerType_PROJECT, nil
	case "RESOURCE":
		return AssetOwnerType_RESOURCE, nil
	}
	return AssetOwnerType(0), fmt.Errorf("not a valid AssetOwnerType string")
}

func AssetOwnerTypePtr(v AssetOwnerType) *AssetOwnerType { return &v }
func (p *AssetOwnerType) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = AssetOwnerType(result.Int64)
	return
}

func (p *AssetOwnerType) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// AssetMediaType 定义服务端根据文件内容识别的媒体类型。
type AssetMediaType int64

const (
	// IMAGE 表示图片素材。
	AssetMediaType_IMAGE AssetMediaType = 1
	// VIDEO 表示视频素材。
	AssetMediaType_VIDEO AssetMediaType = 2
	// AUDIO 表示音频素材。
	AssetMediaType_AUDIO AssetMediaType = 3
)

type StagedUpload struct {
	BlobID    string `json:"blob_id"`
	SizeBytes int64  `json:"size_bytes"`
}

func (p AssetMediaType) String() string {
	switch p {
	case AssetMediaType_IMAGE:
		return "IMAGE"
	case AssetMediaType_VIDEO:
		return "VIDEO"
	case AssetMediaType_AUDIO:
		return "AUDIO"
	}
	return "<UNSET>"
}

func AssetMediaTypeFromString(s string) (AssetMediaType, error) {
	switch s {
	case "IMAGE":
		return AssetMediaType_IMAGE, nil
	case "VIDEO":
		return AssetMediaType_VIDEO, nil
	case "AUDIO":
		return AssetMediaType_AUDIO, nil
	}
	return AssetMediaType(0), fmt.Errorf("not a valid AssetMediaType string")
}

func AssetMediaTypePtr(v AssetMediaType) *AssetMediaType { return &v }
func (p *AssetMediaType) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = AssetMediaType(result.Int64)
	return
}

func (p *AssetMediaType) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

type AssetReviewStatus int64

const (
	AssetReviewStatus_SUBMITTING AssetReviewStatus = 1
	AssetReviewStatus_PROCESSING AssetReviewStatus = 2
	AssetReviewStatus_APPROVED   AssetReviewStatus = 3
	AssetReviewStatus_FAILED     AssetReviewStatus = 4
)

func (p AssetReviewStatus) String() string {
	switch p {
	case AssetReviewStatus_SUBMITTING:
		return "SUBMITTING"
	case AssetReviewStatus_PROCESSING:
		return "PROCESSING"
	case AssetReviewStatus_APPROVED:
		return "APPROVED"
	case AssetReviewStatus_FAILED:
		return "FAILED"
	}
	return "<UNSET>"
}

func AssetReviewStatusFromString(s string) (AssetReviewStatus, error) {
	switch s {
	case "SUBMITTING":
		return AssetReviewStatus_SUBMITTING, nil
	case "PROCESSING":
		return AssetReviewStatus_PROCESSING, nil
	case "APPROVED":
		return AssetReviewStatus_APPROVED, nil
	case "FAILED":
		return AssetReviewStatus_FAILED, nil
	}
	return AssetReviewStatus(0), fmt.Errorf("not a valid AssetReviewStatus string")
}

func AssetReviewStatusPtr(v AssetReviewStatus) *AssetReviewStatus { return &v }
func (p *AssetReviewStatus) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = AssetReviewStatus(result.Int64)
	return
}

func (p *AssetReviewStatus) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// AssetReview 是素材一次送审的展示投影；每次送审均独立持久化。
type AssetReview struct {
	PackageID     string            `json:"PackageID"`
	PackageName   string            `json:"PackageName"`
	Status        AssetReviewStatus `json:"Status"`
	FailureReason *string           `json:"FailureReason,omitempty"`
	SubmittedAt   *common.Timestamp `json:"SubmittedAt,omitempty"`
	UpdatedAt     common.Timestamp  `json:"UpdatedAt"`
}

func NewAssetReview() *AssetReview {
	return &AssetReview{}
}

func (p *AssetReview) InitDefault() {
}

func (p *AssetReview) GetPackageID() (v string) {
	return p.PackageID
}

func (p *AssetReview) GetPackageName() (v string) {
	return p.PackageName
}

func (p *AssetReview) GetStatus() (v AssetReviewStatus) {
	return p.Status
}

var AssetReview_FailureReason_DEFAULT string

func (p *AssetReview) GetFailureReason() (v string) {
	if !p.IsSetFailureReason() {
		return AssetReview_FailureReason_DEFAULT
	}
	return *p.FailureReason
}

var AssetReview_SubmittedAt_DEFAULT common.Timestamp

func (p *AssetReview) GetSubmittedAt() (v common.Timestamp) {
	if !p.IsSetSubmittedAt() {
		return AssetReview_SubmittedAt_DEFAULT
	}
	return *p.SubmittedAt
}

func (p *AssetReview) GetUpdatedAt() (v common.Timestamp) {
	return p.UpdatedAt
}

func (p *AssetReview) IsSetFailureReason() bool {
	return p.FailureReason != nil
}

func (p *AssetReview) IsSetSubmittedAt() bool {
	return p.SubmittedAt != nil
}

func (p *AssetReview) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("AssetReview(%+v)", *p)
}

// Asset 描述已完成持久化注册的素材。
type Asset struct {
	// AssetID 是素材唯一标识。
	AssetID string `json:"AssetID"`
	// OwnerType 是素材的范围归属类型。
	OwnerType AssetOwnerType `json:"OwnerType"`
	// OwnerID 是对应归属对象的唯一标识。
	OwnerID string `json:"OwnerID"`
	// FileName 是用户上传时提供的文件名。
	FileName string `json:"FileName"`
	// MediaType 由服务端根据文件内容识别。
	MediaType AssetMediaType `json:"MediaType"`
	// SizeBytes 是文件字节数。
	SizeBytes int64 `json:"SizeBytes"`
	// CreatedBy 是上传用户 ID。
	CreatedBy string `json:"CreatedBy"`
	// CreatedAt 是素材创建时间。
	CreatedAt common.Timestamp `json:"CreatedAt"`
	// Reviews 按审核创建时间升序返回全部当前有效记录。
	Reviews []*AssetReview `json:"Reviews,omitempty"`
}

func NewAsset() *Asset {
	return &Asset{}
}

func (p *Asset) InitDefault() {
}

func (p *Asset) GetAssetID() (v string) {
	return p.AssetID
}

func (p *Asset) GetOwnerType() (v AssetOwnerType) {
	return p.OwnerType
}

func (p *Asset) GetOwnerID() (v string) {
	return p.OwnerID
}

func (p *Asset) GetFileName() (v string) {
	return p.FileName
}

func (p *Asset) GetMediaType() (v AssetMediaType) {
	return p.MediaType
}

func (p *Asset) GetSizeBytes() (v int64) {
	return p.SizeBytes
}

func (p *Asset) GetCreatedBy() (v string) {
	return p.CreatedBy
}

func (p *Asset) GetCreatedAt() (v common.Timestamp) {
	return p.CreatedAt
}

var Asset_Reviews_DEFAULT []*AssetReview

func (p *Asset) GetReviews() (v []*AssetReview) {
	if !p.IsSetReviews() {
		return Asset_Reviews_DEFAULT
	}
	return p.Reviews
}

func (p *Asset) IsSetReviews() bool {
	return p.Reviews != nil
}

func (p *Asset) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("Asset(%+v)", *p)
}

// AssetReviewUpload 描述送审时需要物化为项目素材的 UP 临时文件。
type AssetReviewUpload struct {
	// ClientID 是调用方为本地草稿分配的稳定标识，用于幂等物化。
	ClientID string `json:"ClientID"`
	// BlobID 是 UP 临时上传返回的文件标识。
	BlobID string `json:"BlobID"`
	// FileName 是用户上传时提供的文件名。
	FileName string `json:"FileName"`
}

func NewAssetReviewUpload() *AssetReviewUpload {
	return &AssetReviewUpload{}
}

func (p *AssetReviewUpload) InitDefault() {
}

func (p *AssetReviewUpload) GetClientID() (v string) {
	return p.ClientID
}

func (p *AssetReviewUpload) GetBlobID() (v string) {
	return p.BlobID
}

func (p *AssetReviewUpload) GetFileName() (v string) {
	return p.FileName
}

func (p *AssetReviewUpload) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("AssetReviewUpload(%+v)", *p)
}

// SubmitAssetReviewRequest 将已有素材或待物化草稿提交到权益包对应的火山素材组并异步送审。
// AssetID 与 Upload 必须且只能提供一个。
type SubmitAssetReviewRequest struct {
	WorkspaceID *string            `json:"WorkspaceID,omitempty"`
	ProjectID   string             `json:"ProjectID"`
	AssetID     *string            `json:"AssetID,omitempty"`
	PackageID   string             `json:"PackageID"`
	Upload      *AssetReviewUpload `json:"Upload,omitempty"`
	Top         *base.TopParam     `json:"Top,omitempty"`
}

func NewSubmitAssetReviewRequest() *SubmitAssetReviewRequest {
	return &SubmitAssetReviewRequest{}
}

func (p *SubmitAssetReviewRequest) InitDefault() {
}

var SubmitAssetReviewRequest_WorkspaceID_DEFAULT string

func (p *SubmitAssetReviewRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return SubmitAssetReviewRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *SubmitAssetReviewRequest) GetProjectID() (v string) {
	return p.ProjectID
}

var SubmitAssetReviewRequest_AssetID_DEFAULT string

func (p *SubmitAssetReviewRequest) GetAssetID() (v string) {
	if !p.IsSetAssetID() {
		return SubmitAssetReviewRequest_AssetID_DEFAULT
	}
	return *p.AssetID
}

func (p *SubmitAssetReviewRequest) GetPackageID() (v string) {
	return p.PackageID
}

var SubmitAssetReviewRequest_Upload_DEFAULT *AssetReviewUpload

func (p *SubmitAssetReviewRequest) GetUpload() (v *AssetReviewUpload) {
	if !p.IsSetUpload() {
		return SubmitAssetReviewRequest_Upload_DEFAULT
	}
	return p.Upload
}

var SubmitAssetReviewRequest_Top_DEFAULT *base.TopParam

func (p *SubmitAssetReviewRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return SubmitAssetReviewRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *SubmitAssetReviewRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *SubmitAssetReviewRequest) IsSetAssetID() bool {
	return p.AssetID != nil
}

func (p *SubmitAssetReviewRequest) IsSetUpload() bool {
	return p.Upload != nil
}

func (p *SubmitAssetReviewRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *SubmitAssetReviewRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("SubmitAssetReviewRequest(%+v)", *p)
}

type SubmitAssetReviewResponse struct {
	// AssetID 是送审使用的正式素材 ID；Upload 输入完成物化后由服务端返回。
	AssetID string       `json:"AssetID"`
	Review  *AssetReview `json:"Review"`
}

func NewSubmitAssetReviewResponse() *SubmitAssetReviewResponse {
	return &SubmitAssetReviewResponse{}
}

func (p *SubmitAssetReviewResponse) InitDefault() {
}

func (p *SubmitAssetReviewResponse) GetAssetID() (v string) {
	return p.AssetID
}

var SubmitAssetReviewResponse_Review_DEFAULT *AssetReview

func (p *SubmitAssetReviewResponse) GetReview() (v *AssetReview) {
	if !p.IsSetReview() {
		return SubmitAssetReviewResponse_Review_DEFAULT
	}
	return p.Review
}

func (p *SubmitAssetReviewResponse) IsSetReview() bool {
	return p.Review != nil
}

func (p *SubmitAssetReviewResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("SubmitAssetReviewResponse(%+v)", *p)
}

// SubmitAssetReviewItem 描述一次批量送审中的素材与权益包组合。
// AssetID 与 Upload 必须且只能提供一个。
type SubmitAssetReviewItem struct {
	AssetID   *string            `json:"AssetID,omitempty"`
	PackageID string             `json:"PackageID"`
	Upload    *AssetReviewUpload `json:"Upload,omitempty"`
}

func NewSubmitAssetReviewItem() *SubmitAssetReviewItem {
	return &SubmitAssetReviewItem{}
}

func (p *SubmitAssetReviewItem) InitDefault() {
}

var SubmitAssetReviewItem_AssetID_DEFAULT string

func (p *SubmitAssetReviewItem) GetAssetID() (v string) {
	if !p.IsSetAssetID() {
		return SubmitAssetReviewItem_AssetID_DEFAULT
	}
	return *p.AssetID
}

func (p *SubmitAssetReviewItem) GetPackageID() (v string) {
	return p.PackageID
}

var SubmitAssetReviewItem_Upload_DEFAULT *AssetReviewUpload

func (p *SubmitAssetReviewItem) GetUpload() (v *AssetReviewUpload) {
	if !p.IsSetUpload() {
		return SubmitAssetReviewItem_Upload_DEFAULT
	}
	return p.Upload
}

func (p *SubmitAssetReviewItem) IsSetAssetID() bool {
	return p.AssetID != nil
}

func (p *SubmitAssetReviewItem) IsSetUpload() bool {
	return p.Upload != nil
}

func (p *SubmitAssetReviewItem) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("SubmitAssetReviewItem(%+v)", *p)
}

type BatchSubmitAssetReviewsRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	// Items 最多包含 100 个素材与权益包组合。
	Items []*SubmitAssetReviewItem `json:"Items"`
	Top   *base.TopParam           `json:"Top,omitempty"`
}

func NewBatchSubmitAssetReviewsRequest() *BatchSubmitAssetReviewsRequest {
	return &BatchSubmitAssetReviewsRequest{}
}

func (p *BatchSubmitAssetReviewsRequest) InitDefault() {
}

var BatchSubmitAssetReviewsRequest_WorkspaceID_DEFAULT string

func (p *BatchSubmitAssetReviewsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchSubmitAssetReviewsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchSubmitAssetReviewsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *BatchSubmitAssetReviewsRequest) GetItems() (v []*SubmitAssetReviewItem) {
	return p.Items
}

var BatchSubmitAssetReviewsRequest_Top_DEFAULT *base.TopParam

func (p *BatchSubmitAssetReviewsRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return BatchSubmitAssetReviewsRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *BatchSubmitAssetReviewsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchSubmitAssetReviewsRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *BatchSubmitAssetReviewsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchSubmitAssetReviewsRequest(%+v)", *p)
}

// SubmitAssetReviewResult 按请求顺序返回成功结果或安全的逐项错误。
type SubmitAssetReviewResult struct {
	AssetID      *string      `json:"AssetID,omitempty"`
	PackageID    string       `json:"PackageID"`
	Review       *AssetReview `json:"Review,omitempty"`
	ErrorCode    *string      `json:"ErrorCode,omitempty"`
	ErrorMessage *string      `json:"ErrorMessage,omitempty"`
}

func NewSubmitAssetReviewResult() *SubmitAssetReviewResult {
	return &SubmitAssetReviewResult{}
}

func (p *SubmitAssetReviewResult) InitDefault() {
}

var SubmitAssetReviewResult_AssetID_DEFAULT string

func (p *SubmitAssetReviewResult) GetAssetID() (v string) {
	if !p.IsSetAssetID() {
		return SubmitAssetReviewResult_AssetID_DEFAULT
	}
	return *p.AssetID
}

func (p *SubmitAssetReviewResult) GetPackageID() (v string) {
	return p.PackageID
}

var SubmitAssetReviewResult_Review_DEFAULT *AssetReview

func (p *SubmitAssetReviewResult) GetReview() (v *AssetReview) {
	if !p.IsSetReview() {
		return SubmitAssetReviewResult_Review_DEFAULT
	}
	return p.Review
}

var SubmitAssetReviewResult_ErrorCode_DEFAULT string

func (p *SubmitAssetReviewResult) GetErrorCode() (v string) {
	if !p.IsSetErrorCode() {
		return SubmitAssetReviewResult_ErrorCode_DEFAULT
	}
	return *p.ErrorCode
}

var SubmitAssetReviewResult_ErrorMessage_DEFAULT string

func (p *SubmitAssetReviewResult) GetErrorMessage() (v string) {
	if !p.IsSetErrorMessage() {
		return SubmitAssetReviewResult_ErrorMessage_DEFAULT
	}
	return *p.ErrorMessage
}

func (p *SubmitAssetReviewResult) IsSetAssetID() bool {
	return p.AssetID != nil
}

func (p *SubmitAssetReviewResult) IsSetReview() bool {
	return p.Review != nil
}

func (p *SubmitAssetReviewResult) IsSetErrorCode() bool {
	return p.ErrorCode != nil
}

func (p *SubmitAssetReviewResult) IsSetErrorMessage() bool {
	return p.ErrorMessage != nil
}

func (p *SubmitAssetReviewResult) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("SubmitAssetReviewResult(%+v)", *p)
}

type BatchSubmitAssetReviewsResponse struct {
	Items []*SubmitAssetReviewResult `json:"Items"`
}

func NewBatchSubmitAssetReviewsResponse() *BatchSubmitAssetReviewsResponse {
	return &BatchSubmitAssetReviewsResponse{}
}

func (p *BatchSubmitAssetReviewsResponse) InitDefault() {
}

func (p *BatchSubmitAssetReviewsResponse) GetItems() (v []*SubmitAssetReviewResult) {
	return p.Items
}

func (p *BatchSubmitAssetReviewsResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchSubmitAssetReviewsResponse(%+v)", *p)
}

// AssetReviews 是单个素材的审核状态集合，不包含素材详情。
type AssetReviews struct {
	AssetID string         `json:"AssetID"`
	Reviews []*AssetReview `json:"Reviews"`
}

func NewAssetReviews() *AssetReviews {
	return &AssetReviews{}
}

func (p *AssetReviews) InitDefault() {
}

func (p *AssetReviews) GetAssetID() (v string) {
	return p.AssetID
}

func (p *AssetReviews) GetReviews() (v []*AssetReview) {
	return p.Reviews
}

func (p *AssetReviews) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("AssetReviews(%+v)", *p)
}

// BatchGetAssetReviews 批量查询项目内素材的当前审核状态；每个素材在每个权益包下最多一条，响应总计最多 200 条 Review。
type BatchGetAssetReviewsRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	ProjectID   string         `json:"ProjectID"`
	AssetIDs    []string       `json:"AssetIDs"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewBatchGetAssetReviewsRequest() *BatchGetAssetReviewsRequest {
	return &BatchGetAssetReviewsRequest{}
}

func (p *BatchGetAssetReviewsRequest) InitDefault() {
}

var BatchGetAssetReviewsRequest_WorkspaceID_DEFAULT string

func (p *BatchGetAssetReviewsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchGetAssetReviewsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchGetAssetReviewsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *BatchGetAssetReviewsRequest) GetAssetIDs() (v []string) {
	return p.AssetIDs
}

var BatchGetAssetReviewsRequest_Top_DEFAULT *base.TopParam

func (p *BatchGetAssetReviewsRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return BatchGetAssetReviewsRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *BatchGetAssetReviewsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchGetAssetReviewsRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *BatchGetAssetReviewsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetAssetReviewsRequest(%+v)", *p)
}

type BatchGetAssetReviewsResponse struct {
	// Items 按 AssetIDs 首次出现顺序返回；尚未送审的素材返回空 Reviews。
	Items []*AssetReviews `json:"Items"`
}

func NewBatchGetAssetReviewsResponse() *BatchGetAssetReviewsResponse {
	return &BatchGetAssetReviewsResponse{}
}

func (p *BatchGetAssetReviewsResponse) InitDefault() {
}

func (p *BatchGetAssetReviewsResponse) GetItems() (v []*AssetReviews) {
	return p.Items
}

func (p *BatchGetAssetReviewsResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetAssetReviewsResponse(%+v)", *p)
}
