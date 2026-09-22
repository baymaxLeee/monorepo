package resource

import (
	"database/sql"
	"database/sql/driver"
	"fmt"
	"github.com/example/monorepo/canvas/internal/api/contracts/asset"
	"github.com/example/monorepo/canvas/internal/api/contracts/base"
	"github.com/example/monorepo/canvas/internal/api/contracts/common"
)

type ResourceType int64

const (
	ResourceType_CHARACTER ResourceType = 1
	ResourceType_SCENE     ResourceType = 2
	ResourceType_PROP      ResourceType = 3
	ResourceType_AUDIO     ResourceType = 4
)

func (p ResourceType) String() string {
	switch p {
	case ResourceType_CHARACTER:
		return "CHARACTER"
	case ResourceType_SCENE:
		return "SCENE"
	case ResourceType_PROP:
		return "PROP"
	case ResourceType_AUDIO:
		return "AUDIO"
	}
	return "<UNSET>"
}

func ResourceTypeFromString(s string) (ResourceType, error) {
	switch s {
	case "CHARACTER":
		return ResourceType_CHARACTER, nil
	case "SCENE":
		return ResourceType_SCENE, nil
	case "PROP":
		return ResourceType_PROP, nil
	case "AUDIO":
		return ResourceType_AUDIO, nil
	}
	return ResourceType(0), fmt.Errorf("not a valid ResourceType string")
}

func ResourceTypePtr(v ResourceType) *ResourceType { return &v }
func (p *ResourceType) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = ResourceType(result.Int64)
	return
}

func (p *ResourceType) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// ResourceOwnerType 是 Resource 的所有权归属。OFFICIAL 为受信系统对账维护的只读官方资源。
type ResourceOwnerType int64

const (
	ResourceOwnerType_PROJECT  ResourceOwnerType = 1
	ResourceOwnerType_OFFICIAL ResourceOwnerType = 2
)

func (p ResourceOwnerType) String() string {
	switch p {
	case ResourceOwnerType_PROJECT:
		return "PROJECT"
	case ResourceOwnerType_OFFICIAL:
		return "OFFICIAL"
	}
	return "<UNSET>"
}

func ResourceOwnerTypeFromString(s string) (ResourceOwnerType, error) {
	switch s {
	case "PROJECT":
		return ResourceOwnerType_PROJECT, nil
	case "OFFICIAL":
		return ResourceOwnerType_OFFICIAL, nil
	}
	return ResourceOwnerType(0), fmt.Errorf("not a valid ResourceOwnerType string")
}

func ResourceOwnerTypePtr(v ResourceOwnerType) *ResourceOwnerType { return &v }
func (p *ResourceOwnerType) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = ResourceOwnerType(result.Int64)
	return
}

func (p *ResourceOwnerType) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

type ResourceSortField int64

const (
	ResourceSortField_CREATED_AT ResourceSortField = 1
	ResourceSortField_UPDATED_AT ResourceSortField = 2
)

func (p ResourceSortField) String() string {
	switch p {
	case ResourceSortField_CREATED_AT:
		return "CREATED_AT"
	case ResourceSortField_UPDATED_AT:
		return "UPDATED_AT"
	}
	return "<UNSET>"
}

func ResourceSortFieldFromString(s string) (ResourceSortField, error) {
	switch s {
	case "CREATED_AT":
		return ResourceSortField_CREATED_AT, nil
	case "UPDATED_AT":
		return ResourceSortField_UPDATED_AT, nil
	}
	return ResourceSortField(0), fmt.Errorf("not a valid ResourceSortField string")
}

func ResourceSortFieldPtr(v ResourceSortField) *ResourceSortField { return &v }
func (p *ResourceSortField) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = ResourceSortField(result.Int64)
	return
}

func (p *ResourceSortField) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

type ResourceAssetSourceType int64

const (
	ResourceAssetSourceType_UPLOAD    ResourceAssetSourceType = 1
	ResourceAssetSourceType_GENERATED ResourceAssetSourceType = 2
)

func (p ResourceAssetSourceType) String() string {
	switch p {
	case ResourceAssetSourceType_UPLOAD:
		return "UPLOAD"
	case ResourceAssetSourceType_GENERATED:
		return "GENERATED"
	}
	return "<UNSET>"
}

func ResourceAssetSourceTypeFromString(s string) (ResourceAssetSourceType, error) {
	switch s {
	case "UPLOAD":
		return ResourceAssetSourceType_UPLOAD, nil
	case "GENERATED":
		return ResourceAssetSourceType_GENERATED, nil
	}
	return ResourceAssetSourceType(0), fmt.Errorf("not a valid ResourceAssetSourceType string")
}

func ResourceAssetSourceTypePtr(v ResourceAssetSourceType) *ResourceAssetSourceType { return &v }
func (p *ResourceAssetSourceType) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = ResourceAssetSourceType(result.Int64)
	return
}

func (p *ResourceAssetSourceType) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

type ResourceAssetGenerationResolution int64

const (
	ResourceAssetGenerationResolution_RESOLUTION_480P  ResourceAssetGenerationResolution = 1
	ResourceAssetGenerationResolution_RESOLUTION_720P  ResourceAssetGenerationResolution = 2
	ResourceAssetGenerationResolution_RESOLUTION_1080P ResourceAssetGenerationResolution = 3
	ResourceAssetGenerationResolution_RESOLUTION_2K    ResourceAssetGenerationResolution = 4
	ResourceAssetGenerationResolution_RESOLUTION_4K    ResourceAssetGenerationResolution = 5
)

func (p ResourceAssetGenerationResolution) String() string {
	switch p {
	case ResourceAssetGenerationResolution_RESOLUTION_480P:
		return "RESOLUTION_480P"
	case ResourceAssetGenerationResolution_RESOLUTION_720P:
		return "RESOLUTION_720P"
	case ResourceAssetGenerationResolution_RESOLUTION_1080P:
		return "RESOLUTION_1080P"
	case ResourceAssetGenerationResolution_RESOLUTION_2K:
		return "RESOLUTION_2K"
	case ResourceAssetGenerationResolution_RESOLUTION_4K:
		return "RESOLUTION_4K"
	}
	return "<UNSET>"
}

func ResourceAssetGenerationResolutionFromString(s string) (ResourceAssetGenerationResolution, error) {
	switch s {
	case "RESOLUTION_480P":
		return ResourceAssetGenerationResolution_RESOLUTION_480P, nil
	case "RESOLUTION_720P":
		return ResourceAssetGenerationResolution_RESOLUTION_720P, nil
	case "RESOLUTION_1080P":
		return ResourceAssetGenerationResolution_RESOLUTION_1080P, nil
	case "RESOLUTION_2K":
		return ResourceAssetGenerationResolution_RESOLUTION_2K, nil
	case "RESOLUTION_4K":
		return ResourceAssetGenerationResolution_RESOLUTION_4K, nil
	}
	return ResourceAssetGenerationResolution(0), fmt.Errorf("not a valid ResourceAssetGenerationResolution string")
}

func ResourceAssetGenerationResolutionPtr(v ResourceAssetGenerationResolution) *ResourceAssetGenerationResolution {
	return &v
}
func (p *ResourceAssetGenerationResolution) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = ResourceAssetGenerationResolution(result.Int64)
	return
}

func (p *ResourceAssetGenerationResolution) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

type ResourceAssetGenerationAspectRatio int64

const (
	ResourceAssetGenerationAspectRatio_RATIO_1_1  ResourceAssetGenerationAspectRatio = 1
	ResourceAssetGenerationAspectRatio_RATIO_3_4  ResourceAssetGenerationAspectRatio = 2
	ResourceAssetGenerationAspectRatio_RATIO_4_3  ResourceAssetGenerationAspectRatio = 3
	ResourceAssetGenerationAspectRatio_RATIO_9_16 ResourceAssetGenerationAspectRatio = 4
	ResourceAssetGenerationAspectRatio_RATIO_16_9 ResourceAssetGenerationAspectRatio = 5
	ResourceAssetGenerationAspectRatio_RATIO_3_2  ResourceAssetGenerationAspectRatio = 6
	ResourceAssetGenerationAspectRatio_RATIO_2_3  ResourceAssetGenerationAspectRatio = 7
	ResourceAssetGenerationAspectRatio_RATIO_21_9 ResourceAssetGenerationAspectRatio = 8
)

func (p ResourceAssetGenerationAspectRatio) String() string {
	switch p {
	case ResourceAssetGenerationAspectRatio_RATIO_1_1:
		return "RATIO_1_1"
	case ResourceAssetGenerationAspectRatio_RATIO_3_4:
		return "RATIO_3_4"
	case ResourceAssetGenerationAspectRatio_RATIO_4_3:
		return "RATIO_4_3"
	case ResourceAssetGenerationAspectRatio_RATIO_9_16:
		return "RATIO_9_16"
	case ResourceAssetGenerationAspectRatio_RATIO_16_9:
		return "RATIO_16_9"
	case ResourceAssetGenerationAspectRatio_RATIO_3_2:
		return "RATIO_3_2"
	case ResourceAssetGenerationAspectRatio_RATIO_2_3:
		return "RATIO_2_3"
	case ResourceAssetGenerationAspectRatio_RATIO_21_9:
		return "RATIO_21_9"
	}
	return "<UNSET>"
}

func ResourceAssetGenerationAspectRatioFromString(s string) (ResourceAssetGenerationAspectRatio, error) {
	switch s {
	case "RATIO_1_1":
		return ResourceAssetGenerationAspectRatio_RATIO_1_1, nil
	case "RATIO_3_4":
		return ResourceAssetGenerationAspectRatio_RATIO_3_4, nil
	case "RATIO_4_3":
		return ResourceAssetGenerationAspectRatio_RATIO_4_3, nil
	case "RATIO_9_16":
		return ResourceAssetGenerationAspectRatio_RATIO_9_16, nil
	case "RATIO_16_9":
		return ResourceAssetGenerationAspectRatio_RATIO_16_9, nil
	case "RATIO_3_2":
		return ResourceAssetGenerationAspectRatio_RATIO_3_2, nil
	case "RATIO_2_3":
		return ResourceAssetGenerationAspectRatio_RATIO_2_3, nil
	case "RATIO_21_9":
		return ResourceAssetGenerationAspectRatio_RATIO_21_9, nil
	}
	return ResourceAssetGenerationAspectRatio(0), fmt.Errorf("not a valid ResourceAssetGenerationAspectRatio string")
}

func ResourceAssetGenerationAspectRatioPtr(v ResourceAssetGenerationAspectRatio) *ResourceAssetGenerationAspectRatio {
	return &v
}
func (p *ResourceAssetGenerationAspectRatio) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = ResourceAssetGenerationAspectRatio(result.Int64)
	return
}

func (p *ResourceAssetGenerationAspectRatio) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

type ResourceAssetGenerationRunStatus int64

const (
	ResourceAssetGenerationRunStatus_QUEUED    ResourceAssetGenerationRunStatus = 1
	ResourceAssetGenerationRunStatus_RUNNING   ResourceAssetGenerationRunStatus = 2
	ResourceAssetGenerationRunStatus_SUCCEEDED ResourceAssetGenerationRunStatus = 3
	ResourceAssetGenerationRunStatus_FAILED    ResourceAssetGenerationRunStatus = 4
	ResourceAssetGenerationRunStatus_CANCELLED ResourceAssetGenerationRunStatus = 5
)

func (p ResourceAssetGenerationRunStatus) String() string {
	switch p {
	case ResourceAssetGenerationRunStatus_QUEUED:
		return "QUEUED"
	case ResourceAssetGenerationRunStatus_RUNNING:
		return "RUNNING"
	case ResourceAssetGenerationRunStatus_SUCCEEDED:
		return "SUCCEEDED"
	case ResourceAssetGenerationRunStatus_FAILED:
		return "FAILED"
	case ResourceAssetGenerationRunStatus_CANCELLED:
		return "CANCELLED"
	}
	return "<UNSET>"
}

func ResourceAssetGenerationRunStatusFromString(s string) (ResourceAssetGenerationRunStatus, error) {
	switch s {
	case "QUEUED":
		return ResourceAssetGenerationRunStatus_QUEUED, nil
	case "RUNNING":
		return ResourceAssetGenerationRunStatus_RUNNING, nil
	case "SUCCEEDED":
		return ResourceAssetGenerationRunStatus_SUCCEEDED, nil
	case "FAILED":
		return ResourceAssetGenerationRunStatus_FAILED, nil
	case "CANCELLED":
		return ResourceAssetGenerationRunStatus_CANCELLED, nil
	}
	return ResourceAssetGenerationRunStatus(0), fmt.Errorf("not a valid ResourceAssetGenerationRunStatus string")
}

func ResourceAssetGenerationRunStatusPtr(v ResourceAssetGenerationRunStatus) *ResourceAssetGenerationRunStatus {
	return &v
}
func (p *ResourceAssetGenerationRunStatus) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = ResourceAssetGenerationRunStatus(result.Int64)
	return
}

func (p *ResourceAssetGenerationRunStatus) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

type ResourceAssetGenerationInputSourceType int64

const (
	ResourceAssetGenerationInputSourceType_UPLOADED       ResourceAssetGenerationInputSourceType = 1
	ResourceAssetGenerationInputSourceType_RESOURCE_ASSET ResourceAssetGenerationInputSourceType = 2
)

func (p ResourceAssetGenerationInputSourceType) String() string {
	switch p {
	case ResourceAssetGenerationInputSourceType_UPLOADED:
		return "UPLOADED"
	case ResourceAssetGenerationInputSourceType_RESOURCE_ASSET:
		return "RESOURCE_ASSET"
	}
	return "<UNSET>"
}

func ResourceAssetGenerationInputSourceTypeFromString(s string) (ResourceAssetGenerationInputSourceType, error) {
	switch s {
	case "UPLOADED":
		return ResourceAssetGenerationInputSourceType_UPLOADED, nil
	case "RESOURCE_ASSET":
		return ResourceAssetGenerationInputSourceType_RESOURCE_ASSET, nil
	}
	return ResourceAssetGenerationInputSourceType(0), fmt.Errorf("not a valid ResourceAssetGenerationInputSourceType string")
}

func ResourceAssetGenerationInputSourceTypePtr(v ResourceAssetGenerationInputSourceType) *ResourceAssetGenerationInputSourceType {
	return &v
}
func (p *ResourceAssetGenerationInputSourceType) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = ResourceAssetGenerationInputSourceType(result.Int64)
	return
}

func (p *ResourceAssetGenerationInputSourceType) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

type ResourceSort struct {
	Field     *ResourceSortField    `json:"Field,omitempty"`
	Direction *common.SortDirection `json:"Direction,omitempty"`
}

func NewResourceSort() *ResourceSort {
	return &ResourceSort{}
}

func (p *ResourceSort) InitDefault() {
}

var ResourceSort_Field_DEFAULT ResourceSortField

func (p *ResourceSort) GetField() (v ResourceSortField) {
	if !p.IsSetField() {
		return ResourceSort_Field_DEFAULT
	}
	return *p.Field
}

var ResourceSort_Direction_DEFAULT common.SortDirection

func (p *ResourceSort) GetDirection() (v common.SortDirection) {
	if !p.IsSetDirection() {
		return ResourceSort_Direction_DEFAULT
	}
	return *p.Direction
}

func (p *ResourceSort) IsSetField() bool {
	return p.Field != nil
}

func (p *ResourceSort) IsSetDirection() bool {
	return p.Direction != nil
}

func (p *ResourceSort) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ResourceSort(%+v)", *p)
}

type ResourceAssetSummary struct {
	ResourceAssetID string  `json:"ResourceAssetID"`
	Name            string  `json:"Name"`
	CurrentAssetID  *string `json:"CurrentAssetID,omitempty"`
	// PreviewURL 是 CurrentAssetID 对应 Asset 的临时签名地址；非 Artifact 或预签名失败时不返回。
	PreviewURL *string `json:"PreviewURL,omitempty"`
	// ExpiresAt 是 PreviewURL 的 UTC 到期时间；PreviewURL 未返回时也不返回。
	ExpiresAt *common.Timestamp `json:"ExpiresAt,omitempty"`
	// MediaType 是当前 Asset 的媒体类型投影。
	MediaType  asset.AssetMediaType    `json:"MediaType"`
	SourceType ResourceAssetSourceType `json:"SourceType"`
	// Reviews 按审核创建时间升序返回当前 Asset 的全部有效记录。
	Reviews []*asset.AssetReview `json:"Reviews,omitempty"`
}

func NewResourceAssetSummary() *ResourceAssetSummary {
	return &ResourceAssetSummary{}
}

func (p *ResourceAssetSummary) InitDefault() {
}

func (p *ResourceAssetSummary) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

func (p *ResourceAssetSummary) GetName() (v string) {
	return p.Name
}

var ResourceAssetSummary_CurrentAssetID_DEFAULT string

func (p *ResourceAssetSummary) GetCurrentAssetID() (v string) {
	if !p.IsSetCurrentAssetID() {
		return ResourceAssetSummary_CurrentAssetID_DEFAULT
	}
	return *p.CurrentAssetID
}

var ResourceAssetSummary_PreviewURL_DEFAULT string

func (p *ResourceAssetSummary) GetPreviewURL() (v string) {
	if !p.IsSetPreviewURL() {
		return ResourceAssetSummary_PreviewURL_DEFAULT
	}
	return *p.PreviewURL
}

var ResourceAssetSummary_ExpiresAt_DEFAULT common.Timestamp

func (p *ResourceAssetSummary) GetExpiresAt() (v common.Timestamp) {
	if !p.IsSetExpiresAt() {
		return ResourceAssetSummary_ExpiresAt_DEFAULT
	}
	return *p.ExpiresAt
}

func (p *ResourceAssetSummary) GetMediaType() (v asset.AssetMediaType) {
	return p.MediaType
}

func (p *ResourceAssetSummary) GetSourceType() (v ResourceAssetSourceType) {
	return p.SourceType
}

var ResourceAssetSummary_Reviews_DEFAULT []*asset.AssetReview

func (p *ResourceAssetSummary) GetReviews() (v []*asset.AssetReview) {
	if !p.IsSetReviews() {
		return ResourceAssetSummary_Reviews_DEFAULT
	}
	return p.Reviews
}

func (p *ResourceAssetSummary) IsSetCurrentAssetID() bool {
	return p.CurrentAssetID != nil
}

func (p *ResourceAssetSummary) IsSetPreviewURL() bool {
	return p.PreviewURL != nil
}

func (p *ResourceAssetSummary) IsSetExpiresAt() bool {
	return p.ExpiresAt != nil
}

func (p *ResourceAssetSummary) IsSetReviews() bool {
	return p.Reviews != nil
}

func (p *ResourceAssetSummary) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ResourceAssetSummary(%+v)", *p)
}

type Resource struct {
	ResourceID           string                `json:"ResourceID"`
	ProjectID            string                `json:"ProjectID"`
	Type                 ResourceType          `json:"Type"`
	Name                 string                `json:"Name"`
	Description          string                `json:"Description"`
	PrimaryResourceAsset *ResourceAssetSummary `json:"PrimaryResourceAsset,omitempty"`
	ResourceAssetCount   int32                 `json:"ResourceAssetCount"`
	Revision             int64                 `json:"Revision"`
	CreatedBy            string                `json:"CreatedBy"`
	CreatedAt            common.Timestamp      `json:"CreatedAt"`
	UpdatedAt            common.Timestamp      `json:"UpdatedAt"`
	// OwnerType 是所有权归属；OFFICIAL 表示官方只读资源（预置音色）。
	OwnerType ResourceOwnerType `json:"OwnerType"`
	// ApprovedResourceAssetCount 是当前素材中至少存在一条有效 APPROVED 审核记录的去重数量。
	ApprovedResourceAssetCount int32 `json:"ApprovedResourceAssetCount"`
}

func NewResource() *Resource {
	return &Resource{}
}

func (p *Resource) InitDefault() {
}

func (p *Resource) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *Resource) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *Resource) GetType() (v ResourceType) {
	return p.Type
}

func (p *Resource) GetName() (v string) {
	return p.Name
}

func (p *Resource) GetDescription() (v string) {
	return p.Description
}

var Resource_PrimaryResourceAsset_DEFAULT *ResourceAssetSummary

func (p *Resource) GetPrimaryResourceAsset() (v *ResourceAssetSummary) {
	if !p.IsSetPrimaryResourceAsset() {
		return Resource_PrimaryResourceAsset_DEFAULT
	}
	return p.PrimaryResourceAsset
}

func (p *Resource) GetResourceAssetCount() (v int32) {
	return p.ResourceAssetCount
}

func (p *Resource) GetRevision() (v int64) {
	return p.Revision
}

func (p *Resource) GetCreatedBy() (v string) {
	return p.CreatedBy
}

func (p *Resource) GetCreatedAt() (v common.Timestamp) {
	return p.CreatedAt
}

func (p *Resource) GetUpdatedAt() (v common.Timestamp) {
	return p.UpdatedAt
}

func (p *Resource) GetOwnerType() (v ResourceOwnerType) {
	return p.OwnerType
}

func (p *Resource) GetApprovedResourceAssetCount() (v int32) {
	return p.ApprovedResourceAssetCount
}

func (p *Resource) IsSetPrimaryResourceAsset() bool {
	return p.PrimaryResourceAsset != nil
}

func (p *Resource) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("Resource(%+v)", *p)
}

type ResourceAsset struct {
	ResourceAssetID string           `json:"ResourceAssetID"`
	ResourceID      string           `json:"ResourceID"`
	Name            string           `json:"Name"`
	SequenceNo      int64            `json:"SequenceNo"`
	CurrentAssetID  *string          `json:"CurrentAssetID,omitempty"`
	IsPrimary       bool             `json:"IsPrimary"`
	Revision        int64            `json:"Revision"`
	CreatedAt       common.Timestamp `json:"CreatedAt"`
	UpdatedAt       common.Timestamp `json:"UpdatedAt"`
	// PreviewURL 是 CurrentAssetID 对应 Asset 的临时签名地址；非 Artifact 或预签名失败时不返回。
	PreviewURL *string `json:"PreviewURL,omitempty"`
	// ExpiresAt 是 PreviewURL 的 UTC 到期时间；PreviewURL 未返回时也不返回。
	ExpiresAt *common.Timestamp `json:"ExpiresAt,omitempty"`
	// MediaType 是当前 Asset 的媒体类型投影。
	MediaType  asset.AssetMediaType    `json:"MediaType"`
	SourceType ResourceAssetSourceType `json:"SourceType"`
	// Reviews 按审核创建时间升序返回当前 Asset 的全部有效记录。
	Reviews []*asset.AssetReview `json:"Reviews,omitempty"`
	// GenerationState 是生成素材最近一次运行的轻量状态；上传素材不返回。
	GenerationState *ResourceAssetGenerationState `json:"GenerationState,omitempty"`
}

func NewResourceAsset() *ResourceAsset {
	return &ResourceAsset{}
}

func (p *ResourceAsset) InitDefault() {
}

func (p *ResourceAsset) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

func (p *ResourceAsset) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *ResourceAsset) GetName() (v string) {
	return p.Name
}

func (p *ResourceAsset) GetSequenceNo() (v int64) {
	return p.SequenceNo
}

var ResourceAsset_CurrentAssetID_DEFAULT string

func (p *ResourceAsset) GetCurrentAssetID() (v string) {
	if !p.IsSetCurrentAssetID() {
		return ResourceAsset_CurrentAssetID_DEFAULT
	}
	return *p.CurrentAssetID
}

func (p *ResourceAsset) GetIsPrimary() (v bool) {
	return p.IsPrimary
}

func (p *ResourceAsset) GetRevision() (v int64) {
	return p.Revision
}

func (p *ResourceAsset) GetCreatedAt() (v common.Timestamp) {
	return p.CreatedAt
}

func (p *ResourceAsset) GetUpdatedAt() (v common.Timestamp) {
	return p.UpdatedAt
}

var ResourceAsset_PreviewURL_DEFAULT string

func (p *ResourceAsset) GetPreviewURL() (v string) {
	if !p.IsSetPreviewURL() {
		return ResourceAsset_PreviewURL_DEFAULT
	}
	return *p.PreviewURL
}

var ResourceAsset_ExpiresAt_DEFAULT common.Timestamp

func (p *ResourceAsset) GetExpiresAt() (v common.Timestamp) {
	if !p.IsSetExpiresAt() {
		return ResourceAsset_ExpiresAt_DEFAULT
	}
	return *p.ExpiresAt
}

func (p *ResourceAsset) GetMediaType() (v asset.AssetMediaType) {
	return p.MediaType
}

func (p *ResourceAsset) GetSourceType() (v ResourceAssetSourceType) {
	return p.SourceType
}

var ResourceAsset_Reviews_DEFAULT []*asset.AssetReview

func (p *ResourceAsset) GetReviews() (v []*asset.AssetReview) {
	if !p.IsSetReviews() {
		return ResourceAsset_Reviews_DEFAULT
	}
	return p.Reviews
}

var ResourceAsset_GenerationState_DEFAULT *ResourceAssetGenerationState

func (p *ResourceAsset) GetGenerationState() (v *ResourceAssetGenerationState) {
	if !p.IsSetGenerationState() {
		return ResourceAsset_GenerationState_DEFAULT
	}
	return p.GenerationState
}

func (p *ResourceAsset) IsSetCurrentAssetID() bool {
	return p.CurrentAssetID != nil
}

func (p *ResourceAsset) IsSetPreviewURL() bool {
	return p.PreviewURL != nil
}

func (p *ResourceAsset) IsSetExpiresAt() bool {
	return p.ExpiresAt != nil
}

func (p *ResourceAsset) IsSetReviews() bool {
	return p.Reviews != nil
}

func (p *ResourceAsset) IsSetGenerationState() bool {
	return p.GenerationState != nil
}

func (p *ResourceAsset) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ResourceAsset(%+v)", *p)
}

// ResourceAssetGenerationState 是生成型资源素材最近一次运行的轻量状态，用于列表展示和批量轮询。
type ResourceAssetGenerationState struct {
	// ResourceAssetID 是该状态所属的资源素材 ID。
	ResourceAssetID string `json:"ResourceAssetID"`
	// TaskRunID 是最近一次生成任务运行 ID。
	TaskRunID string `json:"TaskRunID"`
	// Status 是最近一次生成任务的运行状态。
	Status ResourceAssetGenerationRunStatus `json:"Status"`
	// ErrorCode 是生成失败时供应方返回的原始错误码；供应方未返回或任务未失败时不返回。
	ErrorCode *string `json:"ErrorCode,omitempty"`
	// ErrorMessage 是生成失败时供应方返回的原始错误信息；供应方未返回或任务未失败时不返回。
	ErrorMessage *string `json:"ErrorMessage,omitempty"`
}

func NewResourceAssetGenerationState() *ResourceAssetGenerationState {
	return &ResourceAssetGenerationState{}
}

func (p *ResourceAssetGenerationState) InitDefault() {
}

func (p *ResourceAssetGenerationState) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

func (p *ResourceAssetGenerationState) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *ResourceAssetGenerationState) GetStatus() (v ResourceAssetGenerationRunStatus) {
	return p.Status
}

var ResourceAssetGenerationState_ErrorCode_DEFAULT string

func (p *ResourceAssetGenerationState) GetErrorCode() (v string) {
	if !p.IsSetErrorCode() {
		return ResourceAssetGenerationState_ErrorCode_DEFAULT
	}
	return *p.ErrorCode
}

var ResourceAssetGenerationState_ErrorMessage_DEFAULT string

func (p *ResourceAssetGenerationState) GetErrorMessage() (v string) {
	if !p.IsSetErrorMessage() {
		return ResourceAssetGenerationState_ErrorMessage_DEFAULT
	}
	return *p.ErrorMessage
}

func (p *ResourceAssetGenerationState) IsSetErrorCode() bool {
	return p.ErrorCode != nil
}

func (p *ResourceAssetGenerationState) IsSetErrorMessage() bool {
	return p.ErrorMessage != nil
}

func (p *ResourceAssetGenerationState) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ResourceAssetGenerationState(%+v)", *p)
}

type ResourceAssetGenerationUploadedReference struct {
	AssetID    string  `json:"AssetID"`
	FileName   string  `json:"FileName"`
	PreviewURL *string `json:"PreviewURL,omitempty"`
}

func NewResourceAssetGenerationUploadedReference() *ResourceAssetGenerationUploadedReference {
	return &ResourceAssetGenerationUploadedReference{}
}

func (p *ResourceAssetGenerationUploadedReference) InitDefault() {
}

func (p *ResourceAssetGenerationUploadedReference) GetAssetID() (v string) {
	return p.AssetID
}

func (p *ResourceAssetGenerationUploadedReference) GetFileName() (v string) {
	return p.FileName
}

var ResourceAssetGenerationUploadedReference_PreviewURL_DEFAULT string

func (p *ResourceAssetGenerationUploadedReference) GetPreviewURL() (v string) {
	if !p.IsSetPreviewURL() {
		return ResourceAssetGenerationUploadedReference_PreviewURL_DEFAULT
	}
	return *p.PreviewURL
}

func (p *ResourceAssetGenerationUploadedReference) IsSetPreviewURL() bool {
	return p.PreviewURL != nil
}

func (p *ResourceAssetGenerationUploadedReference) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ResourceAssetGenerationUploadedReference(%+v)", *p)
}

// Patch 输入允许复用既有 Asset，或提交前端 UP 临时上传得到的 Blob；Server 负责把 Blob 注册为 Resource Owner Asset。
type ResourceAssetGenerationUploadedReferenceInput struct {
	AssetID  *string `json:"AssetID,omitempty"`
	BlobID   *string `json:"BlobID,omitempty"`
	FileName *string `json:"FileName,omitempty"`
}

func NewResourceAssetGenerationUploadedReferenceInput() *ResourceAssetGenerationUploadedReferenceInput {
	return &ResourceAssetGenerationUploadedReferenceInput{}
}

func (p *ResourceAssetGenerationUploadedReferenceInput) InitDefault() {
}

var ResourceAssetGenerationUploadedReferenceInput_AssetID_DEFAULT string

func (p *ResourceAssetGenerationUploadedReferenceInput) GetAssetID() (v string) {
	if !p.IsSetAssetID() {
		return ResourceAssetGenerationUploadedReferenceInput_AssetID_DEFAULT
	}
	return *p.AssetID
}

var ResourceAssetGenerationUploadedReferenceInput_BlobID_DEFAULT string

func (p *ResourceAssetGenerationUploadedReferenceInput) GetBlobID() (v string) {
	if !p.IsSetBlobID() {
		return ResourceAssetGenerationUploadedReferenceInput_BlobID_DEFAULT
	}
	return *p.BlobID
}

var ResourceAssetGenerationUploadedReferenceInput_FileName_DEFAULT string

func (p *ResourceAssetGenerationUploadedReferenceInput) GetFileName() (v string) {
	if !p.IsSetFileName() {
		return ResourceAssetGenerationUploadedReferenceInput_FileName_DEFAULT
	}
	return *p.FileName
}

func (p *ResourceAssetGenerationUploadedReferenceInput) IsSetAssetID() bool {
	return p.AssetID != nil
}

func (p *ResourceAssetGenerationUploadedReferenceInput) IsSetBlobID() bool {
	return p.BlobID != nil
}

func (p *ResourceAssetGenerationUploadedReferenceInput) IsSetFileName() bool {
	return p.FileName != nil
}

func (p *ResourceAssetGenerationUploadedReferenceInput) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ResourceAssetGenerationUploadedReferenceInput(%+v)", *p)
}

type ResourceAssetGenerationResourceReference struct {
	ResourceID string `json:"ResourceID"`
	SequenceNo int64  `json:"SequenceNo"`
}

func NewResourceAssetGenerationResourceReference() *ResourceAssetGenerationResourceReference {
	return &ResourceAssetGenerationResourceReference{}
}

func (p *ResourceAssetGenerationResourceReference) InitDefault() {
}

func (p *ResourceAssetGenerationResourceReference) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *ResourceAssetGenerationResourceReference) GetSequenceNo() (v int64) {
	return p.SequenceNo
}

func (p *ResourceAssetGenerationResourceReference) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ResourceAssetGenerationResourceReference(%+v)", *p)
}

type ResourceAssetGeneration struct {
	Prompt             string                                      `json:"Prompt"`
	ModelID            string                                      `json:"ModelID"`
	Resolution         *ResourceAssetGenerationResolution          `json:"Resolution,omitempty"`
	AspectRatio        *ResourceAssetGenerationAspectRatio         `json:"AspectRatio,omitempty"`
	Watermark          bool                                        `json:"Watermark"`
	UploadedReferences []*ResourceAssetGenerationUploadedReference `json:"UploadedReferences"`
	ResourceReferences []*ResourceAssetGenerationResourceReference `json:"ResourceReferences"`
	Revision           int64                                       `json:"Revision"`
	ActiveTaskRunID    *string                                     `json:"ActiveTaskRunID,omitempty"`
	// LatestRun 用于页面重载后恢复最近一次生成的终态；旧调用方可忽略该扩展字段。
	LatestRun *ResourceAssetGenerationRun `json:"LatestRun,omitempty"`
}

func NewResourceAssetGeneration() *ResourceAssetGeneration {
	return &ResourceAssetGeneration{}
}

func (p *ResourceAssetGeneration) InitDefault() {
}

func (p *ResourceAssetGeneration) GetPrompt() (v string) {
	return p.Prompt
}

func (p *ResourceAssetGeneration) GetModelID() (v string) {
	return p.ModelID
}

var ResourceAssetGeneration_Resolution_DEFAULT ResourceAssetGenerationResolution

func (p *ResourceAssetGeneration) GetResolution() (v ResourceAssetGenerationResolution) {
	if !p.IsSetResolution() {
		return ResourceAssetGeneration_Resolution_DEFAULT
	}
	return *p.Resolution
}

var ResourceAssetGeneration_AspectRatio_DEFAULT ResourceAssetGenerationAspectRatio

func (p *ResourceAssetGeneration) GetAspectRatio() (v ResourceAssetGenerationAspectRatio) {
	if !p.IsSetAspectRatio() {
		return ResourceAssetGeneration_AspectRatio_DEFAULT
	}
	return *p.AspectRatio
}

func (p *ResourceAssetGeneration) GetWatermark() (v bool) {
	return p.Watermark
}

func (p *ResourceAssetGeneration) GetUploadedReferences() (v []*ResourceAssetGenerationUploadedReference) {
	return p.UploadedReferences
}

func (p *ResourceAssetGeneration) GetResourceReferences() (v []*ResourceAssetGenerationResourceReference) {
	return p.ResourceReferences
}

func (p *ResourceAssetGeneration) GetRevision() (v int64) {
	return p.Revision
}

var ResourceAssetGeneration_ActiveTaskRunID_DEFAULT string

func (p *ResourceAssetGeneration) GetActiveTaskRunID() (v string) {
	if !p.IsSetActiveTaskRunID() {
		return ResourceAssetGeneration_ActiveTaskRunID_DEFAULT
	}
	return *p.ActiveTaskRunID
}

var ResourceAssetGeneration_LatestRun_DEFAULT *ResourceAssetGenerationRun

func (p *ResourceAssetGeneration) GetLatestRun() (v *ResourceAssetGenerationRun) {
	if !p.IsSetLatestRun() {
		return ResourceAssetGeneration_LatestRun_DEFAULT
	}
	return p.LatestRun
}

func (p *ResourceAssetGeneration) IsSetResolution() bool {
	return p.Resolution != nil
}

func (p *ResourceAssetGeneration) IsSetAspectRatio() bool {
	return p.AspectRatio != nil
}

func (p *ResourceAssetGeneration) IsSetActiveTaskRunID() bool {
	return p.ActiveTaskRunID != nil
}

func (p *ResourceAssetGeneration) IsSetLatestRun() bool {
	return p.LatestRun != nil
}

func (p *ResourceAssetGeneration) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ResourceAssetGeneration(%+v)", *p)
}

type ResourceAssetGenerationPatch struct {
	Prompt             *string                                          `json:"Prompt,omitempty"`
	ModelID            *string                                          `json:"ModelID,omitempty"`
	Resolution         *ResourceAssetGenerationResolution               `json:"Resolution,omitempty"`
	AspectRatio        *ResourceAssetGenerationAspectRatio              `json:"AspectRatio,omitempty"`
	Watermark          *bool                                            `json:"Watermark,omitempty"`
	UploadedReferences []*ResourceAssetGenerationUploadedReferenceInput `json:"UploadedReferences,omitempty"`
	ResourceReferences []*ResourceAssetGenerationResourceReference      `json:"ResourceReferences,omitempty"`
}

func NewResourceAssetGenerationPatch() *ResourceAssetGenerationPatch {
	return &ResourceAssetGenerationPatch{}
}

func (p *ResourceAssetGenerationPatch) InitDefault() {
}

var ResourceAssetGenerationPatch_Prompt_DEFAULT string

func (p *ResourceAssetGenerationPatch) GetPrompt() (v string) {
	if !p.IsSetPrompt() {
		return ResourceAssetGenerationPatch_Prompt_DEFAULT
	}
	return *p.Prompt
}

var ResourceAssetGenerationPatch_ModelID_DEFAULT string

func (p *ResourceAssetGenerationPatch) GetModelID() (v string) {
	if !p.IsSetModelID() {
		return ResourceAssetGenerationPatch_ModelID_DEFAULT
	}
	return *p.ModelID
}

var ResourceAssetGenerationPatch_Resolution_DEFAULT ResourceAssetGenerationResolution

func (p *ResourceAssetGenerationPatch) GetResolution() (v ResourceAssetGenerationResolution) {
	if !p.IsSetResolution() {
		return ResourceAssetGenerationPatch_Resolution_DEFAULT
	}
	return *p.Resolution
}

var ResourceAssetGenerationPatch_AspectRatio_DEFAULT ResourceAssetGenerationAspectRatio

func (p *ResourceAssetGenerationPatch) GetAspectRatio() (v ResourceAssetGenerationAspectRatio) {
	if !p.IsSetAspectRatio() {
		return ResourceAssetGenerationPatch_AspectRatio_DEFAULT
	}
	return *p.AspectRatio
}

var ResourceAssetGenerationPatch_Watermark_DEFAULT bool

func (p *ResourceAssetGenerationPatch) GetWatermark() (v bool) {
	if !p.IsSetWatermark() {
		return ResourceAssetGenerationPatch_Watermark_DEFAULT
	}
	return *p.Watermark
}

var ResourceAssetGenerationPatch_UploadedReferences_DEFAULT []*ResourceAssetGenerationUploadedReferenceInput

func (p *ResourceAssetGenerationPatch) GetUploadedReferences() (v []*ResourceAssetGenerationUploadedReferenceInput) {
	if !p.IsSetUploadedReferences() {
		return ResourceAssetGenerationPatch_UploadedReferences_DEFAULT
	}
	return p.UploadedReferences
}

var ResourceAssetGenerationPatch_ResourceReferences_DEFAULT []*ResourceAssetGenerationResourceReference

func (p *ResourceAssetGenerationPatch) GetResourceReferences() (v []*ResourceAssetGenerationResourceReference) {
	if !p.IsSetResourceReferences() {
		return ResourceAssetGenerationPatch_ResourceReferences_DEFAULT
	}
	return p.ResourceReferences
}

func (p *ResourceAssetGenerationPatch) IsSetPrompt() bool {
	return p.Prompt != nil
}

func (p *ResourceAssetGenerationPatch) IsSetModelID() bool {
	return p.ModelID != nil
}

func (p *ResourceAssetGenerationPatch) IsSetResolution() bool {
	return p.Resolution != nil
}

func (p *ResourceAssetGenerationPatch) IsSetAspectRatio() bool {
	return p.AspectRatio != nil
}

func (p *ResourceAssetGenerationPatch) IsSetWatermark() bool {
	return p.Watermark != nil
}

func (p *ResourceAssetGenerationPatch) IsSetUploadedReferences() bool {
	return p.UploadedReferences != nil
}

func (p *ResourceAssetGenerationPatch) IsSetResourceReferences() bool {
	return p.ResourceReferences != nil
}

func (p *ResourceAssetGenerationPatch) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ResourceAssetGenerationPatch(%+v)", *p)
}

type ResourceAssetGenerationRunInput struct {
	Position   int32                                  `json:"Position"`
	SourceType ResourceAssetGenerationInputSourceType `json:"SourceType"`
	AssetID    string                                 `json:"AssetID"`
}

func NewResourceAssetGenerationRunInput() *ResourceAssetGenerationRunInput {
	return &ResourceAssetGenerationRunInput{}
}

func (p *ResourceAssetGenerationRunInput) InitDefault() {
}

func (p *ResourceAssetGenerationRunInput) GetPosition() (v int32) {
	return p.Position
}

func (p *ResourceAssetGenerationRunInput) GetSourceType() (v ResourceAssetGenerationInputSourceType) {
	return p.SourceType
}

func (p *ResourceAssetGenerationRunInput) GetAssetID() (v string) {
	return p.AssetID
}

func (p *ResourceAssetGenerationRunInput) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ResourceAssetGenerationRunInput(%+v)", *p)
}

type ResourceAssetGenerationRun struct {
	TaskRunID     string                             `json:"TaskRunID"`
	Status        ResourceAssetGenerationRunStatus   `json:"Status"`
	Prompt        string                             `json:"Prompt"`
	ModelID       string                             `json:"ModelID"`
	Resolution    ResourceAssetGenerationResolution  `json:"Resolution"`
	AspectRatio   ResourceAssetGenerationAspectRatio `json:"AspectRatio"`
	Watermark     bool                               `json:"Watermark"`
	Inputs        []*ResourceAssetGenerationRunInput `json:"Inputs"`
	OutputAssetID *string                            `json:"OutputAssetID,omitempty"`
	ErrorCode     *string                            `json:"ErrorCode,omitempty"`
	ErrorMessage  *string                            `json:"ErrorMessage,omitempty"`
	StartedAt     *common.Timestamp                  `json:"StartedAt,omitempty"`
	FinishedAt    *common.Timestamp                  `json:"FinishedAt,omitempty"`
	CreatedAt     common.Timestamp                   `json:"CreatedAt"`
	UpdatedAt     common.Timestamp                   `json:"UpdatedAt"`
}

func NewResourceAssetGenerationRun() *ResourceAssetGenerationRun {
	return &ResourceAssetGenerationRun{}
}

func (p *ResourceAssetGenerationRun) InitDefault() {
}

func (p *ResourceAssetGenerationRun) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *ResourceAssetGenerationRun) GetStatus() (v ResourceAssetGenerationRunStatus) {
	return p.Status
}

func (p *ResourceAssetGenerationRun) GetPrompt() (v string) {
	return p.Prompt
}

func (p *ResourceAssetGenerationRun) GetModelID() (v string) {
	return p.ModelID
}

func (p *ResourceAssetGenerationRun) GetResolution() (v ResourceAssetGenerationResolution) {
	return p.Resolution
}

func (p *ResourceAssetGenerationRun) GetAspectRatio() (v ResourceAssetGenerationAspectRatio) {
	return p.AspectRatio
}

func (p *ResourceAssetGenerationRun) GetWatermark() (v bool) {
	return p.Watermark
}

func (p *ResourceAssetGenerationRun) GetInputs() (v []*ResourceAssetGenerationRunInput) {
	return p.Inputs
}

var ResourceAssetGenerationRun_OutputAssetID_DEFAULT string

func (p *ResourceAssetGenerationRun) GetOutputAssetID() (v string) {
	if !p.IsSetOutputAssetID() {
		return ResourceAssetGenerationRun_OutputAssetID_DEFAULT
	}
	return *p.OutputAssetID
}

var ResourceAssetGenerationRun_ErrorCode_DEFAULT string

func (p *ResourceAssetGenerationRun) GetErrorCode() (v string) {
	if !p.IsSetErrorCode() {
		return ResourceAssetGenerationRun_ErrorCode_DEFAULT
	}
	return *p.ErrorCode
}

var ResourceAssetGenerationRun_ErrorMessage_DEFAULT string

func (p *ResourceAssetGenerationRun) GetErrorMessage() (v string) {
	if !p.IsSetErrorMessage() {
		return ResourceAssetGenerationRun_ErrorMessage_DEFAULT
	}
	return *p.ErrorMessage
}

var ResourceAssetGenerationRun_StartedAt_DEFAULT common.Timestamp

func (p *ResourceAssetGenerationRun) GetStartedAt() (v common.Timestamp) {
	if !p.IsSetStartedAt() {
		return ResourceAssetGenerationRun_StartedAt_DEFAULT
	}
	return *p.StartedAt
}

var ResourceAssetGenerationRun_FinishedAt_DEFAULT common.Timestamp

func (p *ResourceAssetGenerationRun) GetFinishedAt() (v common.Timestamp) {
	if !p.IsSetFinishedAt() {
		return ResourceAssetGenerationRun_FinishedAt_DEFAULT
	}
	return *p.FinishedAt
}

func (p *ResourceAssetGenerationRun) GetCreatedAt() (v common.Timestamp) {
	return p.CreatedAt
}

func (p *ResourceAssetGenerationRun) GetUpdatedAt() (v common.Timestamp) {
	return p.UpdatedAt
}

func (p *ResourceAssetGenerationRun) IsSetOutputAssetID() bool {
	return p.OutputAssetID != nil
}

func (p *ResourceAssetGenerationRun) IsSetErrorCode() bool {
	return p.ErrorCode != nil
}

func (p *ResourceAssetGenerationRun) IsSetErrorMessage() bool {
	return p.ErrorMessage != nil
}

func (p *ResourceAssetGenerationRun) IsSetStartedAt() bool {
	return p.StartedAt != nil
}

func (p *ResourceAssetGenerationRun) IsSetFinishedAt() bool {
	return p.FinishedAt != nil
}

func (p *ResourceAssetGenerationRun) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ResourceAssetGenerationRun(%+v)", *p)
}

type ListResourcesRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	ProjectID   string         `json:"ProjectID"`
	Type        *ResourceType  `json:"Type,omitempty"`
	Keyword     *string        `json:"Keyword,omitempty"`
	Sort        *ResourceSort  `json:"Sort,omitempty"`
	Page        *common.Page   `json:"Page"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewListResourcesRequest() *ListResourcesRequest {
	return &ListResourcesRequest{}
}

func (p *ListResourcesRequest) InitDefault() {
}

var ListResourcesRequest_WorkspaceID_DEFAULT string

func (p *ListResourcesRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return ListResourcesRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *ListResourcesRequest) GetProjectID() (v string) {
	return p.ProjectID
}

var ListResourcesRequest_Type_DEFAULT ResourceType

func (p *ListResourcesRequest) GetType() (v ResourceType) {
	if !p.IsSetType() {
		return ListResourcesRequest_Type_DEFAULT
	}
	return *p.Type
}

var ListResourcesRequest_Keyword_DEFAULT string

func (p *ListResourcesRequest) GetKeyword() (v string) {
	if !p.IsSetKeyword() {
		return ListResourcesRequest_Keyword_DEFAULT
	}
	return *p.Keyword
}

var ListResourcesRequest_Sort_DEFAULT *ResourceSort

func (p *ListResourcesRequest) GetSort() (v *ResourceSort) {
	if !p.IsSetSort() {
		return ListResourcesRequest_Sort_DEFAULT
	}
	return p.Sort
}

var ListResourcesRequest_Page_DEFAULT *common.Page

func (p *ListResourcesRequest) GetPage() (v *common.Page) {
	if !p.IsSetPage() {
		return ListResourcesRequest_Page_DEFAULT
	}
	return p.Page
}

var ListResourcesRequest_Top_DEFAULT *base.TopParam

func (p *ListResourcesRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return ListResourcesRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *ListResourcesRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *ListResourcesRequest) IsSetType() bool {
	return p.Type != nil
}

func (p *ListResourcesRequest) IsSetKeyword() bool {
	return p.Keyword != nil
}

func (p *ListResourcesRequest) IsSetSort() bool {
	return p.Sort != nil
}

func (p *ListResourcesRequest) IsSetPage() bool {
	return p.Page != nil
}

func (p *ListResourcesRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *ListResourcesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListResourcesRequest(%+v)", *p)
}

type ListResourcesResponse struct {
	Items []*Resource        `json:"Items"`
	Page  *common.PageOutput `json:"Page"`
}

func NewListResourcesResponse() *ListResourcesResponse {
	return &ListResourcesResponse{}
}

func (p *ListResourcesResponse) InitDefault() {
}

func (p *ListResourcesResponse) GetItems() (v []*Resource) {
	return p.Items
}

var ListResourcesResponse_Page_DEFAULT *common.PageOutput

func (p *ListResourcesResponse) GetPage() (v *common.PageOutput) {
	if !p.IsSetPage() {
		return ListResourcesResponse_Page_DEFAULT
	}
	return p.Page
}

func (p *ListResourcesResponse) IsSetPage() bool {
	return p.Page != nil
}

func (p *ListResourcesResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListResourcesResponse(%+v)", *p)
}

type ProjectResourceStats struct {
	CharacterCount int32 `json:"CharacterCount"`
	SceneCount     int32 `json:"SceneCount"`
	PropCount      int32 `json:"PropCount"`
	AudioCount     int32 `json:"AudioCount"`
}

func NewProjectResourceStats() *ProjectResourceStats {
	return &ProjectResourceStats{}
}

func (p *ProjectResourceStats) InitDefault() {
}

func (p *ProjectResourceStats) GetCharacterCount() (v int32) {
	return p.CharacterCount
}

func (p *ProjectResourceStats) GetSceneCount() (v int32) {
	return p.SceneCount
}

func (p *ProjectResourceStats) GetPropCount() (v int32) {
	return p.PropCount
}

func (p *ProjectResourceStats) GetAudioCount() (v int32) {
	return p.AudioCount
}

func (p *ProjectResourceStats) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ProjectResourceStats(%+v)", *p)
}

type GetProjectResourceStatsRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	ProjectID   string         `json:"ProjectID"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewGetProjectResourceStatsRequest() *GetProjectResourceStatsRequest {
	return &GetProjectResourceStatsRequest{}
}

func (p *GetProjectResourceStatsRequest) InitDefault() {
}

var GetProjectResourceStatsRequest_WorkspaceID_DEFAULT string

func (p *GetProjectResourceStatsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return GetProjectResourceStatsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *GetProjectResourceStatsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

var GetProjectResourceStatsRequest_Top_DEFAULT *base.TopParam

func (p *GetProjectResourceStatsRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return GetProjectResourceStatsRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *GetProjectResourceStatsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *GetProjectResourceStatsRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *GetProjectResourceStatsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetProjectResourceStatsRequest(%+v)", *p)
}

type GetProjectResourceStatsResponse struct {
	Stats *ProjectResourceStats `json:"Stats"`
}

func NewGetProjectResourceStatsResponse() *GetProjectResourceStatsResponse {
	return &GetProjectResourceStatsResponse{}
}

func (p *GetProjectResourceStatsResponse) InitDefault() {
}

var GetProjectResourceStatsResponse_Stats_DEFAULT *ProjectResourceStats

func (p *GetProjectResourceStatsResponse) GetStats() (v *ProjectResourceStats) {
	if !p.IsSetStats() {
		return GetProjectResourceStatsResponse_Stats_DEFAULT
	}
	return p.Stats
}

func (p *GetProjectResourceStatsResponse) IsSetStats() bool {
	return p.Stats != nil
}

func (p *GetProjectResourceStatsResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetProjectResourceStatsResponse(%+v)", *p)
}

type GetResourceRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	ProjectID   string         `json:"ProjectID"`
	ResourceID  string         `json:"ResourceID"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewGetResourceRequest() *GetResourceRequest {
	return &GetResourceRequest{}
}

func (p *GetResourceRequest) InitDefault() {
}

var GetResourceRequest_WorkspaceID_DEFAULT string

func (p *GetResourceRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return GetResourceRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *GetResourceRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *GetResourceRequest) GetResourceID() (v string) {
	return p.ResourceID
}

var GetResourceRequest_Top_DEFAULT *base.TopParam

func (p *GetResourceRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return GetResourceRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *GetResourceRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *GetResourceRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *GetResourceRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetResourceRequest(%+v)", *p)
}

type GetResourceResponse struct {
	Resource *Resource `json:"Resource"`
}

func NewGetResourceResponse() *GetResourceResponse {
	return &GetResourceResponse{}
}

func (p *GetResourceResponse) InitDefault() {
}

var GetResourceResponse_Resource_DEFAULT *Resource

func (p *GetResourceResponse) GetResource() (v *Resource) {
	if !p.IsSetResource() {
		return GetResourceResponse_Resource_DEFAULT
	}
	return p.Resource
}

func (p *GetResourceResponse) IsSetResource() bool {
	return p.Resource != nil
}

func (p *GetResourceResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetResourceResponse(%+v)", *p)
}

type BatchGetResourcesRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	ProjectID   string         `json:"ProjectID"`
	ResourceIDs []string       `json:"ResourceIDs"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewBatchGetResourcesRequest() *BatchGetResourcesRequest {
	return &BatchGetResourcesRequest{}
}

func (p *BatchGetResourcesRequest) InitDefault() {
}

var BatchGetResourcesRequest_WorkspaceID_DEFAULT string

func (p *BatchGetResourcesRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchGetResourcesRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchGetResourcesRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *BatchGetResourcesRequest) GetResourceIDs() (v []string) {
	return p.ResourceIDs
}

var BatchGetResourcesRequest_Top_DEFAULT *base.TopParam

func (p *BatchGetResourcesRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return BatchGetResourcesRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *BatchGetResourcesRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchGetResourcesRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *BatchGetResourcesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetResourcesRequest(%+v)", *p)
}

type BatchGetResourcesResponse struct {
	Items []*Resource `json:"Items"`
}

func NewBatchGetResourcesResponse() *BatchGetResourcesResponse {
	return &BatchGetResourcesResponse{}
}

func (p *BatchGetResourcesResponse) InitDefault() {
}

func (p *BatchGetResourcesResponse) GetItems() (v []*Resource) {
	return p.Items
}

func (p *BatchGetResourcesResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetResourcesResponse(%+v)", *p)
}

type CreateResourceInitialAsset struct {
	BlobID   string  `json:"BlobID"`
	FileName string  `json:"FileName"`
	Name     *string `json:"Name,omitempty"`
}

func NewCreateResourceInitialAsset() *CreateResourceInitialAsset {
	return &CreateResourceInitialAsset{}
}

func (p *CreateResourceInitialAsset) InitDefault() {
}

func (p *CreateResourceInitialAsset) GetBlobID() (v string) {
	return p.BlobID
}

func (p *CreateResourceInitialAsset) GetFileName() (v string) {
	return p.FileName
}

var CreateResourceInitialAsset_Name_DEFAULT string

func (p *CreateResourceInitialAsset) GetName() (v string) {
	if !p.IsSetName() {
		return CreateResourceInitialAsset_Name_DEFAULT
	}
	return *p.Name
}

func (p *CreateResourceInitialAsset) IsSetName() bool {
	return p.Name != nil
}

func (p *CreateResourceInitialAsset) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateResourceInitialAsset(%+v)", *p)
}

type CreateResourceRequest struct {
	WorkspaceID   *string                       `json:"WorkspaceID,omitempty"`
	ProjectID     string                        `json:"ProjectID"`
	Type          ResourceType                  `json:"Type"`
	Name          string                        `json:"Name"`
	Description   *string                       `json:"Description,omitempty"`
	InitialAssets []*CreateResourceInitialAsset `json:"InitialAssets,omitempty"`
	Top           *base.TopParam                `json:"Top,omitempty"`
}

func NewCreateResourceRequest() *CreateResourceRequest {
	return &CreateResourceRequest{}
}

func (p *CreateResourceRequest) InitDefault() {
}

var CreateResourceRequest_WorkspaceID_DEFAULT string

func (p *CreateResourceRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CreateResourceRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CreateResourceRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CreateResourceRequest) GetType() (v ResourceType) {
	return p.Type
}

func (p *CreateResourceRequest) GetName() (v string) {
	return p.Name
}

var CreateResourceRequest_Description_DEFAULT string

func (p *CreateResourceRequest) GetDescription() (v string) {
	if !p.IsSetDescription() {
		return CreateResourceRequest_Description_DEFAULT
	}
	return *p.Description
}

var CreateResourceRequest_InitialAssets_DEFAULT []*CreateResourceInitialAsset

func (p *CreateResourceRequest) GetInitialAssets() (v []*CreateResourceInitialAsset) {
	if !p.IsSetInitialAssets() {
		return CreateResourceRequest_InitialAssets_DEFAULT
	}
	return p.InitialAssets
}

var CreateResourceRequest_Top_DEFAULT *base.TopParam

func (p *CreateResourceRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return CreateResourceRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *CreateResourceRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CreateResourceRequest) IsSetDescription() bool {
	return p.Description != nil
}

func (p *CreateResourceRequest) IsSetInitialAssets() bool {
	return p.InitialAssets != nil
}

func (p *CreateResourceRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *CreateResourceRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateResourceRequest(%+v)", *p)
}

type CreateResourceResponse struct {
	Resource       *Resource        `json:"Resource"`
	ResourceAssets []*ResourceAsset `json:"ResourceAssets"`
}

func NewCreateResourceResponse() *CreateResourceResponse {
	return &CreateResourceResponse{}
}

func (p *CreateResourceResponse) InitDefault() {
}

var CreateResourceResponse_Resource_DEFAULT *Resource

func (p *CreateResourceResponse) GetResource() (v *Resource) {
	if !p.IsSetResource() {
		return CreateResourceResponse_Resource_DEFAULT
	}
	return p.Resource
}

func (p *CreateResourceResponse) GetResourceAssets() (v []*ResourceAsset) {
	return p.ResourceAssets
}

func (p *CreateResourceResponse) IsSetResource() bool {
	return p.Resource != nil
}

func (p *CreateResourceResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateResourceResponse(%+v)", *p)
}

// CreateResourceFromAsset 将同项目中一个 Project-owned Asset 原子地加入资源库。
// Server 复用源 Asset 的 Artifact 创建 Resource-owned Asset，并把首个 ResourceAsset 设为 Primary。
// CanvasID 与 CanvasNodeID 必须同时提供；提供时还会在同一事务内把节点当前 Asset 引用切换为 ResourceAssetID。
type CreateResourceFromAssetRequest struct {
	WorkspaceID  *string        `json:"WorkspaceID,omitempty"`
	ProjectID    string         `json:"ProjectID"`
	AssetID      string         `json:"AssetID"`
	Type         ResourceType   `json:"Type"`
	Name         string         `json:"Name"`
	Description  *string        `json:"Description,omitempty"`
	CanvasID     *string        `json:"CanvasID,omitempty"`
	CanvasNodeID *string        `json:"CanvasNodeID,omitempty"`
	Top          *base.TopParam `json:"Top,omitempty"`
}

func NewCreateResourceFromAssetRequest() *CreateResourceFromAssetRequest {
	return &CreateResourceFromAssetRequest{}
}

func (p *CreateResourceFromAssetRequest) InitDefault() {
}

var CreateResourceFromAssetRequest_WorkspaceID_DEFAULT string

func (p *CreateResourceFromAssetRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CreateResourceFromAssetRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CreateResourceFromAssetRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CreateResourceFromAssetRequest) GetAssetID() (v string) {
	return p.AssetID
}

func (p *CreateResourceFromAssetRequest) GetType() (v ResourceType) {
	return p.Type
}

func (p *CreateResourceFromAssetRequest) GetName() (v string) {
	return p.Name
}

var CreateResourceFromAssetRequest_Description_DEFAULT string

func (p *CreateResourceFromAssetRequest) GetDescription() (v string) {
	if !p.IsSetDescription() {
		return CreateResourceFromAssetRequest_Description_DEFAULT
	}
	return *p.Description
}

var CreateResourceFromAssetRequest_CanvasID_DEFAULT string

func (p *CreateResourceFromAssetRequest) GetCanvasID() (v string) {
	if !p.IsSetCanvasID() {
		return CreateResourceFromAssetRequest_CanvasID_DEFAULT
	}
	return *p.CanvasID
}

var CreateResourceFromAssetRequest_CanvasNodeID_DEFAULT string

func (p *CreateResourceFromAssetRequest) GetCanvasNodeID() (v string) {
	if !p.IsSetCanvasNodeID() {
		return CreateResourceFromAssetRequest_CanvasNodeID_DEFAULT
	}
	return *p.CanvasNodeID
}

var CreateResourceFromAssetRequest_Top_DEFAULT *base.TopParam

func (p *CreateResourceFromAssetRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return CreateResourceFromAssetRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *CreateResourceFromAssetRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CreateResourceFromAssetRequest) IsSetDescription() bool {
	return p.Description != nil
}

func (p *CreateResourceFromAssetRequest) IsSetCanvasID() bool {
	return p.CanvasID != nil
}

func (p *CreateResourceFromAssetRequest) IsSetCanvasNodeID() bool {
	return p.CanvasNodeID != nil
}

func (p *CreateResourceFromAssetRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *CreateResourceFromAssetRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateResourceFromAssetRequest(%+v)", *p)
}

type CanvasNodeResourceAssetBinding struct {
	CanvasID           string `json:"CanvasID"`
	CanvasNodeID       string `json:"CanvasNodeID"`
	ResourceAssetID    string `json:"ResourceAssetID"`
	CurrentAssetID     string `json:"CurrentAssetID"`
	CanvasNodeRevision int64  `json:"CanvasNodeRevision"`
}

func NewCanvasNodeResourceAssetBinding() *CanvasNodeResourceAssetBinding {
	return &CanvasNodeResourceAssetBinding{}
}

func (p *CanvasNodeResourceAssetBinding) InitDefault() {
}

func (p *CanvasNodeResourceAssetBinding) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *CanvasNodeResourceAssetBinding) GetCanvasNodeID() (v string) {
	return p.CanvasNodeID
}

func (p *CanvasNodeResourceAssetBinding) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

func (p *CanvasNodeResourceAssetBinding) GetCurrentAssetID() (v string) {
	return p.CurrentAssetID
}

func (p *CanvasNodeResourceAssetBinding) GetCanvasNodeRevision() (v int64) {
	return p.CanvasNodeRevision
}

func (p *CanvasNodeResourceAssetBinding) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeResourceAssetBinding(%+v)", *p)
}

type CreateResourceFromAssetResponse struct {
	Resource          *Resource                       `json:"Resource"`
	ResourceAsset     *ResourceAsset                  `json:"ResourceAsset"`
	CanvasNodeBinding *CanvasNodeResourceAssetBinding `json:"CanvasNodeBinding,omitempty"`
}

func NewCreateResourceFromAssetResponse() *CreateResourceFromAssetResponse {
	return &CreateResourceFromAssetResponse{}
}

func (p *CreateResourceFromAssetResponse) InitDefault() {
}

var CreateResourceFromAssetResponse_Resource_DEFAULT *Resource

func (p *CreateResourceFromAssetResponse) GetResource() (v *Resource) {
	if !p.IsSetResource() {
		return CreateResourceFromAssetResponse_Resource_DEFAULT
	}
	return p.Resource
}

var CreateResourceFromAssetResponse_ResourceAsset_DEFAULT *ResourceAsset

func (p *CreateResourceFromAssetResponse) GetResourceAsset() (v *ResourceAsset) {
	if !p.IsSetResourceAsset() {
		return CreateResourceFromAssetResponse_ResourceAsset_DEFAULT
	}
	return p.ResourceAsset
}

var CreateResourceFromAssetResponse_CanvasNodeBinding_DEFAULT *CanvasNodeResourceAssetBinding

func (p *CreateResourceFromAssetResponse) GetCanvasNodeBinding() (v *CanvasNodeResourceAssetBinding) {
	if !p.IsSetCanvasNodeBinding() {
		return CreateResourceFromAssetResponse_CanvasNodeBinding_DEFAULT
	}
	return p.CanvasNodeBinding
}

func (p *CreateResourceFromAssetResponse) IsSetResource() bool {
	return p.Resource != nil
}

func (p *CreateResourceFromAssetResponse) IsSetResourceAsset() bool {
	return p.ResourceAsset != nil
}

func (p *CreateResourceFromAssetResponse) IsSetCanvasNodeBinding() bool {
	return p.CanvasNodeBinding != nil
}

func (p *CreateResourceFromAssetResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateResourceFromAssetResponse(%+v)", *p)
}

type UpdateResourceRequest struct {
	WorkspaceID      *string        `json:"WorkspaceID,omitempty"`
	ProjectID        string         `json:"ProjectID"`
	ResourceID       string         `json:"ResourceID"`
	Name             *string        `json:"Name,omitempty"`
	Description      *string        `json:"Description,omitempty"`
	ExpectedRevision int64          `json:"ExpectedRevision"`
	Top              *base.TopParam `json:"Top,omitempty"`
}

func NewUpdateResourceRequest() *UpdateResourceRequest {
	return &UpdateResourceRequest{}
}

func (p *UpdateResourceRequest) InitDefault() {
}

var UpdateResourceRequest_WorkspaceID_DEFAULT string

func (p *UpdateResourceRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return UpdateResourceRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *UpdateResourceRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *UpdateResourceRequest) GetResourceID() (v string) {
	return p.ResourceID
}

var UpdateResourceRequest_Name_DEFAULT string

func (p *UpdateResourceRequest) GetName() (v string) {
	if !p.IsSetName() {
		return UpdateResourceRequest_Name_DEFAULT
	}
	return *p.Name
}

var UpdateResourceRequest_Description_DEFAULT string

func (p *UpdateResourceRequest) GetDescription() (v string) {
	if !p.IsSetDescription() {
		return UpdateResourceRequest_Description_DEFAULT
	}
	return *p.Description
}

func (p *UpdateResourceRequest) GetExpectedRevision() (v int64) {
	return p.ExpectedRevision
}

var UpdateResourceRequest_Top_DEFAULT *base.TopParam

func (p *UpdateResourceRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return UpdateResourceRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *UpdateResourceRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *UpdateResourceRequest) IsSetName() bool {
	return p.Name != nil
}

func (p *UpdateResourceRequest) IsSetDescription() bool {
	return p.Description != nil
}

func (p *UpdateResourceRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *UpdateResourceRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateResourceRequest(%+v)", *p)
}

type UpdateResourceResponse struct {
	Resource *Resource `json:"Resource"`
}

func NewUpdateResourceResponse() *UpdateResourceResponse {
	return &UpdateResourceResponse{}
}

func (p *UpdateResourceResponse) InitDefault() {
}

var UpdateResourceResponse_Resource_DEFAULT *Resource

func (p *UpdateResourceResponse) GetResource() (v *Resource) {
	if !p.IsSetResource() {
		return UpdateResourceResponse_Resource_DEFAULT
	}
	return p.Resource
}

func (p *UpdateResourceResponse) IsSetResource() bool {
	return p.Resource != nil
}

func (p *UpdateResourceResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateResourceResponse(%+v)", *p)
}

type DeleteResourceRequest struct {
	WorkspaceID      *string        `json:"WorkspaceID,omitempty"`
	ProjectID        string         `json:"ProjectID"`
	ResourceID       string         `json:"ResourceID"`
	ExpectedRevision int64          `json:"ExpectedRevision"`
	Top              *base.TopParam `json:"Top,omitempty"`
}

func NewDeleteResourceRequest() *DeleteResourceRequest {
	return &DeleteResourceRequest{}
}

func (p *DeleteResourceRequest) InitDefault() {
}

var DeleteResourceRequest_WorkspaceID_DEFAULT string

func (p *DeleteResourceRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return DeleteResourceRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *DeleteResourceRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *DeleteResourceRequest) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *DeleteResourceRequest) GetExpectedRevision() (v int64) {
	return p.ExpectedRevision
}

var DeleteResourceRequest_Top_DEFAULT *base.TopParam

func (p *DeleteResourceRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return DeleteResourceRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *DeleteResourceRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *DeleteResourceRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *DeleteResourceRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DeleteResourceRequest(%+v)", *p)
}

type DeleteResourceTarget struct {
	ResourceID       string `json:"ResourceID"`
	ExpectedRevision int64  `json:"ExpectedRevision"`
}

func NewDeleteResourceTarget() *DeleteResourceTarget {
	return &DeleteResourceTarget{}
}

func (p *DeleteResourceTarget) InitDefault() {
}

func (p *DeleteResourceTarget) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *DeleteResourceTarget) GetExpectedRevision() (v int64) {
	return p.ExpectedRevision
}

func (p *DeleteResourceTarget) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DeleteResourceTarget(%+v)", *p)
}

type BatchDeleteResourcesRequest struct {
	WorkspaceID *string                 `json:"WorkspaceID,omitempty"`
	ProjectID   string                  `json:"ProjectID"`
	Targets     []*DeleteResourceTarget `json:"Targets"`
	Top         *base.TopParam          `json:"Top,omitempty"`
}

func NewBatchDeleteResourcesRequest() *BatchDeleteResourcesRequest {
	return &BatchDeleteResourcesRequest{}
}

func (p *BatchDeleteResourcesRequest) InitDefault() {
}

var BatchDeleteResourcesRequest_WorkspaceID_DEFAULT string

func (p *BatchDeleteResourcesRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchDeleteResourcesRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchDeleteResourcesRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *BatchDeleteResourcesRequest) GetTargets() (v []*DeleteResourceTarget) {
	return p.Targets
}

var BatchDeleteResourcesRequest_Top_DEFAULT *base.TopParam

func (p *BatchDeleteResourcesRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return BatchDeleteResourcesRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *BatchDeleteResourcesRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchDeleteResourcesRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *BatchDeleteResourcesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchDeleteResourcesRequest(%+v)", *p)
}

type ListResourceAssetsRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	ProjectID   string         `json:"ProjectID"`
	ResourceID  string         `json:"ResourceID"`
	Page        *common.Page   `json:"Page"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewListResourceAssetsRequest() *ListResourceAssetsRequest {
	return &ListResourceAssetsRequest{}
}

func (p *ListResourceAssetsRequest) InitDefault() {
}

var ListResourceAssetsRequest_WorkspaceID_DEFAULT string

func (p *ListResourceAssetsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return ListResourceAssetsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *ListResourceAssetsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *ListResourceAssetsRequest) GetResourceID() (v string) {
	return p.ResourceID
}

var ListResourceAssetsRequest_Page_DEFAULT *common.Page

func (p *ListResourceAssetsRequest) GetPage() (v *common.Page) {
	if !p.IsSetPage() {
		return ListResourceAssetsRequest_Page_DEFAULT
	}
	return p.Page
}

var ListResourceAssetsRequest_Top_DEFAULT *base.TopParam

func (p *ListResourceAssetsRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return ListResourceAssetsRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *ListResourceAssetsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *ListResourceAssetsRequest) IsSetPage() bool {
	return p.Page != nil
}

func (p *ListResourceAssetsRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *ListResourceAssetsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListResourceAssetsRequest(%+v)", *p)
}

type ListResourceAssetsResponse struct {
	Items []*ResourceAsset   `json:"Items"`
	Page  *common.PageOutput `json:"Page"`
}

func NewListResourceAssetsResponse() *ListResourceAssetsResponse {
	return &ListResourceAssetsResponse{}
}

func (p *ListResourceAssetsResponse) InitDefault() {
}

func (p *ListResourceAssetsResponse) GetItems() (v []*ResourceAsset) {
	return p.Items
}

var ListResourceAssetsResponse_Page_DEFAULT *common.PageOutput

func (p *ListResourceAssetsResponse) GetPage() (v *common.PageOutput) {
	if !p.IsSetPage() {
		return ListResourceAssetsResponse_Page_DEFAULT
	}
	return p.Page
}

func (p *ListResourceAssetsResponse) IsSetPage() bool {
	return p.Page != nil
}

func (p *ListResourceAssetsResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListResourceAssetsResponse(%+v)", *p)
}

type BatchListResourceAssetsRequest struct {
	WorkspaceID *string        `json:"WorkspaceID,omitempty"`
	ProjectID   string         `json:"ProjectID"`
	ResourceIDs []string       `json:"ResourceIDs"`
	Top         *base.TopParam `json:"Top,omitempty"`
}

func NewBatchListResourceAssetsRequest() *BatchListResourceAssetsRequest {
	return &BatchListResourceAssetsRequest{}
}

func (p *BatchListResourceAssetsRequest) InitDefault() {
}

var BatchListResourceAssetsRequest_WorkspaceID_DEFAULT string

func (p *BatchListResourceAssetsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchListResourceAssetsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchListResourceAssetsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *BatchListResourceAssetsRequest) GetResourceIDs() (v []string) {
	return p.ResourceIDs
}

var BatchListResourceAssetsRequest_Top_DEFAULT *base.TopParam

func (p *BatchListResourceAssetsRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return BatchListResourceAssetsRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *BatchListResourceAssetsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchListResourceAssetsRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *BatchListResourceAssetsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchListResourceAssetsRequest(%+v)", *p)
}

type ResourceAssetGroup struct {
	ResourceID string           `json:"ResourceID"`
	Items      []*ResourceAsset `json:"Items"`
}

func NewResourceAssetGroup() *ResourceAssetGroup {
	return &ResourceAssetGroup{}
}

func (p *ResourceAssetGroup) InitDefault() {
}

func (p *ResourceAssetGroup) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *ResourceAssetGroup) GetItems() (v []*ResourceAsset) {
	return p.Items
}

func (p *ResourceAssetGroup) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ResourceAssetGroup(%+v)", *p)
}

type BatchListResourceAssetsResponse struct {
	Groups []*ResourceAssetGroup `json:"Groups"`
}

func NewBatchListResourceAssetsResponse() *BatchListResourceAssetsResponse {
	return &BatchListResourceAssetsResponse{}
}

func (p *BatchListResourceAssetsResponse) InitDefault() {
}

func (p *BatchListResourceAssetsResponse) GetGroups() (v []*ResourceAssetGroup) {
	return p.Groups
}

func (p *BatchListResourceAssetsResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchListResourceAssetsResponse(%+v)", *p)
}

type CreateResourceAssetRequest struct {
	WorkspaceID              *string        `json:"WorkspaceID,omitempty"`
	ProjectID                string         `json:"ProjectID"`
	ResourceID               string         `json:"ResourceID"`
	AssetID                  *string        `json:"AssetID,omitempty"`
	Name                     *string        `json:"Name,omitempty"`
	ExpectedResourceRevision int64          `json:"ExpectedResourceRevision"`
	BlobID                   *string        `json:"BlobID,omitempty"`
	FileName                 *string        `json:"FileName,omitempty"`
	Top                      *base.TopParam `json:"Top,omitempty"`
}

func NewCreateResourceAssetRequest() *CreateResourceAssetRequest {
	return &CreateResourceAssetRequest{}
}

func (p *CreateResourceAssetRequest) InitDefault() {
}

var CreateResourceAssetRequest_WorkspaceID_DEFAULT string

func (p *CreateResourceAssetRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CreateResourceAssetRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CreateResourceAssetRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CreateResourceAssetRequest) GetResourceID() (v string) {
	return p.ResourceID
}

var CreateResourceAssetRequest_AssetID_DEFAULT string

func (p *CreateResourceAssetRequest) GetAssetID() (v string) {
	if !p.IsSetAssetID() {
		return CreateResourceAssetRequest_AssetID_DEFAULT
	}
	return *p.AssetID
}

var CreateResourceAssetRequest_Name_DEFAULT string

func (p *CreateResourceAssetRequest) GetName() (v string) {
	if !p.IsSetName() {
		return CreateResourceAssetRequest_Name_DEFAULT
	}
	return *p.Name
}

func (p *CreateResourceAssetRequest) GetExpectedResourceRevision() (v int64) {
	return p.ExpectedResourceRevision
}

var CreateResourceAssetRequest_BlobID_DEFAULT string

func (p *CreateResourceAssetRequest) GetBlobID() (v string) {
	if !p.IsSetBlobID() {
		return CreateResourceAssetRequest_BlobID_DEFAULT
	}
	return *p.BlobID
}

var CreateResourceAssetRequest_FileName_DEFAULT string

func (p *CreateResourceAssetRequest) GetFileName() (v string) {
	if !p.IsSetFileName() {
		return CreateResourceAssetRequest_FileName_DEFAULT
	}
	return *p.FileName
}

var CreateResourceAssetRequest_Top_DEFAULT *base.TopParam

func (p *CreateResourceAssetRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return CreateResourceAssetRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *CreateResourceAssetRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CreateResourceAssetRequest) IsSetAssetID() bool {
	return p.AssetID != nil
}

func (p *CreateResourceAssetRequest) IsSetName() bool {
	return p.Name != nil
}

func (p *CreateResourceAssetRequest) IsSetBlobID() bool {
	return p.BlobID != nil
}

func (p *CreateResourceAssetRequest) IsSetFileName() bool {
	return p.FileName != nil
}

func (p *CreateResourceAssetRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *CreateResourceAssetRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateResourceAssetRequest(%+v)", *p)
}

type CreateResourceAssetResponse struct {
	ResourceAsset *ResourceAsset `json:"ResourceAsset"`
}

func NewCreateResourceAssetResponse() *CreateResourceAssetResponse {
	return &CreateResourceAssetResponse{}
}

func (p *CreateResourceAssetResponse) InitDefault() {
}

var CreateResourceAssetResponse_ResourceAsset_DEFAULT *ResourceAsset

func (p *CreateResourceAssetResponse) GetResourceAsset() (v *ResourceAsset) {
	if !p.IsSetResourceAsset() {
		return CreateResourceAssetResponse_ResourceAsset_DEFAULT
	}
	return p.ResourceAsset
}

func (p *CreateResourceAssetResponse) IsSetResourceAsset() bool {
	return p.ResourceAsset != nil
}

func (p *CreateResourceAssetResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateResourceAssetResponse(%+v)", *p)
}

type CreateGeneratedResourceAssetRequest struct {
	WorkspaceID              *string        `json:"WorkspaceID,omitempty"`
	ProjectID                string         `json:"ProjectID"`
	ResourceID               string         `json:"ResourceID"`
	ExpectedResourceRevision int64          `json:"ExpectedResourceRevision"`
	Top                      *base.TopParam `json:"Top,omitempty"`
}

func NewCreateGeneratedResourceAssetRequest() *CreateGeneratedResourceAssetRequest {
	return &CreateGeneratedResourceAssetRequest{}
}

func (p *CreateGeneratedResourceAssetRequest) InitDefault() {
}

var CreateGeneratedResourceAssetRequest_WorkspaceID_DEFAULT string

func (p *CreateGeneratedResourceAssetRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CreateGeneratedResourceAssetRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CreateGeneratedResourceAssetRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CreateGeneratedResourceAssetRequest) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *CreateGeneratedResourceAssetRequest) GetExpectedResourceRevision() (v int64) {
	return p.ExpectedResourceRevision
}

var CreateGeneratedResourceAssetRequest_Top_DEFAULT *base.TopParam

func (p *CreateGeneratedResourceAssetRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return CreateGeneratedResourceAssetRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *CreateGeneratedResourceAssetRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CreateGeneratedResourceAssetRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *CreateGeneratedResourceAssetRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateGeneratedResourceAssetRequest(%+v)", *p)
}

type CreateGeneratedResourceAssetResponse struct {
	ResourceAsset *ResourceAsset `json:"ResourceAsset"`
}

func NewCreateGeneratedResourceAssetResponse() *CreateGeneratedResourceAssetResponse {
	return &CreateGeneratedResourceAssetResponse{}
}

func (p *CreateGeneratedResourceAssetResponse) InitDefault() {
}

var CreateGeneratedResourceAssetResponse_ResourceAsset_DEFAULT *ResourceAsset

func (p *CreateGeneratedResourceAssetResponse) GetResourceAsset() (v *ResourceAsset) {
	if !p.IsSetResourceAsset() {
		return CreateGeneratedResourceAssetResponse_ResourceAsset_DEFAULT
	}
	return p.ResourceAsset
}

func (p *CreateGeneratedResourceAssetResponse) IsSetResourceAsset() bool {
	return p.ResourceAsset != nil
}

func (p *CreateGeneratedResourceAssetResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateGeneratedResourceAssetResponse(%+v)", *p)
}

type ReplaceUploadedResourceAssetRequest struct {
	WorkspaceID                   *string        `json:"WorkspaceID,omitempty"`
	ProjectID                     string         `json:"ProjectID"`
	ResourceID                    string         `json:"ResourceID"`
	ResourceAssetID               string         `json:"ResourceAssetID"`
	BlobID                        string         `json:"BlobID"`
	FileName                      string         `json:"FileName"`
	ExpectedResourceRevision      int64          `json:"ExpectedResourceRevision"`
	ExpectedResourceAssetRevision int64          `json:"ExpectedResourceAssetRevision"`
	Top                           *base.TopParam `json:"Top,omitempty"`
}

func NewReplaceUploadedResourceAssetRequest() *ReplaceUploadedResourceAssetRequest {
	return &ReplaceUploadedResourceAssetRequest{}
}

func (p *ReplaceUploadedResourceAssetRequest) InitDefault() {
}

var ReplaceUploadedResourceAssetRequest_WorkspaceID_DEFAULT string

func (p *ReplaceUploadedResourceAssetRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return ReplaceUploadedResourceAssetRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *ReplaceUploadedResourceAssetRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *ReplaceUploadedResourceAssetRequest) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *ReplaceUploadedResourceAssetRequest) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

func (p *ReplaceUploadedResourceAssetRequest) GetBlobID() (v string) {
	return p.BlobID
}

func (p *ReplaceUploadedResourceAssetRequest) GetFileName() (v string) {
	return p.FileName
}

func (p *ReplaceUploadedResourceAssetRequest) GetExpectedResourceRevision() (v int64) {
	return p.ExpectedResourceRevision
}

func (p *ReplaceUploadedResourceAssetRequest) GetExpectedResourceAssetRevision() (v int64) {
	return p.ExpectedResourceAssetRevision
}

var ReplaceUploadedResourceAssetRequest_Top_DEFAULT *base.TopParam

func (p *ReplaceUploadedResourceAssetRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return ReplaceUploadedResourceAssetRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *ReplaceUploadedResourceAssetRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *ReplaceUploadedResourceAssetRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *ReplaceUploadedResourceAssetRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ReplaceUploadedResourceAssetRequest(%+v)", *p)
}

type ReplaceUploadedResourceAssetResponse struct {
	ResourceAsset *ResourceAsset `json:"ResourceAsset"`
}

func NewReplaceUploadedResourceAssetResponse() *ReplaceUploadedResourceAssetResponse {
	return &ReplaceUploadedResourceAssetResponse{}
}

func (p *ReplaceUploadedResourceAssetResponse) InitDefault() {
}

var ReplaceUploadedResourceAssetResponse_ResourceAsset_DEFAULT *ResourceAsset

func (p *ReplaceUploadedResourceAssetResponse) GetResourceAsset() (v *ResourceAsset) {
	if !p.IsSetResourceAsset() {
		return ReplaceUploadedResourceAssetResponse_ResourceAsset_DEFAULT
	}
	return p.ResourceAsset
}

func (p *ReplaceUploadedResourceAssetResponse) IsSetResourceAsset() bool {
	return p.ResourceAsset != nil
}

func (p *ReplaceUploadedResourceAssetResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ReplaceUploadedResourceAssetResponse(%+v)", *p)
}

type UpdateResourceAssetRequest struct {
	WorkspaceID                   *string        `json:"WorkspaceID,omitempty"`
	ProjectID                     string         `json:"ProjectID"`
	ResourceID                    string         `json:"ResourceID"`
	ResourceAssetID               string         `json:"ResourceAssetID"`
	Name                          string         `json:"Name"`
	ExpectedResourceRevision      int64          `json:"ExpectedResourceRevision"`
	ExpectedResourceAssetRevision int64          `json:"ExpectedResourceAssetRevision"`
	Top                           *base.TopParam `json:"Top,omitempty"`
}

func NewUpdateResourceAssetRequest() *UpdateResourceAssetRequest {
	return &UpdateResourceAssetRequest{}
}

func (p *UpdateResourceAssetRequest) InitDefault() {
}

var UpdateResourceAssetRequest_WorkspaceID_DEFAULT string

func (p *UpdateResourceAssetRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return UpdateResourceAssetRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *UpdateResourceAssetRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *UpdateResourceAssetRequest) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *UpdateResourceAssetRequest) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

func (p *UpdateResourceAssetRequest) GetName() (v string) {
	return p.Name
}

func (p *UpdateResourceAssetRequest) GetExpectedResourceRevision() (v int64) {
	return p.ExpectedResourceRevision
}

func (p *UpdateResourceAssetRequest) GetExpectedResourceAssetRevision() (v int64) {
	return p.ExpectedResourceAssetRevision
}

var UpdateResourceAssetRequest_Top_DEFAULT *base.TopParam

func (p *UpdateResourceAssetRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return UpdateResourceAssetRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *UpdateResourceAssetRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *UpdateResourceAssetRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *UpdateResourceAssetRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateResourceAssetRequest(%+v)", *p)
}

type UpdateResourceAssetResponse struct {
	ResourceAsset *ResourceAsset `json:"ResourceAsset"`
}

func NewUpdateResourceAssetResponse() *UpdateResourceAssetResponse {
	return &UpdateResourceAssetResponse{}
}

func (p *UpdateResourceAssetResponse) InitDefault() {
}

var UpdateResourceAssetResponse_ResourceAsset_DEFAULT *ResourceAsset

func (p *UpdateResourceAssetResponse) GetResourceAsset() (v *ResourceAsset) {
	if !p.IsSetResourceAsset() {
		return UpdateResourceAssetResponse_ResourceAsset_DEFAULT
	}
	return p.ResourceAsset
}

func (p *UpdateResourceAssetResponse) IsSetResourceAsset() bool {
	return p.ResourceAsset != nil
}

func (p *UpdateResourceAssetResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateResourceAssetResponse(%+v)", *p)
}

type SetPrimaryResourceAssetRequest struct {
	WorkspaceID              *string        `json:"WorkspaceID,omitempty"`
	ProjectID                string         `json:"ProjectID"`
	ResourceID               string         `json:"ResourceID"`
	ResourceAssetID          string         `json:"ResourceAssetID"`
	ExpectedResourceRevision int64          `json:"ExpectedResourceRevision"`
	Top                      *base.TopParam `json:"Top,omitempty"`
}

func NewSetPrimaryResourceAssetRequest() *SetPrimaryResourceAssetRequest {
	return &SetPrimaryResourceAssetRequest{}
}

func (p *SetPrimaryResourceAssetRequest) InitDefault() {
}

var SetPrimaryResourceAssetRequest_WorkspaceID_DEFAULT string

func (p *SetPrimaryResourceAssetRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return SetPrimaryResourceAssetRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *SetPrimaryResourceAssetRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *SetPrimaryResourceAssetRequest) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *SetPrimaryResourceAssetRequest) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

func (p *SetPrimaryResourceAssetRequest) GetExpectedResourceRevision() (v int64) {
	return p.ExpectedResourceRevision
}

var SetPrimaryResourceAssetRequest_Top_DEFAULT *base.TopParam

func (p *SetPrimaryResourceAssetRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return SetPrimaryResourceAssetRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *SetPrimaryResourceAssetRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *SetPrimaryResourceAssetRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *SetPrimaryResourceAssetRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("SetPrimaryResourceAssetRequest(%+v)", *p)
}

type SetPrimaryResourceAssetResponse struct {
	Resource *Resource `json:"Resource"`
}

func NewSetPrimaryResourceAssetResponse() *SetPrimaryResourceAssetResponse {
	return &SetPrimaryResourceAssetResponse{}
}

func (p *SetPrimaryResourceAssetResponse) InitDefault() {
}

var SetPrimaryResourceAssetResponse_Resource_DEFAULT *Resource

func (p *SetPrimaryResourceAssetResponse) GetResource() (v *Resource) {
	if !p.IsSetResource() {
		return SetPrimaryResourceAssetResponse_Resource_DEFAULT
	}
	return p.Resource
}

func (p *SetPrimaryResourceAssetResponse) IsSetResource() bool {
	return p.Resource != nil
}

func (p *SetPrimaryResourceAssetResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("SetPrimaryResourceAssetResponse(%+v)", *p)
}

type DeleteResourceAssetRequest struct {
	WorkspaceID                   *string        `json:"WorkspaceID,omitempty"`
	ProjectID                     string         `json:"ProjectID"`
	ResourceID                    string         `json:"ResourceID"`
	ResourceAssetID               string         `json:"ResourceAssetID"`
	ExpectedResourceRevision      int64          `json:"ExpectedResourceRevision"`
	ExpectedResourceAssetRevision int64          `json:"ExpectedResourceAssetRevision"`
	Top                           *base.TopParam `json:"Top,omitempty"`
}

func NewDeleteResourceAssetRequest() *DeleteResourceAssetRequest {
	return &DeleteResourceAssetRequest{}
}

func (p *DeleteResourceAssetRequest) InitDefault() {
}

var DeleteResourceAssetRequest_WorkspaceID_DEFAULT string

func (p *DeleteResourceAssetRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return DeleteResourceAssetRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *DeleteResourceAssetRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *DeleteResourceAssetRequest) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *DeleteResourceAssetRequest) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

func (p *DeleteResourceAssetRequest) GetExpectedResourceRevision() (v int64) {
	return p.ExpectedResourceRevision
}

func (p *DeleteResourceAssetRequest) GetExpectedResourceAssetRevision() (v int64) {
	return p.ExpectedResourceAssetRevision
}

var DeleteResourceAssetRequest_Top_DEFAULT *base.TopParam

func (p *DeleteResourceAssetRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return DeleteResourceAssetRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *DeleteResourceAssetRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *DeleteResourceAssetRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *DeleteResourceAssetRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DeleteResourceAssetRequest(%+v)", *p)
}

type DeleteResourceAssetTarget struct {
	ResourceAssetID               string `json:"ResourceAssetID"`
	ExpectedResourceRevision      int64  `json:"ExpectedResourceRevision"`
	ExpectedResourceAssetRevision int64  `json:"ExpectedResourceAssetRevision"`
}

func NewDeleteResourceAssetTarget() *DeleteResourceAssetTarget {
	return &DeleteResourceAssetTarget{}
}

func (p *DeleteResourceAssetTarget) InitDefault() {
}

func (p *DeleteResourceAssetTarget) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

func (p *DeleteResourceAssetTarget) GetExpectedResourceRevision() (v int64) {
	return p.ExpectedResourceRevision
}

func (p *DeleteResourceAssetTarget) GetExpectedResourceAssetRevision() (v int64) {
	return p.ExpectedResourceAssetRevision
}

func (p *DeleteResourceAssetTarget) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DeleteResourceAssetTarget(%+v)", *p)
}

type BatchDeleteResourceAssetsRequest struct {
	WorkspaceID *string                      `json:"WorkspaceID,omitempty"`
	ProjectID   string                       `json:"ProjectID"`
	ResourceID  string                       `json:"ResourceID"`
	Targets     []*DeleteResourceAssetTarget `json:"Targets"`
	Top         *base.TopParam               `json:"Top,omitempty"`
}

func NewBatchDeleteResourceAssetsRequest() *BatchDeleteResourceAssetsRequest {
	return &BatchDeleteResourceAssetsRequest{}
}

func (p *BatchDeleteResourceAssetsRequest) InitDefault() {
}

var BatchDeleteResourceAssetsRequest_WorkspaceID_DEFAULT string

func (p *BatchDeleteResourceAssetsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchDeleteResourceAssetsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchDeleteResourceAssetsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *BatchDeleteResourceAssetsRequest) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *BatchDeleteResourceAssetsRequest) GetTargets() (v []*DeleteResourceAssetTarget) {
	return p.Targets
}

var BatchDeleteResourceAssetsRequest_Top_DEFAULT *base.TopParam

func (p *BatchDeleteResourceAssetsRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return BatchDeleteResourceAssetsRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *BatchDeleteResourceAssetsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchDeleteResourceAssetsRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *BatchDeleteResourceAssetsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchDeleteResourceAssetsRequest(%+v)", *p)
}

type GetResourceAssetGenerationRequest struct {
	WorkspaceID     *string        `json:"WorkspaceID,omitempty"`
	ProjectID       string         `json:"ProjectID"`
	ResourceID      string         `json:"ResourceID"`
	ResourceAssetID string         `json:"ResourceAssetID"`
	Top             *base.TopParam `json:"Top,omitempty"`
}

func NewGetResourceAssetGenerationRequest() *GetResourceAssetGenerationRequest {
	return &GetResourceAssetGenerationRequest{}
}

func (p *GetResourceAssetGenerationRequest) InitDefault() {
}

var GetResourceAssetGenerationRequest_WorkspaceID_DEFAULT string

func (p *GetResourceAssetGenerationRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return GetResourceAssetGenerationRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *GetResourceAssetGenerationRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *GetResourceAssetGenerationRequest) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *GetResourceAssetGenerationRequest) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

var GetResourceAssetGenerationRequest_Top_DEFAULT *base.TopParam

func (p *GetResourceAssetGenerationRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return GetResourceAssetGenerationRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *GetResourceAssetGenerationRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *GetResourceAssetGenerationRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *GetResourceAssetGenerationRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetResourceAssetGenerationRequest(%+v)", *p)
}

type GetResourceAssetGenerationResponse struct {
	Generation *ResourceAssetGeneration `json:"Generation"`
}

func NewGetResourceAssetGenerationResponse() *GetResourceAssetGenerationResponse {
	return &GetResourceAssetGenerationResponse{}
}

func (p *GetResourceAssetGenerationResponse) InitDefault() {
}

var GetResourceAssetGenerationResponse_Generation_DEFAULT *ResourceAssetGeneration

func (p *GetResourceAssetGenerationResponse) GetGeneration() (v *ResourceAssetGeneration) {
	if !p.IsSetGeneration() {
		return GetResourceAssetGenerationResponse_Generation_DEFAULT
	}
	return p.Generation
}

func (p *GetResourceAssetGenerationResponse) IsSetGeneration() bool {
	return p.Generation != nil
}

func (p *GetResourceAssetGenerationResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetResourceAssetGenerationResponse(%+v)", *p)
}

// BatchGetResourceAssetGenerationStatesRequest 批量查询同一资源下生成型素材的最近运行状态。
type BatchGetResourceAssetGenerationStatesRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	ResourceID  string  `json:"ResourceID"`
	// ResourceAssetIDs 接受 1 至 100 个资源素材 ID；重复 ID 按首次出现位置去重。
	ResourceAssetIDs []string       `json:"ResourceAssetIDs"`
	Top              *base.TopParam `json:"Top,omitempty"`
}

func NewBatchGetResourceAssetGenerationStatesRequest() *BatchGetResourceAssetGenerationStatesRequest {
	return &BatchGetResourceAssetGenerationStatesRequest{}
}

func (p *BatchGetResourceAssetGenerationStatesRequest) InitDefault() {
}

var BatchGetResourceAssetGenerationStatesRequest_WorkspaceID_DEFAULT string

func (p *BatchGetResourceAssetGenerationStatesRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchGetResourceAssetGenerationStatesRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchGetResourceAssetGenerationStatesRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *BatchGetResourceAssetGenerationStatesRequest) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *BatchGetResourceAssetGenerationStatesRequest) GetResourceAssetIDs() (v []string) {
	return p.ResourceAssetIDs
}

var BatchGetResourceAssetGenerationStatesRequest_Top_DEFAULT *base.TopParam

func (p *BatchGetResourceAssetGenerationStatesRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return BatchGetResourceAssetGenerationStatesRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *BatchGetResourceAssetGenerationStatesRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchGetResourceAssetGenerationStatesRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *BatchGetResourceAssetGenerationStatesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetResourceAssetGenerationStatesRequest(%+v)", *p)
}

// BatchGetResourceAssetGenerationStatesResponse 仅返回当前作用域内存在且已有生成运行的素材状态。
type BatchGetResourceAssetGenerationStatesResponse struct {
	// Items 按 ResourceAssetIDs 首次出现的顺序返回；不存在、不可见、非生成型或尚无运行的素材不返回。
	Items []*ResourceAssetGenerationState `json:"Items"`
}

func NewBatchGetResourceAssetGenerationStatesResponse() *BatchGetResourceAssetGenerationStatesResponse {
	return &BatchGetResourceAssetGenerationStatesResponse{}
}

func (p *BatchGetResourceAssetGenerationStatesResponse) InitDefault() {
}

func (p *BatchGetResourceAssetGenerationStatesResponse) GetItems() (v []*ResourceAssetGenerationState) {
	return p.Items
}

func (p *BatchGetResourceAssetGenerationStatesResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetResourceAssetGenerationStatesResponse(%+v)", *p)
}

type UpdateResourceAssetGenerationRequest struct {
	WorkspaceID      *string                       `json:"WorkspaceID,omitempty"`
	ProjectID        string                        `json:"ProjectID"`
	ResourceID       string                        `json:"ResourceID"`
	ResourceAssetID  string                        `json:"ResourceAssetID"`
	Patch            *ResourceAssetGenerationPatch `json:"Patch"`
	ExpectedRevision int64                         `json:"ExpectedRevision"`
	Top              *base.TopParam                `json:"Top,omitempty"`
}

func NewUpdateResourceAssetGenerationRequest() *UpdateResourceAssetGenerationRequest {
	return &UpdateResourceAssetGenerationRequest{}
}

func (p *UpdateResourceAssetGenerationRequest) InitDefault() {
}

var UpdateResourceAssetGenerationRequest_WorkspaceID_DEFAULT string

func (p *UpdateResourceAssetGenerationRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return UpdateResourceAssetGenerationRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *UpdateResourceAssetGenerationRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *UpdateResourceAssetGenerationRequest) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *UpdateResourceAssetGenerationRequest) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

var UpdateResourceAssetGenerationRequest_Patch_DEFAULT *ResourceAssetGenerationPatch

func (p *UpdateResourceAssetGenerationRequest) GetPatch() (v *ResourceAssetGenerationPatch) {
	if !p.IsSetPatch() {
		return UpdateResourceAssetGenerationRequest_Patch_DEFAULT
	}
	return p.Patch
}

func (p *UpdateResourceAssetGenerationRequest) GetExpectedRevision() (v int64) {
	return p.ExpectedRevision
}

var UpdateResourceAssetGenerationRequest_Top_DEFAULT *base.TopParam

func (p *UpdateResourceAssetGenerationRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return UpdateResourceAssetGenerationRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *UpdateResourceAssetGenerationRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *UpdateResourceAssetGenerationRequest) IsSetPatch() bool {
	return p.Patch != nil
}

func (p *UpdateResourceAssetGenerationRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *UpdateResourceAssetGenerationRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateResourceAssetGenerationRequest(%+v)", *p)
}

type UpdateResourceAssetGenerationResponse struct {
	Generation *ResourceAssetGeneration `json:"Generation"`
}

func NewUpdateResourceAssetGenerationResponse() *UpdateResourceAssetGenerationResponse {
	return &UpdateResourceAssetGenerationResponse{}
}

func (p *UpdateResourceAssetGenerationResponse) InitDefault() {
}

var UpdateResourceAssetGenerationResponse_Generation_DEFAULT *ResourceAssetGeneration

func (p *UpdateResourceAssetGenerationResponse) GetGeneration() (v *ResourceAssetGeneration) {
	if !p.IsSetGeneration() {
		return UpdateResourceAssetGenerationResponse_Generation_DEFAULT
	}
	return p.Generation
}

func (p *UpdateResourceAssetGenerationResponse) IsSetGeneration() bool {
	return p.Generation != nil
}

func (p *UpdateResourceAssetGenerationResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateResourceAssetGenerationResponse(%+v)", *p)
}

type StartResourceAssetGenerationRequest struct {
	WorkspaceID      *string        `json:"WorkspaceID,omitempty"`
	ProjectID        string         `json:"ProjectID"`
	ResourceID       string         `json:"ResourceID"`
	ResourceAssetID  string         `json:"ResourceAssetID"`
	ExpectedRevision int64          `json:"ExpectedRevision"`
	Top              *base.TopParam `json:"Top,omitempty"`
}

func NewStartResourceAssetGenerationRequest() *StartResourceAssetGenerationRequest {
	return &StartResourceAssetGenerationRequest{}
}

func (p *StartResourceAssetGenerationRequest) InitDefault() {
}

var StartResourceAssetGenerationRequest_WorkspaceID_DEFAULT string

func (p *StartResourceAssetGenerationRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return StartResourceAssetGenerationRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *StartResourceAssetGenerationRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *StartResourceAssetGenerationRequest) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *StartResourceAssetGenerationRequest) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

func (p *StartResourceAssetGenerationRequest) GetExpectedRevision() (v int64) {
	return p.ExpectedRevision
}

var StartResourceAssetGenerationRequest_Top_DEFAULT *base.TopParam

func (p *StartResourceAssetGenerationRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return StartResourceAssetGenerationRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *StartResourceAssetGenerationRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *StartResourceAssetGenerationRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *StartResourceAssetGenerationRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StartResourceAssetGenerationRequest(%+v)", *p)
}

type StartResourceAssetGenerationResponse struct {
	TaskRunID string `json:"TaskRunID"`
}

func NewStartResourceAssetGenerationResponse() *StartResourceAssetGenerationResponse {
	return &StartResourceAssetGenerationResponse{}
}

func (p *StartResourceAssetGenerationResponse) InitDefault() {
}

func (p *StartResourceAssetGenerationResponse) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *StartResourceAssetGenerationResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StartResourceAssetGenerationResponse(%+v)", *p)
}

type CancelResourceAssetGenerationRequest struct {
	WorkspaceID     *string        `json:"WorkspaceID,omitempty"`
	ProjectID       string         `json:"ProjectID"`
	ResourceID      string         `json:"ResourceID"`
	ResourceAssetID string         `json:"ResourceAssetID"`
	TaskRunID       string         `json:"TaskRunID"`
	Top             *base.TopParam `json:"Top,omitempty"`
}

func NewCancelResourceAssetGenerationRequest() *CancelResourceAssetGenerationRequest {
	return &CancelResourceAssetGenerationRequest{}
}

func (p *CancelResourceAssetGenerationRequest) InitDefault() {
}

var CancelResourceAssetGenerationRequest_WorkspaceID_DEFAULT string

func (p *CancelResourceAssetGenerationRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CancelResourceAssetGenerationRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CancelResourceAssetGenerationRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CancelResourceAssetGenerationRequest) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *CancelResourceAssetGenerationRequest) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

func (p *CancelResourceAssetGenerationRequest) GetTaskRunID() (v string) {
	return p.TaskRunID
}

var CancelResourceAssetGenerationRequest_Top_DEFAULT *base.TopParam

func (p *CancelResourceAssetGenerationRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return CancelResourceAssetGenerationRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *CancelResourceAssetGenerationRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CancelResourceAssetGenerationRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *CancelResourceAssetGenerationRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CancelResourceAssetGenerationRequest(%+v)", *p)
}

type GetResourceAssetGenerationRunRequest struct {
	WorkspaceID     *string        `json:"WorkspaceID,omitempty"`
	ProjectID       string         `json:"ProjectID"`
	ResourceID      string         `json:"ResourceID"`
	ResourceAssetID string         `json:"ResourceAssetID"`
	TaskRunID       string         `json:"TaskRunID"`
	Top             *base.TopParam `json:"Top,omitempty"`
}

func NewGetResourceAssetGenerationRunRequest() *GetResourceAssetGenerationRunRequest {
	return &GetResourceAssetGenerationRunRequest{}
}

func (p *GetResourceAssetGenerationRunRequest) InitDefault() {
}

var GetResourceAssetGenerationRunRequest_WorkspaceID_DEFAULT string

func (p *GetResourceAssetGenerationRunRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return GetResourceAssetGenerationRunRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *GetResourceAssetGenerationRunRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *GetResourceAssetGenerationRunRequest) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *GetResourceAssetGenerationRunRequest) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

func (p *GetResourceAssetGenerationRunRequest) GetTaskRunID() (v string) {
	return p.TaskRunID
}

var GetResourceAssetGenerationRunRequest_Top_DEFAULT *base.TopParam

func (p *GetResourceAssetGenerationRunRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return GetResourceAssetGenerationRunRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *GetResourceAssetGenerationRunRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *GetResourceAssetGenerationRunRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *GetResourceAssetGenerationRunRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetResourceAssetGenerationRunRequest(%+v)", *p)
}

type GetResourceAssetGenerationRunResponse struct {
	Run *ResourceAssetGenerationRun `json:"Run"`
}

func NewGetResourceAssetGenerationRunResponse() *GetResourceAssetGenerationRunResponse {
	return &GetResourceAssetGenerationRunResponse{}
}

func (p *GetResourceAssetGenerationRunResponse) InitDefault() {
}

var GetResourceAssetGenerationRunResponse_Run_DEFAULT *ResourceAssetGenerationRun

func (p *GetResourceAssetGenerationRunResponse) GetRun() (v *ResourceAssetGenerationRun) {
	if !p.IsSetRun() {
		return GetResourceAssetGenerationRunResponse_Run_DEFAULT
	}
	return p.Run
}

func (p *GetResourceAssetGenerationRunResponse) IsSetRun() bool {
	return p.Run != nil
}

func (p *GetResourceAssetGenerationRunResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetResourceAssetGenerationRunResponse(%+v)", *p)
}
