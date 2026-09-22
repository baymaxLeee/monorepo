package canvasnode

import (
	"database/sql"
	"database/sql/driver"
	"fmt"

	"github.com/example/monorepo/canvas/internal/api/contracts/asset"
	"github.com/example/monorepo/canvas/internal/api/contracts/common"
	"github.com/example/monorepo/canvas/internal/api/contracts/resource"
)

type CanvasNodeType int64

const (
	CanvasNodeType_IMAGE_ASSET      CanvasNodeType = 1
	CanvasNodeType_VIDEO_ASSET      CanvasNodeType = 2
	CanvasNodeType_AUDIO_ASSET      CanvasNodeType = 3
	CanvasNodeType_TEXT             CanvasNodeType = 4
	CanvasNodeType_IMAGE_GENERATION CanvasNodeType = 5
	CanvasNodeType_VIDEO_GENERATION CanvasNodeType = 6
	CanvasNodeType_TEXT_GENERATION  CanvasNodeType = 7
	CanvasNodeType_STORYBOARD_DRAFT CanvasNodeType = 8
)

func (p CanvasNodeType) String() string {
	switch p {
	case CanvasNodeType_IMAGE_ASSET:
		return "IMAGE_ASSET"
	case CanvasNodeType_VIDEO_ASSET:
		return "VIDEO_ASSET"
	case CanvasNodeType_AUDIO_ASSET:
		return "AUDIO_ASSET"
	case CanvasNodeType_TEXT:
		return "TEXT"
	case CanvasNodeType_IMAGE_GENERATION:
		return "IMAGE_GENERATION"
	case CanvasNodeType_VIDEO_GENERATION:
		return "VIDEO_GENERATION"
	case CanvasNodeType_TEXT_GENERATION:
		return "TEXT_GENERATION"
	case CanvasNodeType_STORYBOARD_DRAFT:
		return "STORYBOARD_DRAFT"
	}
	return "<UNSET>"
}

func CanvasNodeTypeFromString(s string) (CanvasNodeType, error) {
	switch s {
	case "IMAGE_ASSET":
		return CanvasNodeType_IMAGE_ASSET, nil
	case "VIDEO_ASSET":
		return CanvasNodeType_VIDEO_ASSET, nil
	case "AUDIO_ASSET":
		return CanvasNodeType_AUDIO_ASSET, nil
	case "TEXT":
		return CanvasNodeType_TEXT, nil
	case "IMAGE_GENERATION":
		return CanvasNodeType_IMAGE_GENERATION, nil
	case "VIDEO_GENERATION":
		return CanvasNodeType_VIDEO_GENERATION, nil
	case "TEXT_GENERATION":
		return CanvasNodeType_TEXT_GENERATION, nil
	case "STORYBOARD_DRAFT":
		return CanvasNodeType_STORYBOARD_DRAFT, nil
	}
	return CanvasNodeType(0), fmt.Errorf("not a valid CanvasNodeType string")
}

func CanvasNodeTypePtr(v CanvasNodeType) *CanvasNodeType { return &v }
func (p *CanvasNodeType) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasNodeType(result.Int64)
	return
}

func (p *CanvasNodeType) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

type CanvasVideoInputMode int64

const (
	CanvasVideoInputMode_REFERENCE        CanvasVideoInputMode = 1
	CanvasVideoInputMode_FIRST_LAST_FRAME CanvasVideoInputMode = 2
)

func (p CanvasVideoInputMode) String() string {
	switch p {
	case CanvasVideoInputMode_REFERENCE:
		return "REFERENCE"
	case CanvasVideoInputMode_FIRST_LAST_FRAME:
		return "FIRST_LAST_FRAME"
	}
	return "<UNSET>"
}

func CanvasVideoInputModeFromString(s string) (CanvasVideoInputMode, error) {
	switch s {
	case "REFERENCE":
		return CanvasVideoInputMode_REFERENCE, nil
	case "FIRST_LAST_FRAME":
		return CanvasVideoInputMode_FIRST_LAST_FRAME, nil
	}
	return CanvasVideoInputMode(0), fmt.Errorf("not a valid CanvasVideoInputMode string")
}

func CanvasVideoInputModePtr(v CanvasVideoInputMode) *CanvasVideoInputMode { return &v }
func (p *CanvasVideoInputMode) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasVideoInputMode(result.Int64)
	return
}

func (p *CanvasVideoInputMode) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

type CanvasPort int64

const (
	CanvasPort_OUTPUT          CanvasPort = 1
	CanvasPort_REFERENCE_IMAGE CanvasPort = 2
	CanvasPort_REFERENCE_VIDEO CanvasPort = 3
	CanvasPort_REFERENCE_AUDIO CanvasPort = 4
	CanvasPort_REFERENCE_TEXT  CanvasPort = 5
	CanvasPort_FIRST_FRAME     CanvasPort = 6
	CanvasPort_LAST_FRAME      CanvasPort = 7
)

func (p CanvasPort) String() string {
	switch p {
	case CanvasPort_OUTPUT:
		return "OUTPUT"
	case CanvasPort_REFERENCE_IMAGE:
		return "REFERENCE_IMAGE"
	case CanvasPort_REFERENCE_VIDEO:
		return "REFERENCE_VIDEO"
	case CanvasPort_REFERENCE_AUDIO:
		return "REFERENCE_AUDIO"
	case CanvasPort_REFERENCE_TEXT:
		return "REFERENCE_TEXT"
	case CanvasPort_FIRST_FRAME:
		return "FIRST_FRAME"
	case CanvasPort_LAST_FRAME:
		return "LAST_FRAME"
	}
	return "<UNSET>"
}

func CanvasPortFromString(s string) (CanvasPort, error) {
	switch s {
	case "OUTPUT":
		return CanvasPort_OUTPUT, nil
	case "REFERENCE_IMAGE":
		return CanvasPort_REFERENCE_IMAGE, nil
	case "REFERENCE_VIDEO":
		return CanvasPort_REFERENCE_VIDEO, nil
	case "REFERENCE_AUDIO":
		return CanvasPort_REFERENCE_AUDIO, nil
	case "REFERENCE_TEXT":
		return CanvasPort_REFERENCE_TEXT, nil
	case "FIRST_FRAME":
		return CanvasPort_FIRST_FRAME, nil
	case "LAST_FRAME":
		return CanvasPort_LAST_FRAME, nil
	}
	return CanvasPort(0), fmt.Errorf("not a valid CanvasPort string")
}

func CanvasPortPtr(v CanvasPort) *CanvasPort { return &v }
func (p *CanvasPort) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasPort(result.Int64)
	return
}

func (p *CanvasPort) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// CanvasNodeMediaType 是画布输入、输出和素材查询共享的通用媒体维度。
type CanvasNodeMediaType int64

const (
	CanvasNodeMediaType_IMAGE CanvasNodeMediaType = 1
	CanvasNodeMediaType_VIDEO CanvasNodeMediaType = 2
	CanvasNodeMediaType_AUDIO CanvasNodeMediaType = 3
	CanvasNodeMediaType_TEXT  CanvasNodeMediaType = 4
)

func (p CanvasNodeMediaType) String() string {
	switch p {
	case CanvasNodeMediaType_IMAGE:
		return "IMAGE"
	case CanvasNodeMediaType_VIDEO:
		return "VIDEO"
	case CanvasNodeMediaType_AUDIO:
		return "AUDIO"
	case CanvasNodeMediaType_TEXT:
		return "TEXT"
	}
	return "<UNSET>"
}

func CanvasNodeMediaTypeFromString(s string) (CanvasNodeMediaType, error) {
	switch s {
	case "IMAGE":
		return CanvasNodeMediaType_IMAGE, nil
	case "VIDEO":
		return CanvasNodeMediaType_VIDEO, nil
	case "AUDIO":
		return CanvasNodeMediaType_AUDIO, nil
	case "TEXT":
		return CanvasNodeMediaType_TEXT, nil
	}
	return CanvasNodeMediaType(0), fmt.Errorf("not a valid CanvasNodeMediaType string")
}

func CanvasNodeMediaTypePtr(v CanvasNodeMediaType) *CanvasNodeMediaType { return &v }
func (p *CanvasNodeMediaType) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasNodeMediaType(result.Int64)
	return
}

func (p *CanvasNodeMediaType) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// CanvasNodeMentionReferenceType 是 @ 候选项及其物化素材节点的唯一活动引用身份类型。
type CanvasNodeMentionReferenceType int64

const (
	CanvasNodeMentionReferenceType_UNSPECIFIED    CanvasNodeMentionReferenceType = 0
	CanvasNodeMentionReferenceType_ASSET          CanvasNodeMentionReferenceType = 1
	CanvasNodeMentionReferenceType_RESOURCE       CanvasNodeMentionReferenceType = 2
	CanvasNodeMentionReferenceType_RESOURCE_ASSET CanvasNodeMentionReferenceType = 3
	CanvasNodeMentionReferenceType_CANVAS_NODE    CanvasNodeMentionReferenceType = 4
)

func (p CanvasNodeMentionReferenceType) String() string {
	switch p {
	case CanvasNodeMentionReferenceType_UNSPECIFIED:
		return "UNSPECIFIED"
	case CanvasNodeMentionReferenceType_ASSET:
		return "ASSET"
	case CanvasNodeMentionReferenceType_RESOURCE:
		return "RESOURCE"
	case CanvasNodeMentionReferenceType_RESOURCE_ASSET:
		return "RESOURCE_ASSET"
	case CanvasNodeMentionReferenceType_CANVAS_NODE:
		return "CANVAS_NODE"
	}
	return "<UNSET>"
}

func CanvasNodeMentionReferenceTypeFromString(s string) (CanvasNodeMentionReferenceType, error) {
	switch s {
	case "UNSPECIFIED":
		return CanvasNodeMentionReferenceType_UNSPECIFIED, nil
	case "ASSET":
		return CanvasNodeMentionReferenceType_ASSET, nil
	case "RESOURCE":
		return CanvasNodeMentionReferenceType_RESOURCE, nil
	case "RESOURCE_ASSET":
		return CanvasNodeMentionReferenceType_RESOURCE_ASSET, nil
	case "CANVAS_NODE":
		return CanvasNodeMentionReferenceType_CANVAS_NODE, nil
	}
	return CanvasNodeMentionReferenceType(0), fmt.Errorf("not a valid CanvasNodeMentionReferenceType string")
}

func CanvasNodeMentionReferenceTypePtr(v CanvasNodeMentionReferenceType) *CanvasNodeMentionReferenceType {
	return &v
}
func (p *CanvasNodeMentionReferenceType) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasNodeMentionReferenceType(result.Int64)
	return
}

func (p *CanvasNodeMentionReferenceType) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// CanvasNodeReferenceStatus 是 Resource/ResourceAsset 引用的读取期可用状态。
type CanvasNodeReferenceStatus int64

const (
	CanvasNodeReferenceStatus_ACTIVE  CanvasNodeReferenceStatus = 1
	CanvasNodeReferenceStatus_DELETED CanvasNodeReferenceStatus = 2
)

func (p CanvasNodeReferenceStatus) String() string {
	switch p {
	case CanvasNodeReferenceStatus_ACTIVE:
		return "ACTIVE"
	case CanvasNodeReferenceStatus_DELETED:
		return "DELETED"
	}
	return "<UNSET>"
}

func CanvasNodeReferenceStatusFromString(s string) (CanvasNodeReferenceStatus, error) {
	switch s {
	case "ACTIVE":
		return CanvasNodeReferenceStatus_ACTIVE, nil
	case "DELETED":
		return CanvasNodeReferenceStatus_DELETED, nil
	}
	return CanvasNodeReferenceStatus(0), fmt.Errorf("not a valid CanvasNodeReferenceStatus string")
}

func CanvasNodeReferenceStatusPtr(v CanvasNodeReferenceStatus) *CanvasNodeReferenceStatus { return &v }
func (p *CanvasNodeReferenceStatus) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasNodeReferenceStatus(result.Int64)
	return
}

func (p *CanvasNodeReferenceStatus) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// CanvasNodeResolution 是分镜图片和视频生成输出的统一分辨率。
type CanvasNodeResolution int64

const (
	CanvasNodeResolution_P480  CanvasNodeResolution = 1
	CanvasNodeResolution_P720  CanvasNodeResolution = 2
	CanvasNodeResolution_P1080 CanvasNodeResolution = 3
	CanvasNodeResolution_P2K   CanvasNodeResolution = 4
	CanvasNodeResolution_P4K   CanvasNodeResolution = 5
)

func (p CanvasNodeResolution) String() string {
	switch p {
	case CanvasNodeResolution_P480:
		return "P480"
	case CanvasNodeResolution_P720:
		return "P720"
	case CanvasNodeResolution_P1080:
		return "P1080"
	case CanvasNodeResolution_P2K:
		return "P2K"
	case CanvasNodeResolution_P4K:
		return "P4K"
	}
	return "<UNSET>"
}

func CanvasNodeResolutionFromString(s string) (CanvasNodeResolution, error) {
	switch s {
	case "P480":
		return CanvasNodeResolution_P480, nil
	case "P720":
		return CanvasNodeResolution_P720, nil
	case "P1080":
		return CanvasNodeResolution_P1080, nil
	case "P2K":
		return CanvasNodeResolution_P2K, nil
	case "P4K":
		return CanvasNodeResolution_P4K, nil
	}
	return CanvasNodeResolution(0), fmt.Errorf("not a valid CanvasNodeResolution string")
}

func CanvasNodeResolutionPtr(v CanvasNodeResolution) *CanvasNodeResolution { return &v }
func (p *CanvasNodeResolution) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasNodeResolution(result.Int64)
	return
}

func (p *CanvasNodeResolution) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// CanvasNodeAspectRatio 是分镜生成输出的画幅比例；RATIO_ADAPTIVE 表示由模型自动选择。
type CanvasNodeAspectRatio int64

const (
	CanvasNodeAspectRatio_RATIO_21_9     CanvasNodeAspectRatio = 1
	CanvasNodeAspectRatio_RATIO_16_9     CanvasNodeAspectRatio = 2
	CanvasNodeAspectRatio_RATIO_4_3      CanvasNodeAspectRatio = 3
	CanvasNodeAspectRatio_RATIO_1_1      CanvasNodeAspectRatio = 4
	CanvasNodeAspectRatio_RATIO_3_4      CanvasNodeAspectRatio = 5
	CanvasNodeAspectRatio_RATIO_9_16     CanvasNodeAspectRatio = 6
	CanvasNodeAspectRatio_RATIO_3_2      CanvasNodeAspectRatio = 7
	CanvasNodeAspectRatio_RATIO_ADAPTIVE CanvasNodeAspectRatio = 8
	CanvasNodeAspectRatio_RATIO_2_3      CanvasNodeAspectRatio = 9
)

func (p CanvasNodeAspectRatio) String() string {
	switch p {
	case CanvasNodeAspectRatio_RATIO_21_9:
		return "RATIO_21_9"
	case CanvasNodeAspectRatio_RATIO_16_9:
		return "RATIO_16_9"
	case CanvasNodeAspectRatio_RATIO_4_3:
		return "RATIO_4_3"
	case CanvasNodeAspectRatio_RATIO_1_1:
		return "RATIO_1_1"
	case CanvasNodeAspectRatio_RATIO_3_4:
		return "RATIO_3_4"
	case CanvasNodeAspectRatio_RATIO_9_16:
		return "RATIO_9_16"
	case CanvasNodeAspectRatio_RATIO_3_2:
		return "RATIO_3_2"
	case CanvasNodeAspectRatio_RATIO_ADAPTIVE:
		return "RATIO_ADAPTIVE"
	case CanvasNodeAspectRatio_RATIO_2_3:
		return "RATIO_2_3"
	}
	return "<UNSET>"
}

func CanvasNodeAspectRatioFromString(s string) (CanvasNodeAspectRatio, error) {
	switch s {
	case "RATIO_21_9":
		return CanvasNodeAspectRatio_RATIO_21_9, nil
	case "RATIO_16_9":
		return CanvasNodeAspectRatio_RATIO_16_9, nil
	case "RATIO_4_3":
		return CanvasNodeAspectRatio_RATIO_4_3, nil
	case "RATIO_1_1":
		return CanvasNodeAspectRatio_RATIO_1_1, nil
	case "RATIO_3_4":
		return CanvasNodeAspectRatio_RATIO_3_4, nil
	case "RATIO_9_16":
		return CanvasNodeAspectRatio_RATIO_9_16, nil
	case "RATIO_3_2":
		return CanvasNodeAspectRatio_RATIO_3_2, nil
	case "RATIO_ADAPTIVE":
		return CanvasNodeAspectRatio_RATIO_ADAPTIVE, nil
	case "RATIO_2_3":
		return CanvasNodeAspectRatio_RATIO_2_3, nil
	}
	return CanvasNodeAspectRatio(0), fmt.Errorf("not a valid CanvasNodeAspectRatio string")
}

func CanvasNodeAspectRatioPtr(v CanvasNodeAspectRatio) *CanvasNodeAspectRatio { return &v }
func (p *CanvasNodeAspectRatio) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasNodeAspectRatio(result.Int64)
	return
}

func (p *CanvasNodeAspectRatio) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// CanvasNodeStatus 是分镜当前结果的展示状态。
type CanvasNodeStatus int64

const (
	CanvasNodeStatus_EMPTY      CanvasNodeStatus = 1
	CanvasNodeStatus_READY      CanvasNodeStatus = 2
	CanvasNodeStatus_GENERATING CanvasNodeStatus = 3
)

func (p CanvasNodeStatus) String() string {
	switch p {
	case CanvasNodeStatus_EMPTY:
		return "EMPTY"
	case CanvasNodeStatus_READY:
		return "READY"
	case CanvasNodeStatus_GENERATING:
		return "GENERATING"
	}
	return "<UNSET>"
}

func CanvasNodeStatusFromString(s string) (CanvasNodeStatus, error) {
	switch s {
	case "EMPTY":
		return CanvasNodeStatus_EMPTY, nil
	case "READY":
		return CanvasNodeStatus_READY, nil
	case "GENERATING":
		return CanvasNodeStatus_GENERATING, nil
	}
	return CanvasNodeStatus(0), fmt.Errorf("not a valid CanvasNodeStatus string")
}

func CanvasNodeStatusPtr(v CanvasNodeStatus) *CanvasNodeStatus { return &v }
func (p *CanvasNodeStatus) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasNodeStatus(result.Int64)
	return
}

func (p *CanvasNodeStatus) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// CanvasGenerationStatus 是画布生成操作的即时状态。
type CanvasGenerationStatus int64

const (
	CanvasGenerationStatus_QUEUED    CanvasGenerationStatus = 1
	CanvasGenerationStatus_RUNNING   CanvasGenerationStatus = 2
	CanvasGenerationStatus_SUCCEEDED CanvasGenerationStatus = 3
	CanvasGenerationStatus_FAILED    CanvasGenerationStatus = 4
	CanvasGenerationStatus_CANCELLED CanvasGenerationStatus = 5
)

func (p CanvasGenerationStatus) String() string {
	switch p {
	case CanvasGenerationStatus_QUEUED:
		return "QUEUED"
	case CanvasGenerationStatus_RUNNING:
		return "RUNNING"
	case CanvasGenerationStatus_SUCCEEDED:
		return "SUCCEEDED"
	case CanvasGenerationStatus_FAILED:
		return "FAILED"
	case CanvasGenerationStatus_CANCELLED:
		return "CANCELLED"
	}
	return "<UNSET>"
}

func CanvasGenerationStatusFromString(s string) (CanvasGenerationStatus, error) {
	switch s {
	case "QUEUED":
		return CanvasGenerationStatus_QUEUED, nil
	case "RUNNING":
		return CanvasGenerationStatus_RUNNING, nil
	case "SUCCEEDED":
		return CanvasGenerationStatus_SUCCEEDED, nil
	case "FAILED":
		return CanvasGenerationStatus_FAILED, nil
	case "CANCELLED":
		return CanvasGenerationStatus_CANCELLED, nil
	}
	return CanvasGenerationStatus(0), fmt.Errorf("not a valid CanvasGenerationStatus string")
}

func CanvasGenerationStatusPtr(v CanvasGenerationStatus) *CanvasGenerationStatus { return &v }
func (p *CanvasGenerationStatus) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasGenerationStatus(result.Int64)
	return
}

func (p *CanvasGenerationStatus) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

type CanvasNodeTaskType int64

const (
	CanvasNodeTaskType_GENERATION   CanvasNodeTaskType = 1
	CanvasNodeTaskType_ASSETS_MATCH CanvasNodeTaskType = 2
)

func (p CanvasNodeTaskType) String() string {
	switch p {
	case CanvasNodeTaskType_GENERATION:
		return "GENERATION"
	case CanvasNodeTaskType_ASSETS_MATCH:
		return "ASSETS_MATCH"
	}
	return "<UNSET>"
}

func CanvasNodeTaskTypeFromString(s string) (CanvasNodeTaskType, error) {
	switch s {
	case "GENERATION":
		return CanvasNodeTaskType_GENERATION, nil
	case "ASSETS_MATCH":
		return CanvasNodeTaskType_ASSETS_MATCH, nil
	}
	return CanvasNodeTaskType(0), fmt.Errorf("not a valid CanvasNodeTaskType string")
}

func CanvasNodeTaskTypePtr(v CanvasNodeTaskType) *CanvasNodeTaskType { return &v }
func (p *CanvasNodeTaskType) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasNodeTaskType(result.Int64)
	return
}

func (p *CanvasNodeTaskType) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// CanvasNodeVideoProviderStatus 是视频 provider 的独立执行状态。
type CanvasNodeVideoProviderStatus int64

const (
	CanvasNodeVideoProviderStatus_PENDING   CanvasNodeVideoProviderStatus = 1
	CanvasNodeVideoProviderStatus_QUEUED    CanvasNodeVideoProviderStatus = 2
	CanvasNodeVideoProviderStatus_RUNNING   CanvasNodeVideoProviderStatus = 3
	CanvasNodeVideoProviderStatus_SUCCEEDED CanvasNodeVideoProviderStatus = 4
	CanvasNodeVideoProviderStatus_FAILED    CanvasNodeVideoProviderStatus = 5
	CanvasNodeVideoProviderStatus_CANCELLED CanvasNodeVideoProviderStatus = 6
	CanvasNodeVideoProviderStatus_UNKNOWN   CanvasNodeVideoProviderStatus = 7
)

func (p CanvasNodeVideoProviderStatus) String() string {
	switch p {
	case CanvasNodeVideoProviderStatus_PENDING:
		return "PENDING"
	case CanvasNodeVideoProviderStatus_QUEUED:
		return "QUEUED"
	case CanvasNodeVideoProviderStatus_RUNNING:
		return "RUNNING"
	case CanvasNodeVideoProviderStatus_SUCCEEDED:
		return "SUCCEEDED"
	case CanvasNodeVideoProviderStatus_FAILED:
		return "FAILED"
	case CanvasNodeVideoProviderStatus_CANCELLED:
		return "CANCELLED"
	case CanvasNodeVideoProviderStatus_UNKNOWN:
		return "UNKNOWN"
	}
	return "<UNSET>"
}

func CanvasNodeVideoProviderStatusFromString(s string) (CanvasNodeVideoProviderStatus, error) {
	switch s {
	case "PENDING":
		return CanvasNodeVideoProviderStatus_PENDING, nil
	case "QUEUED":
		return CanvasNodeVideoProviderStatus_QUEUED, nil
	case "RUNNING":
		return CanvasNodeVideoProviderStatus_RUNNING, nil
	case "SUCCEEDED":
		return CanvasNodeVideoProviderStatus_SUCCEEDED, nil
	case "FAILED":
		return CanvasNodeVideoProviderStatus_FAILED, nil
	case "CANCELLED":
		return CanvasNodeVideoProviderStatus_CANCELLED, nil
	case "UNKNOWN":
		return CanvasNodeVideoProviderStatus_UNKNOWN, nil
	}
	return CanvasNodeVideoProviderStatus(0), fmt.Errorf("not a valid CanvasNodeVideoProviderStatus string")
}

func CanvasNodeVideoProviderStatusPtr(v CanvasNodeVideoProviderStatus) *CanvasNodeVideoProviderStatus {
	return &v
}
func (p *CanvasNodeVideoProviderStatus) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasNodeVideoProviderStatus(result.Int64)
	return
}

func (p *CanvasNodeVideoProviderStatus) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

type CanvasNodeDraftStatus int64

const (
	CanvasNodeDraftStatus_RUNNING   CanvasNodeDraftStatus = 1
	CanvasNodeDraftStatus_COMPLETED CanvasNodeDraftStatus = 2
	CanvasNodeDraftStatus_FAILED    CanvasNodeDraftStatus = 3
)

func (p CanvasNodeDraftStatus) String() string {
	switch p {
	case CanvasNodeDraftStatus_RUNNING:
		return "RUNNING"
	case CanvasNodeDraftStatus_COMPLETED:
		return "COMPLETED"
	case CanvasNodeDraftStatus_FAILED:
		return "FAILED"
	}
	return "<UNSET>"
}

func CanvasNodeDraftStatusFromString(s string) (CanvasNodeDraftStatus, error) {
	switch s {
	case "RUNNING":
		return CanvasNodeDraftStatus_RUNNING, nil
	case "COMPLETED":
		return CanvasNodeDraftStatus_COMPLETED, nil
	case "FAILED":
		return CanvasNodeDraftStatus_FAILED, nil
	}
	return CanvasNodeDraftStatus(0), fmt.Errorf("not a valid CanvasNodeDraftStatus string")
}

func CanvasNodeDraftStatusPtr(v CanvasNodeDraftStatus) *CanvasNodeDraftStatus { return &v }
func (p *CanvasNodeDraftStatus) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = CanvasNodeDraftStatus(result.Int64)
	return
}

func (p *CanvasNodeDraftStatus) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// CanvasNodePosition 是客户端计算并持久化的画布位置。
type CanvasNodePosition struct {
	PositionX float64 `json:"PositionX"`
	PositionY float64 `json:"PositionY"`
}

func NewCanvasNodePosition() *CanvasNodePosition {
	return &CanvasNodePosition{}
}

func (p *CanvasNodePosition) InitDefault() {
}

func (p *CanvasNodePosition) GetPositionX() (v float64) {
	return p.PositionX
}

func (p *CanvasNodePosition) GetPositionY() (v float64) {
	return p.PositionY
}

func (p *CanvasNodePosition) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodePosition(%+v)", *p)
}

type CanvasEdge struct {
	EdgeID       string     `json:"EdgeID"`
	SourceNodeID string     `json:"SourceNodeID"`
	SourcePort   CanvasPort `json:"SourcePort"`
	TargetPort   CanvasPort `json:"TargetPort"`
	TargetOrder  int32      `json:"TargetOrder"`
}

func NewCanvasEdge() *CanvasEdge {
	return &CanvasEdge{}
}

func (p *CanvasEdge) InitDefault() {
}

func (p *CanvasEdge) GetEdgeID() (v string) {
	return p.EdgeID
}

func (p *CanvasEdge) GetSourceNodeID() (v string) {
	return p.SourceNodeID
}

func (p *CanvasEdge) GetSourcePort() (v CanvasPort) {
	return p.SourcePort
}

func (p *CanvasEdge) GetTargetPort() (v CanvasPort) {
	return p.TargetPort
}

func (p *CanvasEdge) GetTargetOrder() (v int32) {
	return p.TargetOrder
}

func (p *CanvasEdge) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasEdge(%+v)", *p)
}

// CanvasNodeGenerationConfig 是单个分镜保存的完整生成配置。
type CanvasNodeGenerationConfig struct {
	// ModelServiceID 是生成模型服务的稳定标识。
	ModelServiceID string `json:"ModelServiceID"`
	// Resolution 是生成输出的分辨率。
	Resolution CanvasNodeResolution `json:"Resolution"`
	// AspectRatio 是生成输出的画幅比例。
	AspectRatio CanvasNodeAspectRatio `json:"AspectRatio"`
	// DurationSeconds 是生成时长；-1 表示自动时长，且仅在模型能力明确支持时有效。
	DurationSeconds int32 `json:"DurationSeconds"`
	// GenerateAudio 表示是否同时生成声音。
	GenerateAudio bool `json:"GenerateAudio"`
	// Watermark 表示是否在生成结果中保留水印。
	Watermark bool `json:"Watermark"`
}

func NewCanvasNodeGenerationConfig() *CanvasNodeGenerationConfig {
	return &CanvasNodeGenerationConfig{}
}

func (p *CanvasNodeGenerationConfig) InitDefault() {
}

func (p *CanvasNodeGenerationConfig) GetModelServiceID() (v string) {
	return p.ModelServiceID
}

func (p *CanvasNodeGenerationConfig) GetResolution() (v CanvasNodeResolution) {
	return p.Resolution
}

func (p *CanvasNodeGenerationConfig) GetAspectRatio() (v CanvasNodeAspectRatio) {
	return p.AspectRatio
}

func (p *CanvasNodeGenerationConfig) GetDurationSeconds() (v int32) {
	return p.DurationSeconds
}

func (p *CanvasNodeGenerationConfig) GetGenerateAudio() (v bool) {
	return p.GenerateAudio
}

func (p *CanvasNodeGenerationConfig) GetWatermark() (v bool) {
	return p.Watermark
}

func (p *CanvasNodeGenerationConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeGenerationConfig(%+v)", *p)
}

// CanvasNodeGenerationConfigPatch 是分镜生成配置的按需更新内容；未传字段保持原值。
type CanvasNodeGenerationConfigPatch struct {
	// ModelServiceID 更新生成模型服务的稳定标识。
	ModelServiceID *string `json:"ModelServiceID,omitempty"`
	// Resolution 更新生成输出的分辨率。
	Resolution *CanvasNodeResolution `json:"Resolution,omitempty"`
	// AspectRatio 更新生成输出的画幅比例。
	AspectRatio *CanvasNodeAspectRatio `json:"AspectRatio,omitempty"`
	// DurationSeconds 更新生成时长；-1 表示自动时长，且仅在模型能力明确支持时有效。
	DurationSeconds *int32 `json:"DurationSeconds,omitempty"`
	// GenerateAudio 更新是否同时生成声音。
	GenerateAudio *bool `json:"GenerateAudio,omitempty"`
	// Watermark 更新是否在生成结果中保留水印。
	Watermark *bool `json:"Watermark,omitempty"`
}

func NewCanvasNodeGenerationConfigPatch() *CanvasNodeGenerationConfigPatch {
	return &CanvasNodeGenerationConfigPatch{}
}

func (p *CanvasNodeGenerationConfigPatch) InitDefault() {
}

var CanvasNodeGenerationConfigPatch_ModelServiceID_DEFAULT string

func (p *CanvasNodeGenerationConfigPatch) GetModelServiceID() (v string) {
	if !p.IsSetModelServiceID() {
		return CanvasNodeGenerationConfigPatch_ModelServiceID_DEFAULT
	}
	return *p.ModelServiceID
}

var CanvasNodeGenerationConfigPatch_Resolution_DEFAULT CanvasNodeResolution

func (p *CanvasNodeGenerationConfigPatch) GetResolution() (v CanvasNodeResolution) {
	if !p.IsSetResolution() {
		return CanvasNodeGenerationConfigPatch_Resolution_DEFAULT
	}
	return *p.Resolution
}

var CanvasNodeGenerationConfigPatch_AspectRatio_DEFAULT CanvasNodeAspectRatio

func (p *CanvasNodeGenerationConfigPatch) GetAspectRatio() (v CanvasNodeAspectRatio) {
	if !p.IsSetAspectRatio() {
		return CanvasNodeGenerationConfigPatch_AspectRatio_DEFAULT
	}
	return *p.AspectRatio
}

var CanvasNodeGenerationConfigPatch_DurationSeconds_DEFAULT int32

func (p *CanvasNodeGenerationConfigPatch) GetDurationSeconds() (v int32) {
	if !p.IsSetDurationSeconds() {
		return CanvasNodeGenerationConfigPatch_DurationSeconds_DEFAULT
	}
	return *p.DurationSeconds
}

var CanvasNodeGenerationConfigPatch_GenerateAudio_DEFAULT bool

func (p *CanvasNodeGenerationConfigPatch) GetGenerateAudio() (v bool) {
	if !p.IsSetGenerateAudio() {
		return CanvasNodeGenerationConfigPatch_GenerateAudio_DEFAULT
	}
	return *p.GenerateAudio
}

var CanvasNodeGenerationConfigPatch_Watermark_DEFAULT bool

func (p *CanvasNodeGenerationConfigPatch) GetWatermark() (v bool) {
	if !p.IsSetWatermark() {
		return CanvasNodeGenerationConfigPatch_Watermark_DEFAULT
	}
	return *p.Watermark
}

func (p *CanvasNodeGenerationConfigPatch) IsSetModelServiceID() bool {
	return p.ModelServiceID != nil
}

func (p *CanvasNodeGenerationConfigPatch) IsSetResolution() bool {
	return p.Resolution != nil
}

func (p *CanvasNodeGenerationConfigPatch) IsSetAspectRatio() bool {
	return p.AspectRatio != nil
}

func (p *CanvasNodeGenerationConfigPatch) IsSetDurationSeconds() bool {
	return p.DurationSeconds != nil
}

func (p *CanvasNodeGenerationConfigPatch) IsSetGenerateAudio() bool {
	return p.GenerateAudio != nil
}

func (p *CanvasNodeGenerationConfigPatch) IsSetWatermark() bool {
	return p.Watermark != nil
}

func (p *CanvasNodeGenerationConfigPatch) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeGenerationConfigPatch(%+v)", *p)
}

// CanvasNodeGenerationFailure 是节点最近一次生成尝试失败时的轻量投影。
type CanvasNodeGenerationFailure struct {
	TaskRunID    string  `json:"TaskRunID"`
	ErrorCode    *string `json:"ErrorCode,omitempty"`
	ErrorMessage *string `json:"ErrorMessage,omitempty"`
	// SeedanceTaskID 仅在 Seedance 视频生成失败时存在，供火山侧问题复现与豁免操作使用。
	SeedanceTaskID *string `json:"SeedanceTaskID,omitempty"`
}

func NewCanvasNodeGenerationFailure() *CanvasNodeGenerationFailure {
	return &CanvasNodeGenerationFailure{}
}

func (p *CanvasNodeGenerationFailure) InitDefault() {
}

func (p *CanvasNodeGenerationFailure) GetTaskRunID() (v string) {
	return p.TaskRunID
}

var CanvasNodeGenerationFailure_ErrorCode_DEFAULT string

func (p *CanvasNodeGenerationFailure) GetErrorCode() (v string) {
	if !p.IsSetErrorCode() {
		return CanvasNodeGenerationFailure_ErrorCode_DEFAULT
	}
	return *p.ErrorCode
}

var CanvasNodeGenerationFailure_ErrorMessage_DEFAULT string

func (p *CanvasNodeGenerationFailure) GetErrorMessage() (v string) {
	if !p.IsSetErrorMessage() {
		return CanvasNodeGenerationFailure_ErrorMessage_DEFAULT
	}
	return *p.ErrorMessage
}

var CanvasNodeGenerationFailure_SeedanceTaskID_DEFAULT string

func (p *CanvasNodeGenerationFailure) GetSeedanceTaskID() (v string) {
	if !p.IsSetSeedanceTaskID() {
		return CanvasNodeGenerationFailure_SeedanceTaskID_DEFAULT
	}
	return *p.SeedanceTaskID
}

func (p *CanvasNodeGenerationFailure) IsSetErrorCode() bool {
	return p.ErrorCode != nil
}

func (p *CanvasNodeGenerationFailure) IsSetErrorMessage() bool {
	return p.ErrorMessage != nil
}

func (p *CanvasNodeGenerationFailure) IsSetSeedanceTaskID() bool {
	return p.SeedanceTaskID != nil
}

func (p *CanvasNodeGenerationFailure) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeGenerationFailure(%+v)", *p)
}

// CanvasNode 描述项目剧集下的一个稳定分镜。
type CanvasNode struct {
	ActiveTaskType *CanvasNodeTaskType `json:"ActiveTaskType,omitempty"`
	// DraftSession 仅在 STORYBOARD_DRAFT 临时节点上返回，草稿生命周期与该节点一致。
	DraftSession *CanvasNodeDraftSession `json:"DraftSession,omitempty"`
	// NodeID 是分镜稳定标识。
	NodeID string `json:"NodeID"`
	// CanvasID 是分镜所属剧集标识。
	CanvasID string `json:"CanvasID"`
	// CanvasNodeNo 是按当前顺序派生的连续展示序号。
	CanvasNodeNo int32 `json:"CanvasNodeNo"`
	// Prompt 是当前分镜的提示词。
	Prompt string `json:"Prompt"`
	// GenerationConfig 是当前分镜保存的完整生成配置。
	GenerationConfig *CanvasNodeGenerationConfig `json:"GenerationConfig,omitempty"`
	// Status 是当前分镜生成结果的展示状态。
	Status CanvasNodeStatus `json:"Status"`
	// SelectedOutputID 是当前内容来自本节点生成历史时对应的 TaskRunID；复制得到的当前内容没有该字段。
	SelectedOutputID *string `json:"SelectedOutputID,omitempty"`
	// SelectedAssetID 是当前选中的生成结果 Asset 标识。
	SelectedAssetID *string `json:"SelectedAssetID,omitempty"`
	// CreatedAt 是分镜创建时间。
	CreatedAt common.Timestamp `json:"CreatedAt"`
	// UpdatedAt 是分镜最后更新时间。
	UpdatedAt common.Timestamp `json:"UpdatedAt"`
	// CreatedBy 是分镜创建用户 ID。
	CreatedBy string `json:"CreatedBy"`
	// UpdatedBy 是最后一次创建、更新或删除分镜的用户 ID。
	UpdatedBy string `json:"UpdatedBy"`
	// ActiveTaskRunID 是当前进行中的 TaskRun 标识；调用方据此在重新进入页面后恢复状态订阅与取消。
	ActiveTaskRunID *string `json:"ActiveTaskRunID,omitempty"`
	// FirstFrameAssetID 是当前选中生成输出的首帧 Asset 标识。
	FirstFrameAssetID *string `json:"FirstFrameAssetID,omitempty"`
	// SelectedOutputDurationSeconds 是当前选中生成输出的实际时长，单位为秒。
	SelectedOutputDurationSeconds *int32 `json:"SelectedOutputDurationSeconds,omitempty"`
	// FirstFrameURL 是当前选中生成输出的首帧临时签名地址；签名失败时可为空。
	FirstFrameURL *string `json:"FirstFrameURL,omitempty"`
	// SelectedOutputURL 是当前选中视频 Asset 的临时签名地址；签名失败时可为空。
	SelectedOutputURL *string             `json:"SelectedOutputURL,omitempty"`
	Type              CanvasNodeType      `json:"Type"`
	Name              string              `json:"Name"`
	Position          *CanvasNodePosition `json:"Position"`
	StoryboardRank    *int64              `json:"StoryboardRank,omitempty"`
	Text              *string             `json:"Text,omitempty"`
	// AssetID 仅用于直接上传到画布、没有项目 Resource 的独立素材。
	AssetID        *string               `json:"AssetID,omitempty"`
	VideoInputMode *CanvasVideoInputMode `json:"VideoInputMode,omitempty"`
	IncomingEdges  []*CanvasEdge         `json:"IncomingEdges"`
	Revision       int64                 `json:"Revision"`
	// ResourceAssetID 是项目资产节点的唯一引用事实；读取和生成时始终解析其最新 CurrentAssetID。
	ResourceAssetID *string `json:"ResourceAssetID,omitempty"`
	// CurrentAssetID 是 ResourceAssetID 在本次读取时解析到的最新 Asset，仅用于渲染，不是持久化引用事实。
	CurrentAssetID *string `json:"CurrentAssetID,omitempty"`
	// ResourceAssetRevision 是本次读取时的 ResourceAsset 版本，仅用于展示和诊断。
	ResourceAssetRevision *int64  `json:"ResourceAssetRevision,omitempty"`
	SelectedOutputText    *string `json:"SelectedOutputText,omitempty"`
	// LastFrameAssetID 是当前选中生成输出的尾帧 Asset 标识。
	LastFrameAssetID *string `json:"LastFrameAssetID,omitempty"`
	// ResourceID 是资源级引用事实；读取和生成时解析该 Resource 当时的主 ResourceAsset。
	ResourceID *string `json:"ResourceID,omitempty"`
	// ResourceAssetIsPrimary 是本次读取时该节点解析到的 ResourceAsset 是否为所属 Resource 的当前主素材。
	ResourceAssetIsPrimary *bool `json:"ResourceAssetIsPrimary,omitempty"`
	// ReferenceType 是素材节点持久化的唯一活动引用身份；非素材节点不设置。
	ReferenceType *CanvasNodeMentionReferenceType `json:"ReferenceType,omitempty"`
	// ReferenceStatus 仅用于 ResourceID/ResourceAssetID 引用；DELETED 时保留节点与 Edge，由用户自行处理。
	ReferenceStatus CanvasNodeReferenceStatus `json:"ReferenceStatus"`
	// PreviewURL 是当前业务引用对应素材的临时展示地址。
	PreviewURL *string `json:"PreviewURL,omitempty"`
	// Reviews 是当前业务引用对应素材的全部有效审核记录，按创建时间升序返回。
	Reviews []*asset.AssetReview `json:"Reviews,omitempty"`
	// LatestGenerationFailure 仅在最近一次生成尝试失败时返回；历史面板仍按需调用历史接口。
	LatestGenerationFailure *CanvasNodeGenerationFailure `json:"LatestGenerationFailure,omitempty"`
}

func NewCanvasNode() *CanvasNode {
	return &CanvasNode{}
}

func (p *CanvasNode) InitDefault() {
}

var CanvasNode_ActiveTaskType_DEFAULT CanvasNodeTaskType

func (p *CanvasNode) GetActiveTaskType() (v CanvasNodeTaskType) {
	if !p.IsSetActiveTaskType() {
		return CanvasNode_ActiveTaskType_DEFAULT
	}
	return *p.ActiveTaskType
}

func (p *CanvasNode) GetNodeID() (v string) {
	return p.NodeID
}

func (p *CanvasNode) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *CanvasNode) GetCanvasNodeNo() (v int32) {
	return p.CanvasNodeNo
}

func (p *CanvasNode) GetPrompt() (v string) {
	return p.Prompt
}

var CanvasNode_GenerationConfig_DEFAULT *CanvasNodeGenerationConfig

func (p *CanvasNode) GetGenerationConfig() (v *CanvasNodeGenerationConfig) {
	if !p.IsSetGenerationConfig() {
		return CanvasNode_GenerationConfig_DEFAULT
	}
	return p.GenerationConfig
}

func (p *CanvasNode) GetStatus() (v CanvasNodeStatus) {
	return p.Status
}

var CanvasNode_SelectedOutputID_DEFAULT string

func (p *CanvasNode) GetSelectedOutputID() (v string) {
	if !p.IsSetSelectedOutputID() {
		return CanvasNode_SelectedOutputID_DEFAULT
	}
	return *p.SelectedOutputID
}

var CanvasNode_SelectedAssetID_DEFAULT string

func (p *CanvasNode) GetSelectedAssetID() (v string) {
	if !p.IsSetSelectedAssetID() {
		return CanvasNode_SelectedAssetID_DEFAULT
	}
	return *p.SelectedAssetID
}

func (p *CanvasNode) GetCreatedAt() (v common.Timestamp) {
	return p.CreatedAt
}

func (p *CanvasNode) GetUpdatedAt() (v common.Timestamp) {
	return p.UpdatedAt
}

func (p *CanvasNode) GetCreatedBy() (v string) {
	return p.CreatedBy
}

func (p *CanvasNode) GetUpdatedBy() (v string) {
	return p.UpdatedBy
}

var CanvasNode_ActiveTaskRunID_DEFAULT string

func (p *CanvasNode) GetActiveTaskRunID() (v string) {
	if !p.IsSetActiveTaskRunID() {
		return CanvasNode_ActiveTaskRunID_DEFAULT
	}
	return *p.ActiveTaskRunID
}

var CanvasNode_FirstFrameAssetID_DEFAULT string

func (p *CanvasNode) GetFirstFrameAssetID() (v string) {
	if !p.IsSetFirstFrameAssetID() {
		return CanvasNode_FirstFrameAssetID_DEFAULT
	}
	return *p.FirstFrameAssetID
}

var CanvasNode_SelectedOutputDurationSeconds_DEFAULT int32

func (p *CanvasNode) GetSelectedOutputDurationSeconds() (v int32) {
	if !p.IsSetSelectedOutputDurationSeconds() {
		return CanvasNode_SelectedOutputDurationSeconds_DEFAULT
	}
	return *p.SelectedOutputDurationSeconds
}

var CanvasNode_FirstFrameURL_DEFAULT string

func (p *CanvasNode) GetFirstFrameURL() (v string) {
	if !p.IsSetFirstFrameURL() {
		return CanvasNode_FirstFrameURL_DEFAULT
	}
	return *p.FirstFrameURL
}

var CanvasNode_SelectedOutputURL_DEFAULT string

func (p *CanvasNode) GetSelectedOutputURL() (v string) {
	if !p.IsSetSelectedOutputURL() {
		return CanvasNode_SelectedOutputURL_DEFAULT
	}
	return *p.SelectedOutputURL
}

func (p *CanvasNode) GetType() (v CanvasNodeType) {
	return p.Type
}

func (p *CanvasNode) GetName() (v string) {
	return p.Name
}

var CanvasNode_Position_DEFAULT *CanvasNodePosition

func (p *CanvasNode) GetPosition() (v *CanvasNodePosition) {
	if !p.IsSetPosition() {
		return CanvasNode_Position_DEFAULT
	}
	return p.Position
}

var CanvasNode_StoryboardRank_DEFAULT int64

func (p *CanvasNode) GetStoryboardRank() (v int64) {
	if !p.IsSetStoryboardRank() {
		return CanvasNode_StoryboardRank_DEFAULT
	}
	return *p.StoryboardRank
}

var CanvasNode_Text_DEFAULT string

func (p *CanvasNode) GetText() (v string) {
	if !p.IsSetText() {
		return CanvasNode_Text_DEFAULT
	}
	return *p.Text
}

var CanvasNode_AssetID_DEFAULT string

func (p *CanvasNode) GetAssetID() (v string) {
	if !p.IsSetAssetID() {
		return CanvasNode_AssetID_DEFAULT
	}
	return *p.AssetID
}

var CanvasNode_VideoInputMode_DEFAULT CanvasVideoInputMode

func (p *CanvasNode) GetVideoInputMode() (v CanvasVideoInputMode) {
	if !p.IsSetVideoInputMode() {
		return CanvasNode_VideoInputMode_DEFAULT
	}
	return *p.VideoInputMode
}

func (p *CanvasNode) GetIncomingEdges() (v []*CanvasEdge) {
	return p.IncomingEdges
}

func (p *CanvasNode) GetRevision() (v int64) {
	return p.Revision
}

var CanvasNode_ResourceAssetID_DEFAULT string

func (p *CanvasNode) GetResourceAssetID() (v string) {
	if !p.IsSetResourceAssetID() {
		return CanvasNode_ResourceAssetID_DEFAULT
	}
	return *p.ResourceAssetID
}

var CanvasNode_CurrentAssetID_DEFAULT string

func (p *CanvasNode) GetCurrentAssetID() (v string) {
	if !p.IsSetCurrentAssetID() {
		return CanvasNode_CurrentAssetID_DEFAULT
	}
	return *p.CurrentAssetID
}

var CanvasNode_ResourceAssetRevision_DEFAULT int64

func (p *CanvasNode) GetResourceAssetRevision() (v int64) {
	if !p.IsSetResourceAssetRevision() {
		return CanvasNode_ResourceAssetRevision_DEFAULT
	}
	return *p.ResourceAssetRevision
}

var CanvasNode_SelectedOutputText_DEFAULT string

func (p *CanvasNode) GetSelectedOutputText() (v string) {
	if !p.IsSetSelectedOutputText() {
		return CanvasNode_SelectedOutputText_DEFAULT
	}
	return *p.SelectedOutputText
}

var CanvasNode_LastFrameAssetID_DEFAULT string

func (p *CanvasNode) GetLastFrameAssetID() (v string) {
	if !p.IsSetLastFrameAssetID() {
		return CanvasNode_LastFrameAssetID_DEFAULT
	}
	return *p.LastFrameAssetID
}

var CanvasNode_ResourceID_DEFAULT string

func (p *CanvasNode) GetResourceID() (v string) {
	if !p.IsSetResourceID() {
		return CanvasNode_ResourceID_DEFAULT
	}
	return *p.ResourceID
}

var CanvasNode_ResourceAssetIsPrimary_DEFAULT bool

func (p *CanvasNode) GetResourceAssetIsPrimary() (v bool) {
	if !p.IsSetResourceAssetIsPrimary() {
		return CanvasNode_ResourceAssetIsPrimary_DEFAULT
	}
	return *p.ResourceAssetIsPrimary
}

var CanvasNode_ReferenceType_DEFAULT CanvasNodeMentionReferenceType

func (p *CanvasNode) GetReferenceType() (v CanvasNodeMentionReferenceType) {
	if !p.IsSetReferenceType() {
		return CanvasNode_ReferenceType_DEFAULT
	}
	return *p.ReferenceType
}

func (p *CanvasNode) GetReferenceStatus() (v CanvasNodeReferenceStatus) {
	return p.ReferenceStatus
}

var CanvasNode_PreviewURL_DEFAULT string

func (p *CanvasNode) GetPreviewURL() (v string) {
	if !p.IsSetPreviewURL() {
		return CanvasNode_PreviewURL_DEFAULT
	}
	return *p.PreviewURL
}

var CanvasNode_Reviews_DEFAULT []*asset.AssetReview

func (p *CanvasNode) GetReviews() (v []*asset.AssetReview) {
	if !p.IsSetReviews() {
		return CanvasNode_Reviews_DEFAULT
	}
	return p.Reviews
}

var CanvasNode_LatestGenerationFailure_DEFAULT *CanvasNodeGenerationFailure

func (p *CanvasNode) GetLatestGenerationFailure() (v *CanvasNodeGenerationFailure) {
	if !p.IsSetLatestGenerationFailure() {
		return CanvasNode_LatestGenerationFailure_DEFAULT
	}
	return p.LatestGenerationFailure
}

func (p *CanvasNode) IsSetActiveTaskType() bool {
	return p.ActiveTaskType != nil
}

func (p *CanvasNode) IsSetGenerationConfig() bool {
	return p.GenerationConfig != nil
}

func (p *CanvasNode) IsSetSelectedOutputID() bool {
	return p.SelectedOutputID != nil
}

func (p *CanvasNode) IsSetSelectedAssetID() bool {
	return p.SelectedAssetID != nil
}

func (p *CanvasNode) IsSetActiveTaskRunID() bool {
	return p.ActiveTaskRunID != nil
}

func (p *CanvasNode) IsSetFirstFrameAssetID() bool {
	return p.FirstFrameAssetID != nil
}

func (p *CanvasNode) IsSetSelectedOutputDurationSeconds() bool {
	return p.SelectedOutputDurationSeconds != nil
}

func (p *CanvasNode) IsSetFirstFrameURL() bool {
	return p.FirstFrameURL != nil
}

func (p *CanvasNode) IsSetSelectedOutputURL() bool {
	return p.SelectedOutputURL != nil
}

func (p *CanvasNode) IsSetPosition() bool {
	return p.Position != nil
}

func (p *CanvasNode) IsSetStoryboardRank() bool {
	return p.StoryboardRank != nil
}

func (p *CanvasNode) IsSetText() bool {
	return p.Text != nil
}

func (p *CanvasNode) IsSetAssetID() bool {
	return p.AssetID != nil
}

func (p *CanvasNode) IsSetVideoInputMode() bool {
	return p.VideoInputMode != nil
}

func (p *CanvasNode) IsSetResourceAssetID() bool {
	return p.ResourceAssetID != nil
}

func (p *CanvasNode) IsSetCurrentAssetID() bool {
	return p.CurrentAssetID != nil
}

func (p *CanvasNode) IsSetResourceAssetRevision() bool {
	return p.ResourceAssetRevision != nil
}

func (p *CanvasNode) IsSetSelectedOutputText() bool {
	return p.SelectedOutputText != nil
}

func (p *CanvasNode) IsSetLastFrameAssetID() bool {
	return p.LastFrameAssetID != nil
}

func (p *CanvasNode) IsSetResourceID() bool {
	return p.ResourceID != nil
}

func (p *CanvasNode) IsSetResourceAssetIsPrimary() bool {
	return p.ResourceAssetIsPrimary != nil
}

func (p *CanvasNode) IsSetReferenceType() bool {
	return p.ReferenceType != nil
}

func (p *CanvasNode) IsSetPreviewURL() bool {
	return p.PreviewURL != nil
}

func (p *CanvasNode) IsSetReviews() bool {
	return p.Reviews != nil
}

func (p *CanvasNode) IsSetLatestGenerationFailure() bool {
	return p.LatestGenerationFailure != nil
}

func (p *CanvasNode) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNode(%+v)", *p)
}

type GetCanvasGraphRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
}

func NewGetCanvasGraphRequest() *GetCanvasGraphRequest {
	return &GetCanvasGraphRequest{}
}

func (p *GetCanvasGraphRequest) InitDefault() {
}

var GetCanvasGraphRequest_WorkspaceID_DEFAULT string

func (p *GetCanvasGraphRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return GetCanvasGraphRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *GetCanvasGraphRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *GetCanvasGraphRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *GetCanvasGraphRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *GetCanvasGraphRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetCanvasGraphRequest(%+v)", *p)
}

type GetCanvasGraphResponse struct {
	Nodes []*CanvasNode `json:"Nodes"`
}

func NewGetCanvasGraphResponse() *GetCanvasGraphResponse {
	return &GetCanvasGraphResponse{}
}

func (p *GetCanvasGraphResponse) InitDefault() {
}

func (p *GetCanvasGraphResponse) GetNodes() (v []*CanvasNode) {
	return p.Nodes
}

func (p *GetCanvasGraphResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetCanvasGraphResponse(%+v)", *p)
}

// CreateCanvasAssetRequest 将临时 Blob 注册为当前 Project 可用的画布素材。
// Asset Owner 由 Server 根据可信 Project/Canvas scope 派生，调用方不能指定。
type CreateCanvasAssetRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	BlobID      string  `json:"BlobID"`
	FileName    string  `json:"FileName"`
}

func NewCreateCanvasAssetRequest() *CreateCanvasAssetRequest {
	return &CreateCanvasAssetRequest{}
}

func (p *CreateCanvasAssetRequest) InitDefault() {
}

var CreateCanvasAssetRequest_WorkspaceID_DEFAULT string

func (p *CreateCanvasAssetRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CreateCanvasAssetRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CreateCanvasAssetRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CreateCanvasAssetRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *CreateCanvasAssetRequest) GetBlobID() (v string) {
	return p.BlobID
}

func (p *CreateCanvasAssetRequest) GetFileName() (v string) {
	return p.FileName
}

func (p *CreateCanvasAssetRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CreateCanvasAssetRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateCanvasAssetRequest(%+v)", *p)
}

type CreateCanvasAssetResponse struct {
	Asset *asset.Asset `json:"Asset"`
}

func NewCreateCanvasAssetResponse() *CreateCanvasAssetResponse {
	return &CreateCanvasAssetResponse{}
}

func (p *CreateCanvasAssetResponse) InitDefault() {
}

var CreateCanvasAssetResponse_Asset_DEFAULT *asset.Asset

func (p *CreateCanvasAssetResponse) GetAsset() (v *asset.Asset) {
	if !p.IsSetAsset() {
		return CreateCanvasAssetResponse_Asset_DEFAULT
	}
	return p.Asset
}

func (p *CreateCanvasAssetResponse) IsSetAsset() bool {
	return p.Asset != nil
}

func (p *CreateCanvasAssetResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateCanvasAssetResponse(%+v)", *p)
}

// CanvasUploadedAsset 是由节点创建或素材物化直接消费的临时 Blob。
type CanvasUploadedAsset struct {
	BlobID   string `json:"BlobID"`
	FileName string `json:"FileName"`
}

func NewCanvasUploadedAsset() *CanvasUploadedAsset {
	return &CanvasUploadedAsset{}
}

func (p *CanvasUploadedAsset) InitDefault() {
}

func (p *CanvasUploadedAsset) GetBlobID() (v string) {
	return p.BlobID
}

func (p *CanvasUploadedAsset) GetFileName() (v string) {
	return p.FileName
}

func (p *CanvasUploadedAsset) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasUploadedAsset(%+v)", *p)
}

// CreateCanvasNodeRequest 是创建剧集分镜的请求。
type CreateCanvasNodeRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是所属项目标识。
	ProjectID string `json:"ProjectID"`
	// CanvasID 是所属剧集标识。
	CanvasID string `json:"CanvasID"`
	// AfterNodeID 指定插入位置；未传时追加到末尾。
	AfterNodeID *string `json:"AfterNodeID,omitempty"`
	// ModelServiceID 是前端从当前环境模型列表选择的视频生成模型服务标识。
	ModelServiceID  *string             `json:"ModelServiceID,omitempty"`
	Type            CanvasNodeType      `json:"Type"`
	Position        *CanvasNodePosition `json:"Position"`
	Text            *string             `json:"Text,omitempty"`
	AssetID         *string             `json:"AssetID,omitempty"`
	ResourceAssetID *string             `json:"ResourceAssetID,omitempty"`
	// ResourceID 创建会持续跟踪 Resource 的主素材；与 AssetID、ResourceAssetID 互斥。
	ResourceID *string `json:"ResourceID,omitempty"`
	// UploadedAsset 创建 Project Asset 并立即绑定素材节点；与 AssetID、ResourceID、ResourceAssetID 互斥。
	UploadedAsset *CanvasUploadedAsset `json:"UploadedAsset,omitempty"`
}

func NewCreateCanvasNodeRequest() *CreateCanvasNodeRequest {
	return &CreateCanvasNodeRequest{}
}

func (p *CreateCanvasNodeRequest) InitDefault() {
}

var CreateCanvasNodeRequest_WorkspaceID_DEFAULT string

func (p *CreateCanvasNodeRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CreateCanvasNodeRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CreateCanvasNodeRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CreateCanvasNodeRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

var CreateCanvasNodeRequest_AfterNodeID_DEFAULT string

func (p *CreateCanvasNodeRequest) GetAfterNodeID() (v string) {
	if !p.IsSetAfterNodeID() {
		return CreateCanvasNodeRequest_AfterNodeID_DEFAULT
	}
	return *p.AfterNodeID
}

var CreateCanvasNodeRequest_ModelServiceID_DEFAULT string

func (p *CreateCanvasNodeRequest) GetModelServiceID() (v string) {
	if !p.IsSetModelServiceID() {
		return CreateCanvasNodeRequest_ModelServiceID_DEFAULT
	}
	return *p.ModelServiceID
}

func (p *CreateCanvasNodeRequest) GetType() (v CanvasNodeType) {
	return p.Type
}

var CreateCanvasNodeRequest_Position_DEFAULT *CanvasNodePosition

func (p *CreateCanvasNodeRequest) GetPosition() (v *CanvasNodePosition) {
	if !p.IsSetPosition() {
		return CreateCanvasNodeRequest_Position_DEFAULT
	}
	return p.Position
}

var CreateCanvasNodeRequest_Text_DEFAULT string

func (p *CreateCanvasNodeRequest) GetText() (v string) {
	if !p.IsSetText() {
		return CreateCanvasNodeRequest_Text_DEFAULT
	}
	return *p.Text
}

var CreateCanvasNodeRequest_AssetID_DEFAULT string

func (p *CreateCanvasNodeRequest) GetAssetID() (v string) {
	if !p.IsSetAssetID() {
		return CreateCanvasNodeRequest_AssetID_DEFAULT
	}
	return *p.AssetID
}

var CreateCanvasNodeRequest_ResourceAssetID_DEFAULT string

func (p *CreateCanvasNodeRequest) GetResourceAssetID() (v string) {
	if !p.IsSetResourceAssetID() {
		return CreateCanvasNodeRequest_ResourceAssetID_DEFAULT
	}
	return *p.ResourceAssetID
}

var CreateCanvasNodeRequest_ResourceID_DEFAULT string

func (p *CreateCanvasNodeRequest) GetResourceID() (v string) {
	if !p.IsSetResourceID() {
		return CreateCanvasNodeRequest_ResourceID_DEFAULT
	}
	return *p.ResourceID
}

var CreateCanvasNodeRequest_UploadedAsset_DEFAULT *CanvasUploadedAsset

func (p *CreateCanvasNodeRequest) GetUploadedAsset() (v *CanvasUploadedAsset) {
	if !p.IsSetUploadedAsset() {
		return CreateCanvasNodeRequest_UploadedAsset_DEFAULT
	}
	return p.UploadedAsset
}

func (p *CreateCanvasNodeRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CreateCanvasNodeRequest) IsSetAfterNodeID() bool {
	return p.AfterNodeID != nil
}

func (p *CreateCanvasNodeRequest) IsSetModelServiceID() bool {
	return p.ModelServiceID != nil
}

func (p *CreateCanvasNodeRequest) IsSetPosition() bool {
	return p.Position != nil
}

func (p *CreateCanvasNodeRequest) IsSetText() bool {
	return p.Text != nil
}

func (p *CreateCanvasNodeRequest) IsSetAssetID() bool {
	return p.AssetID != nil
}

func (p *CreateCanvasNodeRequest) IsSetResourceAssetID() bool {
	return p.ResourceAssetID != nil
}

func (p *CreateCanvasNodeRequest) IsSetResourceID() bool {
	return p.ResourceID != nil
}

func (p *CreateCanvasNodeRequest) IsSetUploadedAsset() bool {
	return p.UploadedAsset != nil
}

func (p *CreateCanvasNodeRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateCanvasNodeRequest(%+v)", *p)
}

// CreateCanvasNodeResponse 是创建剧集分镜的响应。
type CreateCanvasNodeResponse struct {
	// CanvasNode 是新创建的分镜。
	CanvasNode     *CanvasNode `json:"CanvasNode"`
	CanvasRevision int64       `json:"CanvasRevision"`
}

func NewCreateCanvasNodeResponse() *CreateCanvasNodeResponse {
	return &CreateCanvasNodeResponse{}
}

func (p *CreateCanvasNodeResponse) InitDefault() {
}

var CreateCanvasNodeResponse_CanvasNode_DEFAULT *CanvasNode

func (p *CreateCanvasNodeResponse) GetCanvasNode() (v *CanvasNode) {
	if !p.IsSetCanvasNode() {
		return CreateCanvasNodeResponse_CanvasNode_DEFAULT
	}
	return p.CanvasNode
}

func (p *CreateCanvasNodeResponse) GetCanvasRevision() (v int64) {
	return p.CanvasRevision
}

func (p *CreateCanvasNodeResponse) IsSetCanvasNode() bool {
	return p.CanvasNode != nil
}

func (p *CreateCanvasNodeResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateCanvasNodeResponse(%+v)", *p)
}

// CopyCanvasNodeRequest 在同一 Canvas 内复制节点定义和当前可消费内容到指定画布坐标。
// 外部 IncomingEdges、生成运行态和生成历史不属于复制内容；媒体复用不可变 Asset。
type CopyCanvasNodeRequest struct {
	WorkspaceID  *string             `json:"WorkspaceID,omitempty"`
	ProjectID    string              `json:"ProjectID"`
	CanvasID     string              `json:"CanvasID"`
	SourceNodeID string              `json:"SourceNodeID"`
	Position     *CanvasNodePosition `json:"Position"`
}

func NewCopyCanvasNodeRequest() *CopyCanvasNodeRequest {
	return &CopyCanvasNodeRequest{}
}

func (p *CopyCanvasNodeRequest) InitDefault() {
}

var CopyCanvasNodeRequest_WorkspaceID_DEFAULT string

func (p *CopyCanvasNodeRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CopyCanvasNodeRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CopyCanvasNodeRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CopyCanvasNodeRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *CopyCanvasNodeRequest) GetSourceNodeID() (v string) {
	return p.SourceNodeID
}

var CopyCanvasNodeRequest_Position_DEFAULT *CanvasNodePosition

func (p *CopyCanvasNodeRequest) GetPosition() (v *CanvasNodePosition) {
	if !p.IsSetPosition() {
		return CopyCanvasNodeRequest_Position_DEFAULT
	}
	return p.Position
}

func (p *CopyCanvasNodeRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CopyCanvasNodeRequest) IsSetPosition() bool {
	return p.Position != nil
}

func (p *CopyCanvasNodeRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CopyCanvasNodeRequest(%+v)", *p)
}

type CopyCanvasNodeResponse struct {
	CanvasNode     *CanvasNode `json:"CanvasNode"`
	CanvasRevision int64       `json:"CanvasRevision"`
}

func NewCopyCanvasNodeResponse() *CopyCanvasNodeResponse {
	return &CopyCanvasNodeResponse{}
}

func (p *CopyCanvasNodeResponse) InitDefault() {
}

var CopyCanvasNodeResponse_CanvasNode_DEFAULT *CanvasNode

func (p *CopyCanvasNodeResponse) GetCanvasNode() (v *CanvasNode) {
	if !p.IsSetCanvasNode() {
		return CopyCanvasNodeResponse_CanvasNode_DEFAULT
	}
	return p.CanvasNode
}

func (p *CopyCanvasNodeResponse) GetCanvasRevision() (v int64) {
	return p.CanvasRevision
}

func (p *CopyCanvasNodeResponse) IsSetCanvasNode() bool {
	return p.CanvasNode != nil
}

func (p *CopyCanvasNodeResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CopyCanvasNodeResponse(%+v)", *p)
}

// CanvasNodeDraftAssetReference 是草稿 Prompt 的结构化素材引用；草稿 Prompt 自身保持纯文本。
// ResourceAssetID 用于确认时绑定项目素材；AssetID 用于读取当前审核和预览信息。
type CanvasNodeDraftAssetReference struct {
	ResourceAssetID string                `json:"ResourceAssetID"`
	AssetID         *string               `json:"AssetID,omitempty"`
	Label           *string               `json:"Label,omitempty"`
	MediaType       *asset.AssetMediaType `json:"MediaType,omitempty"`
	TargetField     string                `json:"TargetField"`
	AnchorText      string                `json:"AnchorText"`
}

func NewCanvasNodeDraftAssetReference() *CanvasNodeDraftAssetReference {
	return &CanvasNodeDraftAssetReference{}
}

func (p *CanvasNodeDraftAssetReference) InitDefault() {
}

func (p *CanvasNodeDraftAssetReference) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

var CanvasNodeDraftAssetReference_AssetID_DEFAULT string

func (p *CanvasNodeDraftAssetReference) GetAssetID() (v string) {
	if !p.IsSetAssetID() {
		return CanvasNodeDraftAssetReference_AssetID_DEFAULT
	}
	return *p.AssetID
}

var CanvasNodeDraftAssetReference_Label_DEFAULT string

func (p *CanvasNodeDraftAssetReference) GetLabel() (v string) {
	if !p.IsSetLabel() {
		return CanvasNodeDraftAssetReference_Label_DEFAULT
	}
	return *p.Label
}

var CanvasNodeDraftAssetReference_MediaType_DEFAULT asset.AssetMediaType

func (p *CanvasNodeDraftAssetReference) GetMediaType() (v asset.AssetMediaType) {
	if !p.IsSetMediaType() {
		return CanvasNodeDraftAssetReference_MediaType_DEFAULT
	}
	return *p.MediaType
}

func (p *CanvasNodeDraftAssetReference) GetTargetField() (v string) {
	return p.TargetField
}

func (p *CanvasNodeDraftAssetReference) GetAnchorText() (v string) {
	return p.AnchorText
}

func (p *CanvasNodeDraftAssetReference) IsSetAssetID() bool {
	return p.AssetID != nil
}

func (p *CanvasNodeDraftAssetReference) IsSetLabel() bool {
	return p.Label != nil
}

func (p *CanvasNodeDraftAssetReference) IsSetMediaType() bool {
	return p.MediaType != nil
}

func (p *CanvasNodeDraftAssetReference) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeDraftAssetReference(%+v)", *p)
}

// CanvasNodeDraft 是 SSE 与待确认详情返回、尚未转为正式 CanvasNode 的候选分镜。
type CanvasNodeDraft struct {
	DraftID      string `json:"DraftID"`
	CanvasNodeNo int32  `json:"CanvasNodeNo"`
	// Prompt 在草稿预览阶段保持纯文本；确认创建正式节点时才由服务端插入素材 mention。
	Prompt string `json:"Prompt"`
	// DurationSeconds 是分镜规划结果；其余视频生成参数由本次批量任务的 ModelConfig 固定。
	DurationSeconds int32                            `json:"DurationSeconds"`
	AssetReferences []*CanvasNodeDraftAssetReference `json:"AssetReferences"`
}

func NewCanvasNodeDraft() *CanvasNodeDraft {
	return &CanvasNodeDraft{}
}

func (p *CanvasNodeDraft) InitDefault() {
}

func (p *CanvasNodeDraft) GetDraftID() (v string) {
	return p.DraftID
}

func (p *CanvasNodeDraft) GetCanvasNodeNo() (v int32) {
	return p.CanvasNodeNo
}

func (p *CanvasNodeDraft) GetPrompt() (v string) {
	return p.Prompt
}

func (p *CanvasNodeDraft) GetDurationSeconds() (v int32) {
	return p.DurationSeconds
}

func (p *CanvasNodeDraft) GetAssetReferences() (v []*CanvasNodeDraftAssetReference) {
	return p.AssetReferences
}

func (p *CanvasNodeDraft) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeDraft(%+v)", *p)
}

// StoryboardVideoParameters 是批量分镜规划和后续视频生成共同使用的固定参数。
type StoryboardVideoParameters struct {
	Resolution    CanvasNodeResolution  `json:"Resolution"`
	AspectRatio   CanvasNodeAspectRatio `json:"AspectRatio"`
	GenerateAudio bool                  `json:"GenerateAudio"`
	Watermark     bool                  `json:"Watermark"`
}

func NewStoryboardVideoParameters() *StoryboardVideoParameters {
	return &StoryboardVideoParameters{}
}

func (p *StoryboardVideoParameters) InitDefault() {
}

func (p *StoryboardVideoParameters) GetResolution() (v CanvasNodeResolution) {
	return p.Resolution
}

func (p *StoryboardVideoParameters) GetAspectRatio() (v CanvasNodeAspectRatio) {
	return p.AspectRatio
}

func (p *StoryboardVideoParameters) GetGenerateAudio() (v bool) {
	return p.GenerateAudio
}

func (p *StoryboardVideoParameters) GetWatermark() (v bool) {
	return p.Watermark
}

func (p *StoryboardVideoParameters) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StoryboardVideoParameters(%+v)", *p)
}

// StoryboardModelConfig 保存批量分镜任务使用的模型与视频生成参数。
// 模型字段为空时使用应用级默认模型；VideoParameters 必须由调用方明确提交。
type StoryboardModelConfig struct {
	InferenceModelServiceID *string                    `json:"InferenceModelServiceID,omitempty"`
	VideoModelServiceID     *string                    `json:"VideoModelServiceID,omitempty"`
	VideoParameters         *StoryboardVideoParameters `json:"VideoParameters"`
}

func NewStoryboardModelConfig() *StoryboardModelConfig {
	return &StoryboardModelConfig{}
}

func (p *StoryboardModelConfig) InitDefault() {
}

var StoryboardModelConfig_InferenceModelServiceID_DEFAULT string

func (p *StoryboardModelConfig) GetInferenceModelServiceID() (v string) {
	if !p.IsSetInferenceModelServiceID() {
		return StoryboardModelConfig_InferenceModelServiceID_DEFAULT
	}
	return *p.InferenceModelServiceID
}

var StoryboardModelConfig_VideoModelServiceID_DEFAULT string

func (p *StoryboardModelConfig) GetVideoModelServiceID() (v string) {
	if !p.IsSetVideoModelServiceID() {
		return StoryboardModelConfig_VideoModelServiceID_DEFAULT
	}
	return *p.VideoModelServiceID
}

var StoryboardModelConfig_VideoParameters_DEFAULT *StoryboardVideoParameters

func (p *StoryboardModelConfig) GetVideoParameters() (v *StoryboardVideoParameters) {
	if !p.IsSetVideoParameters() {
		return StoryboardModelConfig_VideoParameters_DEFAULT
	}
	return p.VideoParameters
}

func (p *StoryboardModelConfig) IsSetInferenceModelServiceID() bool {
	return p.InferenceModelServiceID != nil
}

func (p *StoryboardModelConfig) IsSetVideoModelServiceID() bool {
	return p.VideoModelServiceID != nil
}

func (p *StoryboardModelConfig) IsSetVideoParameters() bool {
	return p.VideoParameters != nil
}

func (p *StoryboardModelConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StoryboardModelConfig(%+v)", *p)
}

type StoryboardPlanningConfig struct {
	// 单分镜时长范围必须位于所选视频模型能力内；都不传时默认使用模型的完整能力范围。
	CanvasNodeDurationMinSeconds *int32 `json:"CanvasNodeDurationMinSeconds,omitempty"`
	CanvasNodeDurationMaxSeconds *int32 `json:"CanvasNodeDurationMaxSeconds,omitempty"`
	// 总视频时长范围两个字段必须同时传入，取值为 60 至 3000 秒；都不传表示不限制总时长。
	TotalDurationMinSeconds *int32 `json:"TotalDurationMinSeconds,omitempty"`
	TotalDurationMaxSeconds *int32 `json:"TotalDurationMaxSeconds,omitempty"`
}

func NewStoryboardPlanningConfig() *StoryboardPlanningConfig {
	return &StoryboardPlanningConfig{}
}

func (p *StoryboardPlanningConfig) InitDefault() {
}

var StoryboardPlanningConfig_CanvasNodeDurationMinSeconds_DEFAULT int32

func (p *StoryboardPlanningConfig) GetCanvasNodeDurationMinSeconds() (v int32) {
	if !p.IsSetCanvasNodeDurationMinSeconds() {
		return StoryboardPlanningConfig_CanvasNodeDurationMinSeconds_DEFAULT
	}
	return *p.CanvasNodeDurationMinSeconds
}

var StoryboardPlanningConfig_CanvasNodeDurationMaxSeconds_DEFAULT int32

func (p *StoryboardPlanningConfig) GetCanvasNodeDurationMaxSeconds() (v int32) {
	if !p.IsSetCanvasNodeDurationMaxSeconds() {
		return StoryboardPlanningConfig_CanvasNodeDurationMaxSeconds_DEFAULT
	}
	return *p.CanvasNodeDurationMaxSeconds
}

var StoryboardPlanningConfig_TotalDurationMinSeconds_DEFAULT int32

func (p *StoryboardPlanningConfig) GetTotalDurationMinSeconds() (v int32) {
	if !p.IsSetTotalDurationMinSeconds() {
		return StoryboardPlanningConfig_TotalDurationMinSeconds_DEFAULT
	}
	return *p.TotalDurationMinSeconds
}

var StoryboardPlanningConfig_TotalDurationMaxSeconds_DEFAULT int32

func (p *StoryboardPlanningConfig) GetTotalDurationMaxSeconds() (v int32) {
	if !p.IsSetTotalDurationMaxSeconds() {
		return StoryboardPlanningConfig_TotalDurationMaxSeconds_DEFAULT
	}
	return *p.TotalDurationMaxSeconds
}

func (p *StoryboardPlanningConfig) IsSetCanvasNodeDurationMinSeconds() bool {
	return p.CanvasNodeDurationMinSeconds != nil
}

func (p *StoryboardPlanningConfig) IsSetCanvasNodeDurationMaxSeconds() bool {
	return p.CanvasNodeDurationMaxSeconds != nil
}

func (p *StoryboardPlanningConfig) IsSetTotalDurationMinSeconds() bool {
	return p.TotalDurationMinSeconds != nil
}

func (p *StoryboardPlanningConfig) IsSetTotalDurationMaxSeconds() bool {
	return p.TotalDurationMaxSeconds != nil
}

func (p *StoryboardPlanningConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StoryboardPlanningConfig(%+v)", *p)
}

// CanvasNodeDraftSession 是由 TaskRunID 精确选择的一次批量分镜任务详情。
type CanvasNodeDraftSession struct {
	TaskRunID string                `json:"TaskRunID"`
	Plot      string                `json:"Plot"`
	Status    CanvasNodeDraftStatus `json:"Status"`
	// CanvasNodes 在普通列表/Get 恢复已完成任务时一次性返回；SSE session 首事件可以为空。
	CanvasNodes    []*CanvasNodeDraft        `json:"CanvasNodes,omitempty"`
	ModelConfig    *StoryboardModelConfig    `json:"ModelConfig,omitempty"`
	PlanningConfig *StoryboardPlanningConfig `json:"PlanningConfig,omitempty"`
}

func NewCanvasNodeDraftSession() *CanvasNodeDraftSession {
	return &CanvasNodeDraftSession{}
}

func (p *CanvasNodeDraftSession) InitDefault() {
}

func (p *CanvasNodeDraftSession) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *CanvasNodeDraftSession) GetPlot() (v string) {
	return p.Plot
}

func (p *CanvasNodeDraftSession) GetStatus() (v CanvasNodeDraftStatus) {
	return p.Status
}

var CanvasNodeDraftSession_CanvasNodes_DEFAULT []*CanvasNodeDraft

func (p *CanvasNodeDraftSession) GetCanvasNodes() (v []*CanvasNodeDraft) {
	if !p.IsSetCanvasNodes() {
		return CanvasNodeDraftSession_CanvasNodes_DEFAULT
	}
	return p.CanvasNodes
}

var CanvasNodeDraftSession_ModelConfig_DEFAULT *StoryboardModelConfig

func (p *CanvasNodeDraftSession) GetModelConfig() (v *StoryboardModelConfig) {
	if !p.IsSetModelConfig() {
		return CanvasNodeDraftSession_ModelConfig_DEFAULT
	}
	return p.ModelConfig
}

var CanvasNodeDraftSession_PlanningConfig_DEFAULT *StoryboardPlanningConfig

func (p *CanvasNodeDraftSession) GetPlanningConfig() (v *StoryboardPlanningConfig) {
	if !p.IsSetPlanningConfig() {
		return CanvasNodeDraftSession_PlanningConfig_DEFAULT
	}
	return p.PlanningConfig
}

func (p *CanvasNodeDraftSession) IsSetCanvasNodes() bool {
	return p.CanvasNodes != nil
}

func (p *CanvasNodeDraftSession) IsSetModelConfig() bool {
	return p.ModelConfig != nil
}

func (p *CanvasNodeDraftSession) IsSetPlanningConfig() bool {
	return p.PlanningConfig != nil
}

func (p *CanvasNodeDraftSession) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeDraftSession(%+v)", *p)
}

// CreateCanvasNodesCompleted 是 SSE completed 事件的数据。
type CreateCanvasNodesCompleted struct {
	Count int32 `json:"Count"`
}

func NewCreateCanvasNodesCompleted() *CreateCanvasNodesCompleted {
	return &CreateCanvasNodesCompleted{}
}

func (p *CreateCanvasNodesCompleted) InitDefault() {
}

func (p *CreateCanvasNodesCompleted) GetCount() (v int32) {
	return p.Count
}

func (p *CreateCanvasNodesCompleted) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateCanvasNodesCompleted(%+v)", *p)
}

// CreateCanvasNodesError 是 SSE error 事件的安全错误数据。
type CreateCanvasNodesError struct {
	Code    string `json:"Code"`
	Message string `json:"Message"`
}

func NewCreateCanvasNodesError() *CreateCanvasNodesError {
	return &CreateCanvasNodesError{}
}

func (p *CreateCanvasNodesError) InitDefault() {
}

func (p *CreateCanvasNodesError) GetCode() (v string) {
	return p.Code
}

func (p *CreateCanvasNodesError) GetMessage() (v string) {
	return p.Message
}

func (p *CreateCanvasNodesError) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateCanvasNodesError(%+v)", *p)
}

// CreateCanvasNodesRequest 创建持久化批量分镜任务；客户端通过统一画布轮询读取任务和草稿节点。
type CreateCanvasNodesRequest struct {
	WorkspaceID    *string                   `json:"WorkspaceID,omitempty"`
	ProjectID      string                    `json:"ProjectID"`
	CanvasID       string                    `json:"CanvasID"`
	Plot           string                    `json:"Plot"`
	ModelConfig    *StoryboardModelConfig    `json:"ModelConfig"`
	PlanningConfig *StoryboardPlanningConfig `json:"PlanningConfig"`
	// CanvasNodes is supplied by the Chat tool when the Agent already produced the structured storyboard.
	// When omitted, Canvas runs its deterministic planner for the manually entered plot and parameters.
	// Both modes use the same durable draft lifecycle.
	CanvasNodes []*CanvasNodeDraft `json:"CanvasNodes,omitempty"`
}

func NewCreateCanvasNodesRequest() *CreateCanvasNodesRequest {
	return &CreateCanvasNodesRequest{}
}

func (p *CreateCanvasNodesRequest) InitDefault() {
}

var CreateCanvasNodesRequest_WorkspaceID_DEFAULT string

func (p *CreateCanvasNodesRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CreateCanvasNodesRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CreateCanvasNodesRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CreateCanvasNodesRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *CreateCanvasNodesRequest) GetPlot() (v string) {
	return p.Plot
}

var CreateCanvasNodesRequest_ModelConfig_DEFAULT *StoryboardModelConfig

func (p *CreateCanvasNodesRequest) GetModelConfig() (v *StoryboardModelConfig) {
	if !p.IsSetModelConfig() {
		return CreateCanvasNodesRequest_ModelConfig_DEFAULT
	}
	return p.ModelConfig
}

var CreateCanvasNodesRequest_PlanningConfig_DEFAULT *StoryboardPlanningConfig

func (p *CreateCanvasNodesRequest) GetPlanningConfig() (v *StoryboardPlanningConfig) {
	if !p.IsSetPlanningConfig() {
		return CreateCanvasNodesRequest_PlanningConfig_DEFAULT
	}
	return p.PlanningConfig
}

func (p *CreateCanvasNodesRequest) GetCanvasNodes() (v []*CanvasNodeDraft) {
	return p.CanvasNodes
}

func (p *CreateCanvasNodesRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CreateCanvasNodesRequest) IsSetModelConfig() bool {
	return p.ModelConfig != nil
}

func (p *CreateCanvasNodesRequest) IsSetPlanningConfig() bool {
	return p.PlanningConfig != nil
}

func (p *CreateCanvasNodesRequest) IsSetCanvasNodes() bool {
	return p.CanvasNodes != nil
}

func (p *CreateCanvasNodesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateCanvasNodesRequest(%+v)", *p)
}

// GetCanvasNodeDraftsRequest 按 TaskRunID 返回任务的最新持久化状态和完整草稿节点。
type GetCanvasNodeDraftsRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	TaskRunID   string  `json:"TaskRunID"`
}

func NewGetCanvasNodeDraftsRequest() *GetCanvasNodeDraftsRequest {
	return &GetCanvasNodeDraftsRequest{}
}

func (p *GetCanvasNodeDraftsRequest) InitDefault() {
}

var GetCanvasNodeDraftsRequest_WorkspaceID_DEFAULT string

func (p *GetCanvasNodeDraftsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return GetCanvasNodeDraftsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *GetCanvasNodeDraftsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *GetCanvasNodeDraftsRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *GetCanvasNodeDraftsRequest) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *GetCanvasNodeDraftsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *GetCanvasNodeDraftsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetCanvasNodeDraftsRequest(%+v)", *p)
}

// CreateCanvasNodesResponse 返回已持久化的批量分镜任务；后续状态和草稿节点通过统一画布轮询读取。
type CreateCanvasNodesResponse struct {
	CanvasNode *CanvasNodeDraft            `json:"CanvasNode,omitempty"`
	Completed  *CreateCanvasNodesCompleted `json:"Completed,omitempty"`
	Error      *CreateCanvasNodesError     `json:"Error,omitempty"`
	Session    *CanvasNodeDraftSession     `json:"Session,omitempty"`
}

func NewCreateCanvasNodesResponse() *CreateCanvasNodesResponse {
	return &CreateCanvasNodesResponse{}
}

func (p *CreateCanvasNodesResponse) InitDefault() {
}

var CreateCanvasNodesResponse_CanvasNode_DEFAULT *CanvasNodeDraft

func (p *CreateCanvasNodesResponse) GetCanvasNode() (v *CanvasNodeDraft) {
	if !p.IsSetCanvasNode() {
		return CreateCanvasNodesResponse_CanvasNode_DEFAULT
	}
	return p.CanvasNode
}

var CreateCanvasNodesResponse_Completed_DEFAULT *CreateCanvasNodesCompleted

func (p *CreateCanvasNodesResponse) GetCompleted() (v *CreateCanvasNodesCompleted) {
	if !p.IsSetCompleted() {
		return CreateCanvasNodesResponse_Completed_DEFAULT
	}
	return p.Completed
}

var CreateCanvasNodesResponse_Error_DEFAULT *CreateCanvasNodesError

func (p *CreateCanvasNodesResponse) GetError() (v *CreateCanvasNodesError) {
	if !p.IsSetError() {
		return CreateCanvasNodesResponse_Error_DEFAULT
	}
	return p.Error
}

var CreateCanvasNodesResponse_Session_DEFAULT *CanvasNodeDraftSession

func (p *CreateCanvasNodesResponse) GetSession() (v *CanvasNodeDraftSession) {
	if !p.IsSetSession() {
		return CreateCanvasNodesResponse_Session_DEFAULT
	}
	return p.Session
}

func (p *CreateCanvasNodesResponse) IsSetCanvasNode() bool {
	return p.CanvasNode != nil
}

func (p *CreateCanvasNodesResponse) IsSetCompleted() bool {
	return p.Completed != nil
}

func (p *CreateCanvasNodesResponse) IsSetError() bool {
	return p.Error != nil
}

func (p *CreateCanvasNodesResponse) IsSetSession() bool {
	return p.Session != nil
}

func (p *CreateCanvasNodesResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateCanvasNodesResponse(%+v)", *p)
}

// CanvasNodeDraftConfirmInput 只允许覆盖已持久化草稿的生成参数；Prompt 始终取自服务端草稿记录。
type CanvasNodeDraftConfirmInput struct {
	DraftID          string                      `json:"DraftID"`
	GenerationConfig *CanvasNodeGenerationConfig `json:"GenerationConfig"`
}

func NewCanvasNodeDraftConfirmInput() *CanvasNodeDraftConfirmInput {
	return &CanvasNodeDraftConfirmInput{}
}

func (p *CanvasNodeDraftConfirmInput) InitDefault() {
}

func (p *CanvasNodeDraftConfirmInput) GetDraftID() (v string) {
	return p.DraftID
}

var CanvasNodeDraftConfirmInput_GenerationConfig_DEFAULT *CanvasNodeGenerationConfig

func (p *CanvasNodeDraftConfirmInput) GetGenerationConfig() (v *CanvasNodeGenerationConfig) {
	if !p.IsSetGenerationConfig() {
		return CanvasNodeDraftConfirmInput_GenerationConfig_DEFAULT
	}
	return p.GenerationConfig
}

func (p *CanvasNodeDraftConfirmInput) IsSetGenerationConfig() bool {
	return p.GenerationConfig != nil
}

func (p *CanvasNodeDraftConfirmInput) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeDraftConfirmInput(%+v)", *p)
}

// ConfirmCanvasNodeDraftsRequest 将前端确认后的候选分镜原子持久化。
type ConfirmCanvasNodeDraftsRequest struct {
	WorkspaceID *string                        `json:"WorkspaceID,omitempty"`
	ProjectID   string                         `json:"ProjectID"`
	CanvasID    string                         `json:"CanvasID"`
	Items       []*CanvasNodeDraftConfirmInput `json:"Items"`
	TaskRunID   string                         `json:"TaskRunID"`
}

func NewConfirmCanvasNodeDraftsRequest() *ConfirmCanvasNodeDraftsRequest {
	return &ConfirmCanvasNodeDraftsRequest{}
}

func (p *ConfirmCanvasNodeDraftsRequest) InitDefault() {
}

var ConfirmCanvasNodeDraftsRequest_WorkspaceID_DEFAULT string

func (p *ConfirmCanvasNodeDraftsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return ConfirmCanvasNodeDraftsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *ConfirmCanvasNodeDraftsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *ConfirmCanvasNodeDraftsRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *ConfirmCanvasNodeDraftsRequest) GetItems() (v []*CanvasNodeDraftConfirmInput) {
	return p.Items
}

func (p *ConfirmCanvasNodeDraftsRequest) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *ConfirmCanvasNodeDraftsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *ConfirmCanvasNodeDraftsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ConfirmCanvasNodeDraftsRequest(%+v)", *p)
}

type ConfirmCanvasNodeDraftsResponse struct {
	// CanvasNodeIDs 只标识本次确认创建的正式分镜；完整图必须通过 GetCanvasGraph 读取。
	CanvasNodeIDs  []string `json:"CanvasNodeIDs"`
	CanvasRevision int64    `json:"CanvasRevision"`
}

func NewConfirmCanvasNodeDraftsResponse() *ConfirmCanvasNodeDraftsResponse {
	return &ConfirmCanvasNodeDraftsResponse{}
}

func (p *ConfirmCanvasNodeDraftsResponse) InitDefault() {
}

func (p *ConfirmCanvasNodeDraftsResponse) GetCanvasNodeIDs() (v []string) {
	return p.CanvasNodeIDs
}

func (p *ConfirmCanvasNodeDraftsResponse) GetCanvasRevision() (v int64) {
	return p.CanvasRevision
}

func (p *ConfirmCanvasNodeDraftsResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ConfirmCanvasNodeDraftsResponse(%+v)", *p)
}

// CancelCanvasNodeDraftsRequest 显式取消生成或放弃待确认草稿，并删除 Redis 会话。
type CancelCanvasNodeDraftsRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	TaskRunID   string  `json:"TaskRunID"`
}

func NewCancelCanvasNodeDraftsRequest() *CancelCanvasNodeDraftsRequest {
	return &CancelCanvasNodeDraftsRequest{}
}

func (p *CancelCanvasNodeDraftsRequest) InitDefault() {
}

var CancelCanvasNodeDraftsRequest_WorkspaceID_DEFAULT string

func (p *CancelCanvasNodeDraftsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CancelCanvasNodeDraftsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CancelCanvasNodeDraftsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CancelCanvasNodeDraftsRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *CancelCanvasNodeDraftsRequest) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *CancelCanvasNodeDraftsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CancelCanvasNodeDraftsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CancelCanvasNodeDraftsRequest(%+v)", *p)
}

// StartCanvasNodeGenerationRequest 启动画布图片或视频生成节点。
type StartCanvasNodeGenerationRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	NodeID      string  `json:"NodeID"`
}

func NewStartCanvasNodeGenerationRequest() *StartCanvasNodeGenerationRequest {
	return &StartCanvasNodeGenerationRequest{}
}

func (p *StartCanvasNodeGenerationRequest) InitDefault() {
}

var StartCanvasNodeGenerationRequest_WorkspaceID_DEFAULT string

func (p *StartCanvasNodeGenerationRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return StartCanvasNodeGenerationRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *StartCanvasNodeGenerationRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *StartCanvasNodeGenerationRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *StartCanvasNodeGenerationRequest) GetNodeID() (v string) {
	return p.NodeID
}

func (p *StartCanvasNodeGenerationRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *StartCanvasNodeGenerationRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StartCanvasNodeGenerationRequest(%+v)", *p)
}

type StartCanvasNodeGenerationResponse struct {
	TaskRunID string `json:"TaskRunID"`
}

func NewStartCanvasNodeGenerationResponse() *StartCanvasNodeGenerationResponse {
	return &StartCanvasNodeGenerationResponse{}
}

func (p *StartCanvasNodeGenerationResponse) InitDefault() {
}

func (p *StartCanvasNodeGenerationResponse) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *StartCanvasNodeGenerationResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StartCanvasNodeGenerationResponse(%+v)", *p)
}

// StartCanvasGenerationRequest 启动剧集内当前可生成的全部分镜。
type StartCanvasGenerationRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
}

func NewStartCanvasGenerationRequest() *StartCanvasGenerationRequest {
	return &StartCanvasGenerationRequest{}
}

func (p *StartCanvasGenerationRequest) InitDefault() {
}

var StartCanvasGenerationRequest_WorkspaceID_DEFAULT string

func (p *StartCanvasGenerationRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return StartCanvasGenerationRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *StartCanvasGenerationRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *StartCanvasGenerationRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *StartCanvasGenerationRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *StartCanvasGenerationRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StartCanvasGenerationRequest(%+v)", *p)
}

type CanvasNodeGenerationStart struct {
	NodeID    string `json:"NodeID"`
	TaskRunID string `json:"TaskRunID"`
}

func NewCanvasNodeGenerationStart() *CanvasNodeGenerationStart {
	return &CanvasNodeGenerationStart{}
}

func (p *CanvasNodeGenerationStart) InitDefault() {
}

func (p *CanvasNodeGenerationStart) GetNodeID() (v string) {
	return p.NodeID
}

func (p *CanvasNodeGenerationStart) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *CanvasNodeGenerationStart) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeGenerationStart(%+v)", *p)
}

type StartCanvasGenerationResponse struct {
	// Items 只包含成功启动或已经在运行的分镜；不满足生成条件的分镜由服务端跳过。
	Items        []*CanvasNodeGenerationStart `json:"Items"`
	SkippedCount int32                        `json:"SkippedCount"`
}

func NewStartCanvasGenerationResponse() *StartCanvasGenerationResponse {
	return &StartCanvasGenerationResponse{}
}

func (p *StartCanvasGenerationResponse) InitDefault() {
}

func (p *StartCanvasGenerationResponse) GetItems() (v []*CanvasNodeGenerationStart) {
	return p.Items
}

func (p *StartCanvasGenerationResponse) GetSkippedCount() (v int32) {
	return p.SkippedCount
}

func (p *StartCanvasGenerationResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StartCanvasGenerationResponse(%+v)", *p)
}

// CanvasNodeGenerationResourceAssetSnapshot 只记录某次生成实际解析到的 ResourceAsset 版本与 Asset，
// 不参与画布节点的后续读取和生成决策。
type CanvasNodeGenerationResourceAssetSnapshot struct {
	SourceNodeID          string `json:"SourceNodeID"`
	ResourceAssetID       string `json:"ResourceAssetID"`
	ResourceAssetRevision int64  `json:"ResourceAssetRevision"`
	AssetID               string `json:"AssetID"`
}

func NewCanvasNodeGenerationResourceAssetSnapshot() *CanvasNodeGenerationResourceAssetSnapshot {
	return &CanvasNodeGenerationResourceAssetSnapshot{}
}

func (p *CanvasNodeGenerationResourceAssetSnapshot) InitDefault() {
}

func (p *CanvasNodeGenerationResourceAssetSnapshot) GetSourceNodeID() (v string) {
	return p.SourceNodeID
}

func (p *CanvasNodeGenerationResourceAssetSnapshot) GetResourceAssetID() (v string) {
	return p.ResourceAssetID
}

func (p *CanvasNodeGenerationResourceAssetSnapshot) GetResourceAssetRevision() (v int64) {
	return p.ResourceAssetRevision
}

func (p *CanvasNodeGenerationResourceAssetSnapshot) GetAssetID() (v string) {
	return p.AssetID
}

func (p *CanvasNodeGenerationResourceAssetSnapshot) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeGenerationResourceAssetSnapshot(%+v)", *p)
}

// CanvasNodeHistory 是一次文本、图片或视频生成的持久化历史。
type CanvasNodeHistory struct {
	// HistoryID 与对应生成操作的 TaskRunID 相同。
	HistoryID       string                 `json:"HistoryID"`
	Status          CanvasGenerationStatus `json:"Status"`
	ModelServiceID  string                 `json:"ModelServiceID"`
	Resolution      *CanvasNodeResolution  `json:"Resolution,omitempty"`
	AspectRatio     *CanvasNodeAspectRatio `json:"AspectRatio,omitempty"`
	DurationSeconds *int32                 `json:"DurationSeconds,omitempty"`
	GenerateAudio   *bool                  `json:"GenerateAudio,omitempty"`
	Watermark       *bool                  `json:"Watermark,omitempty"`
	// Prompt 是实际提交给模型的提示词快照。
	Prompt string `json:"Prompt"`
	// VideoURL 是成功结果的临时签名地址，不持久化。
	VideoURL     *string           `json:"VideoURL,omitempty"`
	ErrorMessage *string           `json:"ErrorMessage,omitempty"`
	CompletedAt  *common.Timestamp `json:"CompletedAt,omitempty"`
	CreatedAt    common.Timestamp  `json:"CreatedAt"`
	// ProviderStatus 是该历史最近一次持久化的 provider 状态。
	ProviderStatus         CanvasNodeVideoProviderStatus                `json:"ProviderStatus"`
	FirstFrameAssetID      *string                                      `json:"FirstFrameAssetID,omitempty"`
	LastFrameAssetID       *string                                      `json:"LastFrameAssetID,omitempty"`
	FirstFrameURL          *string                                      `json:"FirstFrameURL,omitempty"`
	LastFrameURL           *string                                      `json:"LastFrameURL,omitempty"`
	ResourceAssetSnapshots []*CanvasNodeGenerationResourceAssetSnapshot `json:"ResourceAssetSnapshots"`
	Type                   CanvasNodeType                               `json:"Type"`
	OutputAssetID          *string                                      `json:"OutputAssetID,omitempty"`
	OutputURL              *string                                      `json:"OutputURL,omitempty"`
	OutputText             *string                                      `json:"OutputText,omitempty"`
	// ErrorCode 保留 provider 返回的原始错误码，不做服务端 i18n。
	ErrorCode *string `json:"ErrorCode,omitempty"`
	// SeedanceTaskID 仅在 Seedance 失败终态返回，供火山侧问题复现与豁免操作使用。
	SeedanceTaskID *string `json:"SeedanceTaskID,omitempty"`
}

func NewCanvasNodeHistory() *CanvasNodeHistory {
	return &CanvasNodeHistory{}
}

func (p *CanvasNodeHistory) InitDefault() {
}

func (p *CanvasNodeHistory) GetHistoryID() (v string) {
	return p.HistoryID
}

func (p *CanvasNodeHistory) GetStatus() (v CanvasGenerationStatus) {
	return p.Status
}

func (p *CanvasNodeHistory) GetModelServiceID() (v string) {
	return p.ModelServiceID
}

var CanvasNodeHistory_Resolution_DEFAULT CanvasNodeResolution

func (p *CanvasNodeHistory) GetResolution() (v CanvasNodeResolution) {
	if !p.IsSetResolution() {
		return CanvasNodeHistory_Resolution_DEFAULT
	}
	return *p.Resolution
}

var CanvasNodeHistory_AspectRatio_DEFAULT CanvasNodeAspectRatio

func (p *CanvasNodeHistory) GetAspectRatio() (v CanvasNodeAspectRatio) {
	if !p.IsSetAspectRatio() {
		return CanvasNodeHistory_AspectRatio_DEFAULT
	}
	return *p.AspectRatio
}

var CanvasNodeHistory_DurationSeconds_DEFAULT int32

func (p *CanvasNodeHistory) GetDurationSeconds() (v int32) {
	if !p.IsSetDurationSeconds() {
		return CanvasNodeHistory_DurationSeconds_DEFAULT
	}
	return *p.DurationSeconds
}

var CanvasNodeHistory_GenerateAudio_DEFAULT bool

func (p *CanvasNodeHistory) GetGenerateAudio() (v bool) {
	if !p.IsSetGenerateAudio() {
		return CanvasNodeHistory_GenerateAudio_DEFAULT
	}
	return *p.GenerateAudio
}

var CanvasNodeHistory_Watermark_DEFAULT bool

func (p *CanvasNodeHistory) GetWatermark() (v bool) {
	if !p.IsSetWatermark() {
		return CanvasNodeHistory_Watermark_DEFAULT
	}
	return *p.Watermark
}

func (p *CanvasNodeHistory) GetPrompt() (v string) {
	return p.Prompt
}

var CanvasNodeHistory_VideoURL_DEFAULT string

func (p *CanvasNodeHistory) GetVideoURL() (v string) {
	if !p.IsSetVideoURL() {
		return CanvasNodeHistory_VideoURL_DEFAULT
	}
	return *p.VideoURL
}

var CanvasNodeHistory_ErrorMessage_DEFAULT string

func (p *CanvasNodeHistory) GetErrorMessage() (v string) {
	if !p.IsSetErrorMessage() {
		return CanvasNodeHistory_ErrorMessage_DEFAULT
	}
	return *p.ErrorMessage
}

var CanvasNodeHistory_CompletedAt_DEFAULT common.Timestamp

func (p *CanvasNodeHistory) GetCompletedAt() (v common.Timestamp) {
	if !p.IsSetCompletedAt() {
		return CanvasNodeHistory_CompletedAt_DEFAULT
	}
	return *p.CompletedAt
}

func (p *CanvasNodeHistory) GetCreatedAt() (v common.Timestamp) {
	return p.CreatedAt
}

func (p *CanvasNodeHistory) GetProviderStatus() (v CanvasNodeVideoProviderStatus) {
	return p.ProviderStatus
}

var CanvasNodeHistory_FirstFrameAssetID_DEFAULT string

func (p *CanvasNodeHistory) GetFirstFrameAssetID() (v string) {
	if !p.IsSetFirstFrameAssetID() {
		return CanvasNodeHistory_FirstFrameAssetID_DEFAULT
	}
	return *p.FirstFrameAssetID
}

var CanvasNodeHistory_LastFrameAssetID_DEFAULT string

func (p *CanvasNodeHistory) GetLastFrameAssetID() (v string) {
	if !p.IsSetLastFrameAssetID() {
		return CanvasNodeHistory_LastFrameAssetID_DEFAULT
	}
	return *p.LastFrameAssetID
}

var CanvasNodeHistory_FirstFrameURL_DEFAULT string

func (p *CanvasNodeHistory) GetFirstFrameURL() (v string) {
	if !p.IsSetFirstFrameURL() {
		return CanvasNodeHistory_FirstFrameURL_DEFAULT
	}
	return *p.FirstFrameURL
}

var CanvasNodeHistory_LastFrameURL_DEFAULT string

func (p *CanvasNodeHistory) GetLastFrameURL() (v string) {
	if !p.IsSetLastFrameURL() {
		return CanvasNodeHistory_LastFrameURL_DEFAULT
	}
	return *p.LastFrameURL
}

func (p *CanvasNodeHistory) GetResourceAssetSnapshots() (v []*CanvasNodeGenerationResourceAssetSnapshot) {
	return p.ResourceAssetSnapshots
}

func (p *CanvasNodeHistory) GetType() (v CanvasNodeType) {
	return p.Type
}

var CanvasNodeHistory_OutputAssetID_DEFAULT string

func (p *CanvasNodeHistory) GetOutputAssetID() (v string) {
	if !p.IsSetOutputAssetID() {
		return CanvasNodeHistory_OutputAssetID_DEFAULT
	}
	return *p.OutputAssetID
}

var CanvasNodeHistory_OutputURL_DEFAULT string

func (p *CanvasNodeHistory) GetOutputURL() (v string) {
	if !p.IsSetOutputURL() {
		return CanvasNodeHistory_OutputURL_DEFAULT
	}
	return *p.OutputURL
}

var CanvasNodeHistory_OutputText_DEFAULT string

func (p *CanvasNodeHistory) GetOutputText() (v string) {
	if !p.IsSetOutputText() {
		return CanvasNodeHistory_OutputText_DEFAULT
	}
	return *p.OutputText
}

var CanvasNodeHistory_ErrorCode_DEFAULT string

func (p *CanvasNodeHistory) GetErrorCode() (v string) {
	if !p.IsSetErrorCode() {
		return CanvasNodeHistory_ErrorCode_DEFAULT
	}
	return *p.ErrorCode
}

var CanvasNodeHistory_SeedanceTaskID_DEFAULT string

func (p *CanvasNodeHistory) GetSeedanceTaskID() (v string) {
	if !p.IsSetSeedanceTaskID() {
		return CanvasNodeHistory_SeedanceTaskID_DEFAULT
	}
	return *p.SeedanceTaskID
}

func (p *CanvasNodeHistory) IsSetResolution() bool {
	return p.Resolution != nil
}

func (p *CanvasNodeHistory) IsSetAspectRatio() bool {
	return p.AspectRatio != nil
}

func (p *CanvasNodeHistory) IsSetDurationSeconds() bool {
	return p.DurationSeconds != nil
}

func (p *CanvasNodeHistory) IsSetGenerateAudio() bool {
	return p.GenerateAudio != nil
}

func (p *CanvasNodeHistory) IsSetWatermark() bool {
	return p.Watermark != nil
}

func (p *CanvasNodeHistory) IsSetVideoURL() bool {
	return p.VideoURL != nil
}

func (p *CanvasNodeHistory) IsSetErrorMessage() bool {
	return p.ErrorMessage != nil
}

func (p *CanvasNodeHistory) IsSetCompletedAt() bool {
	return p.CompletedAt != nil
}

func (p *CanvasNodeHistory) IsSetFirstFrameAssetID() bool {
	return p.FirstFrameAssetID != nil
}

func (p *CanvasNodeHistory) IsSetLastFrameAssetID() bool {
	return p.LastFrameAssetID != nil
}

func (p *CanvasNodeHistory) IsSetFirstFrameURL() bool {
	return p.FirstFrameURL != nil
}

func (p *CanvasNodeHistory) IsSetLastFrameURL() bool {
	return p.LastFrameURL != nil
}

func (p *CanvasNodeHistory) IsSetOutputAssetID() bool {
	return p.OutputAssetID != nil
}

func (p *CanvasNodeHistory) IsSetOutputURL() bool {
	return p.OutputURL != nil
}

func (p *CanvasNodeHistory) IsSetOutputText() bool {
	return p.OutputText != nil
}

func (p *CanvasNodeHistory) IsSetErrorCode() bool {
	return p.ErrorCode != nil
}

func (p *CanvasNodeHistory) IsSetSeedanceTaskID() bool {
	return p.SeedanceTaskID != nil
}

func (p *CanvasNodeHistory) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeHistory(%+v)", *p)
}

type ListCanvasNodeHistoriesRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	NodeID      string  `json:"NodeID"`
}

func NewListCanvasNodeHistoriesRequest() *ListCanvasNodeHistoriesRequest {
	return &ListCanvasNodeHistoriesRequest{}
}

func (p *ListCanvasNodeHistoriesRequest) InitDefault() {
}

var ListCanvasNodeHistoriesRequest_WorkspaceID_DEFAULT string

func (p *ListCanvasNodeHistoriesRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return ListCanvasNodeHistoriesRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *ListCanvasNodeHistoriesRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *ListCanvasNodeHistoriesRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *ListCanvasNodeHistoriesRequest) GetNodeID() (v string) {
	return p.NodeID
}

func (p *ListCanvasNodeHistoriesRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *ListCanvasNodeHistoriesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListCanvasNodeHistoriesRequest(%+v)", *p)
}

type ListCanvasNodeHistoriesResponse struct {
	Items []*CanvasNodeHistory `json:"Items"`
}

func NewListCanvasNodeHistoriesResponse() *ListCanvasNodeHistoriesResponse {
	return &ListCanvasNodeHistoriesResponse{}
}

func (p *ListCanvasNodeHistoriesResponse) InitDefault() {
}

func (p *ListCanvasNodeHistoriesResponse) GetItems() (v []*CanvasNodeHistory) {
	return p.Items
}

func (p *ListCanvasNodeHistoriesResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListCanvasNodeHistoriesResponse(%+v)", *p)
}

type SelectCanvasNodeHistoryRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	NodeID      string  `json:"NodeID"`
	HistoryID   string  `json:"HistoryID"`
}

func NewSelectCanvasNodeHistoryRequest() *SelectCanvasNodeHistoryRequest {
	return &SelectCanvasNodeHistoryRequest{}
}

func (p *SelectCanvasNodeHistoryRequest) InitDefault() {
}

var SelectCanvasNodeHistoryRequest_WorkspaceID_DEFAULT string

func (p *SelectCanvasNodeHistoryRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return SelectCanvasNodeHistoryRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *SelectCanvasNodeHistoryRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *SelectCanvasNodeHistoryRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *SelectCanvasNodeHistoryRequest) GetNodeID() (v string) {
	return p.NodeID
}

func (p *SelectCanvasNodeHistoryRequest) GetHistoryID() (v string) {
	return p.HistoryID
}

func (p *SelectCanvasNodeHistoryRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *SelectCanvasNodeHistoryRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("SelectCanvasNodeHistoryRequest(%+v)", *p)
}

type SelectCanvasNodeHistoryResponse struct {
	History *CanvasNodeHistory `json:"History"`
}

func NewSelectCanvasNodeHistoryResponse() *SelectCanvasNodeHistoryResponse {
	return &SelectCanvasNodeHistoryResponse{}
}

func (p *SelectCanvasNodeHistoryResponse) InitDefault() {
}

var SelectCanvasNodeHistoryResponse_History_DEFAULT *CanvasNodeHistory

func (p *SelectCanvasNodeHistoryResponse) GetHistory() (v *CanvasNodeHistory) {
	if !p.IsSetHistory() {
		return SelectCanvasNodeHistoryResponse_History_DEFAULT
	}
	return p.History
}

func (p *SelectCanvasNodeHistoryResponse) IsSetHistory() bool {
	return p.History != nil
}

func (p *SelectCanvasNodeHistoryResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("SelectCanvasNodeHistoryResponse(%+v)", *p)
}

type CancelCanvasNodeGenerationRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	NodeID      string  `json:"NodeID"`
	TaskRunID   string  `json:"TaskRunID"`
}

func NewCancelCanvasNodeGenerationRequest() *CancelCanvasNodeGenerationRequest {
	return &CancelCanvasNodeGenerationRequest{}
}

func (p *CancelCanvasNodeGenerationRequest) InitDefault() {
}

var CancelCanvasNodeGenerationRequest_WorkspaceID_DEFAULT string

func (p *CancelCanvasNodeGenerationRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CancelCanvasNodeGenerationRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CancelCanvasNodeGenerationRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CancelCanvasNodeGenerationRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *CancelCanvasNodeGenerationRequest) GetNodeID() (v string) {
	return p.NodeID
}

func (p *CancelCanvasNodeGenerationRequest) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *CancelCanvasNodeGenerationRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CancelCanvasNodeGenerationRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CancelCanvasNodeGenerationRequest(%+v)", *p)
}

type CanvasTextGenerationSession struct {
	TaskRunID    string                 `json:"TaskRunID"`
	NodeID       string                 `json:"NodeID"`
	Status       CanvasGenerationStatus `json:"Status"`
	Content      string                 `json:"Content"`
	ErrorCode    *string                `json:"ErrorCode,omitempty"`
	ErrorMessage *string                `json:"ErrorMessage,omitempty"`
}

func NewCanvasTextGenerationSession() *CanvasTextGenerationSession {
	return &CanvasTextGenerationSession{}
}

func (p *CanvasTextGenerationSession) InitDefault() {
}

func (p *CanvasTextGenerationSession) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *CanvasTextGenerationSession) GetNodeID() (v string) {
	return p.NodeID
}

func (p *CanvasTextGenerationSession) GetStatus() (v CanvasGenerationStatus) {
	return p.Status
}

func (p *CanvasTextGenerationSession) GetContent() (v string) {
	return p.Content
}

var CanvasTextGenerationSession_ErrorCode_DEFAULT string

func (p *CanvasTextGenerationSession) GetErrorCode() (v string) {
	if !p.IsSetErrorCode() {
		return CanvasTextGenerationSession_ErrorCode_DEFAULT
	}
	return *p.ErrorCode
}

var CanvasTextGenerationSession_ErrorMessage_DEFAULT string

func (p *CanvasTextGenerationSession) GetErrorMessage() (v string) {
	if !p.IsSetErrorMessage() {
		return CanvasTextGenerationSession_ErrorMessage_DEFAULT
	}
	return *p.ErrorMessage
}

func (p *CanvasTextGenerationSession) IsSetErrorCode() bool {
	return p.ErrorCode != nil
}

func (p *CanvasTextGenerationSession) IsSetErrorMessage() bool {
	return p.ErrorMessage != nil
}

func (p *CanvasTextGenerationSession) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasTextGenerationSession(%+v)", *p)
}

type CanvasTextGenerationDelta struct {
	Delta  string `json:"Delta"`
	Offset int64  `json:"Offset"`
}

func NewCanvasTextGenerationDelta() *CanvasTextGenerationDelta {
	return &CanvasTextGenerationDelta{}
}

func (p *CanvasTextGenerationDelta) InitDefault() {
}

func (p *CanvasTextGenerationDelta) GetDelta() (v string) {
	return p.Delta
}

func (p *CanvasTextGenerationDelta) GetOffset() (v int64) {
	return p.Offset
}

func (p *CanvasTextGenerationDelta) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasTextGenerationDelta(%+v)", *p)
}

type CanvasTextGenerationCompleted struct {
	TaskRunID string `json:"TaskRunID"`
	Content   string `json:"Content"`
}

func NewCanvasTextGenerationCompleted() *CanvasTextGenerationCompleted {
	return &CanvasTextGenerationCompleted{}
}

func (p *CanvasTextGenerationCompleted) InitDefault() {
}

func (p *CanvasTextGenerationCompleted) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *CanvasTextGenerationCompleted) GetContent() (v string) {
	return p.Content
}

func (p *CanvasTextGenerationCompleted) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasTextGenerationCompleted(%+v)", *p)
}

type StartCanvasNodeTextGenerationRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	NodeID      string  `json:"NodeID"`
}

func NewStartCanvasNodeTextGenerationRequest() *StartCanvasNodeTextGenerationRequest {
	return &StartCanvasNodeTextGenerationRequest{}
}

func (p *StartCanvasNodeTextGenerationRequest) InitDefault() {
}

var StartCanvasNodeTextGenerationRequest_WorkspaceID_DEFAULT string

func (p *StartCanvasNodeTextGenerationRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return StartCanvasNodeTextGenerationRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *StartCanvasNodeTextGenerationRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *StartCanvasNodeTextGenerationRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *StartCanvasNodeTextGenerationRequest) GetNodeID() (v string) {
	return p.NodeID
}

func (p *StartCanvasNodeTextGenerationRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *StartCanvasNodeTextGenerationRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StartCanvasNodeTextGenerationRequest(%+v)", *p)
}

type CancelCanvasNodeTextGenerationRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	NodeID      string  `json:"NodeID"`
	TaskRunID   string  `json:"TaskRunID"`
}

func NewCancelCanvasNodeTextGenerationRequest() *CancelCanvasNodeTextGenerationRequest {
	return &CancelCanvasNodeTextGenerationRequest{}
}

func (p *CancelCanvasNodeTextGenerationRequest) InitDefault() {
}

var CancelCanvasNodeTextGenerationRequest_WorkspaceID_DEFAULT string

func (p *CancelCanvasNodeTextGenerationRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CancelCanvasNodeTextGenerationRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CancelCanvasNodeTextGenerationRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CancelCanvasNodeTextGenerationRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *CancelCanvasNodeTextGenerationRequest) GetNodeID() (v string) {
	return p.NodeID
}

func (p *CancelCanvasNodeTextGenerationRequest) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *CancelCanvasNodeTextGenerationRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CancelCanvasNodeTextGenerationRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CancelCanvasNodeTextGenerationRequest(%+v)", *p)
}

type CanvasNodeTextGenerationResponse struct {
	Session   *CanvasTextGenerationSession   `json:"Session,omitempty"`
	Delta     *CanvasTextGenerationDelta     `json:"Delta,omitempty"`
	Completed *CanvasTextGenerationCompleted `json:"Completed,omitempty"`
}

func NewCanvasNodeTextGenerationResponse() *CanvasNodeTextGenerationResponse {
	return &CanvasNodeTextGenerationResponse{}
}

func (p *CanvasNodeTextGenerationResponse) InitDefault() {
}

var CanvasNodeTextGenerationResponse_Session_DEFAULT *CanvasTextGenerationSession

func (p *CanvasNodeTextGenerationResponse) GetSession() (v *CanvasTextGenerationSession) {
	if !p.IsSetSession() {
		return CanvasNodeTextGenerationResponse_Session_DEFAULT
	}
	return p.Session
}

var CanvasNodeTextGenerationResponse_Delta_DEFAULT *CanvasTextGenerationDelta

func (p *CanvasNodeTextGenerationResponse) GetDelta() (v *CanvasTextGenerationDelta) {
	if !p.IsSetDelta() {
		return CanvasNodeTextGenerationResponse_Delta_DEFAULT
	}
	return p.Delta
}

var CanvasNodeTextGenerationResponse_Completed_DEFAULT *CanvasTextGenerationCompleted

func (p *CanvasNodeTextGenerationResponse) GetCompleted() (v *CanvasTextGenerationCompleted) {
	if !p.IsSetCompleted() {
		return CanvasNodeTextGenerationResponse_Completed_DEFAULT
	}
	return p.Completed
}

func (p *CanvasNodeTextGenerationResponse) IsSetSession() bool {
	return p.Session != nil
}

func (p *CanvasNodeTextGenerationResponse) IsSetDelta() bool {
	return p.Delta != nil
}

func (p *CanvasNodeTextGenerationResponse) IsSetCompleted() bool {
	return p.Completed != nil
}

func (p *CanvasNodeTextGenerationResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeTextGenerationResponse(%+v)", *p)
}

// UpdateCanvasNodeRequest 是按需更新剧集分镜内容的请求。
type UpdateCanvasNodeRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是所属项目标识。
	ProjectID string `json:"ProjectID"`
	// CanvasID 是所属剧集标识。
	CanvasID string `json:"CanvasID"`
	// NodeID 是待更新的分镜标识。
	NodeID string `json:"NodeID"`
	// Prompt 更新提示词；未传时保持原值，空字符串表示清空提示词。
	Prompt *string `json:"Prompt,omitempty"`
	// GenerationConfig 按字段更新生成配置；未传字段保持原值。
	GenerationConfig *CanvasNodeGenerationConfigPatch `json:"GenerationConfig,omitempty"`
	Name             *string                          `json:"Name,omitempty"`
	Text             *string                          `json:"Text,omitempty"`
	Position         *CanvasNodePosition              `json:"Position,omitempty"`
	VideoInputMode   *CanvasVideoInputMode            `json:"VideoInputMode,omitempty"`
}

func NewUpdateCanvasNodeRequest() *UpdateCanvasNodeRequest {
	return &UpdateCanvasNodeRequest{}
}

func (p *UpdateCanvasNodeRequest) InitDefault() {
}

var UpdateCanvasNodeRequest_WorkspaceID_DEFAULT string

func (p *UpdateCanvasNodeRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return UpdateCanvasNodeRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *UpdateCanvasNodeRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *UpdateCanvasNodeRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *UpdateCanvasNodeRequest) GetNodeID() (v string) {
	return p.NodeID
}

var UpdateCanvasNodeRequest_Prompt_DEFAULT string

func (p *UpdateCanvasNodeRequest) GetPrompt() (v string) {
	if !p.IsSetPrompt() {
		return UpdateCanvasNodeRequest_Prompt_DEFAULT
	}
	return *p.Prompt
}

var UpdateCanvasNodeRequest_GenerationConfig_DEFAULT *CanvasNodeGenerationConfigPatch

func (p *UpdateCanvasNodeRequest) GetGenerationConfig() (v *CanvasNodeGenerationConfigPatch) {
	if !p.IsSetGenerationConfig() {
		return UpdateCanvasNodeRequest_GenerationConfig_DEFAULT
	}
	return p.GenerationConfig
}

var UpdateCanvasNodeRequest_Name_DEFAULT string

func (p *UpdateCanvasNodeRequest) GetName() (v string) {
	if !p.IsSetName() {
		return UpdateCanvasNodeRequest_Name_DEFAULT
	}
	return *p.Name
}

var UpdateCanvasNodeRequest_Text_DEFAULT string

func (p *UpdateCanvasNodeRequest) GetText() (v string) {
	if !p.IsSetText() {
		return UpdateCanvasNodeRequest_Text_DEFAULT
	}
	return *p.Text
}

var UpdateCanvasNodeRequest_Position_DEFAULT *CanvasNodePosition

func (p *UpdateCanvasNodeRequest) GetPosition() (v *CanvasNodePosition) {
	if !p.IsSetPosition() {
		return UpdateCanvasNodeRequest_Position_DEFAULT
	}
	return p.Position
}

var UpdateCanvasNodeRequest_VideoInputMode_DEFAULT CanvasVideoInputMode

func (p *UpdateCanvasNodeRequest) GetVideoInputMode() (v CanvasVideoInputMode) {
	if !p.IsSetVideoInputMode() {
		return UpdateCanvasNodeRequest_VideoInputMode_DEFAULT
	}
	return *p.VideoInputMode
}

func (p *UpdateCanvasNodeRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *UpdateCanvasNodeRequest) IsSetPrompt() bool {
	return p.Prompt != nil
}

func (p *UpdateCanvasNodeRequest) IsSetGenerationConfig() bool {
	return p.GenerationConfig != nil
}

func (p *UpdateCanvasNodeRequest) IsSetName() bool {
	return p.Name != nil
}

func (p *UpdateCanvasNodeRequest) IsSetText() bool {
	return p.Text != nil
}

func (p *UpdateCanvasNodeRequest) IsSetPosition() bool {
	return p.Position != nil
}

func (p *UpdateCanvasNodeRequest) IsSetVideoInputMode() bool {
	return p.VideoInputMode != nil
}

func (p *UpdateCanvasNodeRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateCanvasNodeRequest(%+v)", *p)
}

// UpdateCanvasNodeResponse 是更新剧集分镜内容的响应。
type UpdateCanvasNodeResponse struct {
	// CanvasNode 是更新后的分镜。
	CanvasNode *CanvasNode `json:"CanvasNode"`
}

func NewUpdateCanvasNodeResponse() *UpdateCanvasNodeResponse {
	return &UpdateCanvasNodeResponse{}
}

func (p *UpdateCanvasNodeResponse) InitDefault() {
}

var UpdateCanvasNodeResponse_CanvasNode_DEFAULT *CanvasNode

func (p *UpdateCanvasNodeResponse) GetCanvasNode() (v *CanvasNode) {
	if !p.IsSetCanvasNode() {
		return UpdateCanvasNodeResponse_CanvasNode_DEFAULT
	}
	return p.CanvasNode
}

func (p *UpdateCanvasNodeResponse) IsSetCanvasNode() bool {
	return p.CanvasNode != nil
}

func (p *UpdateCanvasNodeResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateCanvasNodeResponse(%+v)", *p)
}

type CanvasNodePositionUpdate struct {
	NodeID   string              `json:"NodeID"`
	Position *CanvasNodePosition `json:"Position"`
}

func NewCanvasNodePositionUpdate() *CanvasNodePositionUpdate {
	return &CanvasNodePositionUpdate{}
}

func (p *CanvasNodePositionUpdate) InitDefault() {
}

func (p *CanvasNodePositionUpdate) GetNodeID() (v string) {
	return p.NodeID
}

var CanvasNodePositionUpdate_Position_DEFAULT *CanvasNodePosition

func (p *CanvasNodePositionUpdate) GetPosition() (v *CanvasNodePosition) {
	if !p.IsSetPosition() {
		return CanvasNodePositionUpdate_Position_DEFAULT
	}
	return p.Position
}

func (p *CanvasNodePositionUpdate) IsSetPosition() bool {
	return p.Position != nil
}

func (p *CanvasNodePositionUpdate) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodePositionUpdate(%+v)", *p)
}

// BatchUpdateCanvasNodePositions 原子保存一次前端布局结果。
type BatchUpdateCanvasNodePositionsRequest struct {
	WorkspaceID *string                     `json:"WorkspaceID,omitempty"`
	ProjectID   string                      `json:"ProjectID"`
	CanvasID    string                      `json:"CanvasID"`
	Items       []*CanvasNodePositionUpdate `json:"Items"`
}

func NewBatchUpdateCanvasNodePositionsRequest() *BatchUpdateCanvasNodePositionsRequest {
	return &BatchUpdateCanvasNodePositionsRequest{}
}

func (p *BatchUpdateCanvasNodePositionsRequest) InitDefault() {
}

var BatchUpdateCanvasNodePositionsRequest_WorkspaceID_DEFAULT string

func (p *BatchUpdateCanvasNodePositionsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchUpdateCanvasNodePositionsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchUpdateCanvasNodePositionsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *BatchUpdateCanvasNodePositionsRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *BatchUpdateCanvasNodePositionsRequest) GetItems() (v []*CanvasNodePositionUpdate) {
	return p.Items
}

func (p *BatchUpdateCanvasNodePositionsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchUpdateCanvasNodePositionsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchUpdateCanvasNodePositionsRequest(%+v)", *p)
}

type BatchUpdateCanvasNodePositionsResponse struct {
	Items []*CanvasNode `json:"Items"`
}

func NewBatchUpdateCanvasNodePositionsResponse() *BatchUpdateCanvasNodePositionsResponse {
	return &BatchUpdateCanvasNodePositionsResponse{}
}

func (p *BatchUpdateCanvasNodePositionsResponse) InitDefault() {
}

func (p *BatchUpdateCanvasNodePositionsResponse) GetItems() (v []*CanvasNode) {
	return p.Items
}

func (p *BatchUpdateCanvasNodePositionsResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchUpdateCanvasNodePositionsResponse(%+v)", *p)
}

// DeleteCanvasNodeRequest 删除节点并原子移除全部入边和出边。
type DeleteCanvasNodeRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是所属项目标识。
	ProjectID string `json:"ProjectID"`
	// CanvasID 是所属剧集标识。
	CanvasID string `json:"CanvasID"`
	// NodeID 是待删除的分镜标识。
	NodeID string `json:"NodeID"`
}

func NewDeleteCanvasNodeRequest() *DeleteCanvasNodeRequest {
	return &DeleteCanvasNodeRequest{}
}

func (p *DeleteCanvasNodeRequest) InitDefault() {
}

var DeleteCanvasNodeRequest_WorkspaceID_DEFAULT string

func (p *DeleteCanvasNodeRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return DeleteCanvasNodeRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *DeleteCanvasNodeRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *DeleteCanvasNodeRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *DeleteCanvasNodeRequest) GetNodeID() (v string) {
	return p.NodeID
}

func (p *DeleteCanvasNodeRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *DeleteCanvasNodeRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DeleteCanvasNodeRequest(%+v)", *p)
}

type DeleteCanvasNodeResponse struct {
	CanvasRevision int64 `json:"CanvasRevision"`
}

func NewDeleteCanvasNodeResponse() *DeleteCanvasNodeResponse {
	return &DeleteCanvasNodeResponse{}
}

func (p *DeleteCanvasNodeResponse) InitDefault() {
}

func (p *DeleteCanvasNodeResponse) GetCanvasRevision() (v int64) {
	return p.CanvasRevision
}

func (p *DeleteCanvasNodeResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DeleteCanvasNodeResponse(%+v)", *p)
}

// BatchDeleteCanvasNodesRequest 原子删除同一画布中的多个节点及其全部入边和出边。
type BatchDeleteCanvasNodesRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	// NodeIDs 最多包含 100 个互不重复的节点标识。
	NodeIDs []string `json:"NodeIDs"`
}

func NewBatchDeleteCanvasNodesRequest() *BatchDeleteCanvasNodesRequest {
	return &BatchDeleteCanvasNodesRequest{}
}

func (p *BatchDeleteCanvasNodesRequest) InitDefault() {
}

var BatchDeleteCanvasNodesRequest_WorkspaceID_DEFAULT string

func (p *BatchDeleteCanvasNodesRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchDeleteCanvasNodesRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchDeleteCanvasNodesRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *BatchDeleteCanvasNodesRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *BatchDeleteCanvasNodesRequest) GetNodeIDs() (v []string) {
	return p.NodeIDs
}

func (p *BatchDeleteCanvasNodesRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchDeleteCanvasNodesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchDeleteCanvasNodesRequest(%+v)", *p)
}

type BatchDeleteCanvasNodesResponse struct {
	CanvasRevision int64 `json:"CanvasRevision"`
}

func NewBatchDeleteCanvasNodesResponse() *BatchDeleteCanvasNodesResponse {
	return &BatchDeleteCanvasNodesResponse{}
}

func (p *BatchDeleteCanvasNodesResponse) InitDefault() {
}

func (p *BatchDeleteCanvasNodesResponse) GetCanvasRevision() (v int64) {
	return p.CanvasRevision
}

func (p *BatchDeleteCanvasNodesResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchDeleteCanvasNodesResponse(%+v)", *p)
}

type ConnectCanvasNodesRequest struct {
	WorkspaceID  *string    `json:"WorkspaceID,omitempty"`
	ProjectID    string     `json:"ProjectID"`
	CanvasID     string     `json:"CanvasID"`
	SourceNodeID string     `json:"SourceNodeID"`
	TargetNodeID string     `json:"TargetNodeID"`
	TargetPort   CanvasPort `json:"TargetPort"`
	TargetOrder  *int32     `json:"TargetOrder,omitempty"`
}

func NewConnectCanvasNodesRequest() *ConnectCanvasNodesRequest {
	return &ConnectCanvasNodesRequest{}
}

func (p *ConnectCanvasNodesRequest) InitDefault() {
}

var ConnectCanvasNodesRequest_WorkspaceID_DEFAULT string

func (p *ConnectCanvasNodesRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return ConnectCanvasNodesRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *ConnectCanvasNodesRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *ConnectCanvasNodesRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *ConnectCanvasNodesRequest) GetSourceNodeID() (v string) {
	return p.SourceNodeID
}

func (p *ConnectCanvasNodesRequest) GetTargetNodeID() (v string) {
	return p.TargetNodeID
}

func (p *ConnectCanvasNodesRequest) GetTargetPort() (v CanvasPort) {
	return p.TargetPort
}

var ConnectCanvasNodesRequest_TargetOrder_DEFAULT int32

func (p *ConnectCanvasNodesRequest) GetTargetOrder() (v int32) {
	if !p.IsSetTargetOrder() {
		return ConnectCanvasNodesRequest_TargetOrder_DEFAULT
	}
	return *p.TargetOrder
}

func (p *ConnectCanvasNodesRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *ConnectCanvasNodesRequest) IsSetTargetOrder() bool {
	return p.TargetOrder != nil
}

func (p *ConnectCanvasNodesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ConnectCanvasNodesRequest(%+v)", *p)
}

type ConnectCanvasNodesResponse struct {
	TargetNode     *CanvasNode `json:"TargetNode"`
	CanvasRevision int64       `json:"CanvasRevision"`
}

func NewConnectCanvasNodesResponse() *ConnectCanvasNodesResponse {
	return &ConnectCanvasNodesResponse{}
}

func (p *ConnectCanvasNodesResponse) InitDefault() {
}

var ConnectCanvasNodesResponse_TargetNode_DEFAULT *CanvasNode

func (p *ConnectCanvasNodesResponse) GetTargetNode() (v *CanvasNode) {
	if !p.IsSetTargetNode() {
		return ConnectCanvasNodesResponse_TargetNode_DEFAULT
	}
	return p.TargetNode
}

func (p *ConnectCanvasNodesResponse) GetCanvasRevision() (v int64) {
	return p.CanvasRevision
}

func (p *ConnectCanvasNodesResponse) IsSetTargetNode() bool {
	return p.TargetNode != nil
}

func (p *ConnectCanvasNodesResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ConnectCanvasNodesResponse(%+v)", *p)
}

// MaterializeCanvasResourceAssetReference atomically reuses or creates a Resource/ResourceAsset-backed
// canvas node and connects it to the consumer. Prompt @ selection uses this operation.
type MaterializeCanvasResourceAssetReferenceRequest struct {
	WorkspaceID  *string `json:"WorkspaceID,omitempty"`
	ProjectID    string  `json:"ProjectID"`
	CanvasID     string  `json:"CanvasID"`
	TargetNodeID string  `json:"TargetNodeID"`
	// ResourceAssetID 固定跟随一个素材槽位；与 ResourceID 必须且只能提供一个。
	ResourceAssetID *string    `json:"ResourceAssetID,omitempty"`
	TargetPort      CanvasPort `json:"TargetPort"`
	// ResourceID 动态跟随资源的主素材；当前仅用于音频资源。
	ResourceID                *string             `json:"ResourceID,omitempty"`
	ResourceAssetNodePosition *CanvasNodePosition `json:"ResourceAssetNodePosition"`
	// ReferenceType 显式声明活动引用身份。
	ReferenceType CanvasNodeMentionReferenceType `json:"ReferenceType"`
}

func NewMaterializeCanvasResourceAssetReferenceRequest() *MaterializeCanvasResourceAssetReferenceRequest {
	return &MaterializeCanvasResourceAssetReferenceRequest{}
}

func (p *MaterializeCanvasResourceAssetReferenceRequest) InitDefault() {
}

var MaterializeCanvasResourceAssetReferenceRequest_WorkspaceID_DEFAULT string

func (p *MaterializeCanvasResourceAssetReferenceRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return MaterializeCanvasResourceAssetReferenceRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *MaterializeCanvasResourceAssetReferenceRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *MaterializeCanvasResourceAssetReferenceRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *MaterializeCanvasResourceAssetReferenceRequest) GetTargetNodeID() (v string) {
	return p.TargetNodeID
}

var MaterializeCanvasResourceAssetReferenceRequest_ResourceAssetID_DEFAULT string

func (p *MaterializeCanvasResourceAssetReferenceRequest) GetResourceAssetID() (v string) {
	if !p.IsSetResourceAssetID() {
		return MaterializeCanvasResourceAssetReferenceRequest_ResourceAssetID_DEFAULT
	}
	return *p.ResourceAssetID
}

func (p *MaterializeCanvasResourceAssetReferenceRequest) GetTargetPort() (v CanvasPort) {
	return p.TargetPort
}

var MaterializeCanvasResourceAssetReferenceRequest_ResourceID_DEFAULT string

func (p *MaterializeCanvasResourceAssetReferenceRequest) GetResourceID() (v string) {
	if !p.IsSetResourceID() {
		return MaterializeCanvasResourceAssetReferenceRequest_ResourceID_DEFAULT
	}
	return *p.ResourceID
}

var MaterializeCanvasResourceAssetReferenceRequest_ResourceAssetNodePosition_DEFAULT *CanvasNodePosition

func (p *MaterializeCanvasResourceAssetReferenceRequest) GetResourceAssetNodePosition() (v *CanvasNodePosition) {
	if !p.IsSetResourceAssetNodePosition() {
		return MaterializeCanvasResourceAssetReferenceRequest_ResourceAssetNodePosition_DEFAULT
	}
	return p.ResourceAssetNodePosition
}

func (p *MaterializeCanvasResourceAssetReferenceRequest) GetReferenceType() (v CanvasNodeMentionReferenceType) {
	return p.ReferenceType
}

func (p *MaterializeCanvasResourceAssetReferenceRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *MaterializeCanvasResourceAssetReferenceRequest) IsSetResourceAssetID() bool {
	return p.ResourceAssetID != nil
}

func (p *MaterializeCanvasResourceAssetReferenceRequest) IsSetResourceID() bool {
	return p.ResourceID != nil
}

func (p *MaterializeCanvasResourceAssetReferenceRequest) IsSetResourceAssetNodePosition() bool {
	return p.ResourceAssetNodePosition != nil
}

func (p *MaterializeCanvasResourceAssetReferenceRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("MaterializeCanvasResourceAssetReferenceRequest(%+v)", *p)
}

type MaterializeCanvasResourceAssetReferenceResponse struct {
	ResourceAssetNode        *CanvasNode `json:"ResourceAssetNode"`
	TargetNode               *CanvasNode `json:"TargetNode"`
	CanvasRevision           int64       `json:"CanvasRevision"`
	CreatedResourceAssetNode bool        `json:"CreatedResourceAssetNode"`
}

func NewMaterializeCanvasResourceAssetReferenceResponse() *MaterializeCanvasResourceAssetReferenceResponse {
	return &MaterializeCanvasResourceAssetReferenceResponse{}
}

func (p *MaterializeCanvasResourceAssetReferenceResponse) InitDefault() {
}

var MaterializeCanvasResourceAssetReferenceResponse_ResourceAssetNode_DEFAULT *CanvasNode

func (p *MaterializeCanvasResourceAssetReferenceResponse) GetResourceAssetNode() (v *CanvasNode) {
	if !p.IsSetResourceAssetNode() {
		return MaterializeCanvasResourceAssetReferenceResponse_ResourceAssetNode_DEFAULT
	}
	return p.ResourceAssetNode
}

var MaterializeCanvasResourceAssetReferenceResponse_TargetNode_DEFAULT *CanvasNode

func (p *MaterializeCanvasResourceAssetReferenceResponse) GetTargetNode() (v *CanvasNode) {
	if !p.IsSetTargetNode() {
		return MaterializeCanvasResourceAssetReferenceResponse_TargetNode_DEFAULT
	}
	return p.TargetNode
}

func (p *MaterializeCanvasResourceAssetReferenceResponse) GetCanvasRevision() (v int64) {
	return p.CanvasRevision
}

func (p *MaterializeCanvasResourceAssetReferenceResponse) GetCreatedResourceAssetNode() (v bool) {
	return p.CreatedResourceAssetNode
}

func (p *MaterializeCanvasResourceAssetReferenceResponse) IsSetResourceAssetNode() bool {
	return p.ResourceAssetNode != nil
}

func (p *MaterializeCanvasResourceAssetReferenceResponse) IsSetTargetNode() bool {
	return p.TargetNode != nil
}

func (p *MaterializeCanvasResourceAssetReferenceResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("MaterializeCanvasResourceAssetReferenceResponse(%+v)", *p)
}

// MaterializeCanvasStandaloneAssetReference atomically reuses or creates a directly-uploaded
// Asset-backed canvas node and connects it to the consumer.
type MaterializeCanvasStandaloneAssetReferenceRequest struct {
	WorkspaceID  *string    `json:"WorkspaceID,omitempty"`
	ProjectID    string     `json:"ProjectID"`
	CanvasID     string     `json:"CanvasID"`
	TargetNodeID string     `json:"TargetNodeID"`
	AssetID      *string    `json:"AssetID,omitempty"`
	TargetPort   CanvasPort `json:"TargetPort"`
	// ReferenceType 固定传 ASSET。
	ReferenceType     CanvasNodeMentionReferenceType `json:"ReferenceType"`
	AssetNodePosition *CanvasNodePosition            `json:"AssetNodePosition"`
	// UploadedAsset 创建 Project Asset 并在同一业务调用内物化、连接；与 AssetID 互斥。
	UploadedAsset *CanvasUploadedAsset `json:"UploadedAsset,omitempty"`
}

func NewMaterializeCanvasStandaloneAssetReferenceRequest() *MaterializeCanvasStandaloneAssetReferenceRequest {
	return &MaterializeCanvasStandaloneAssetReferenceRequest{}
}

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) InitDefault() {
}

var MaterializeCanvasStandaloneAssetReferenceRequest_WorkspaceID_DEFAULT string

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return MaterializeCanvasStandaloneAssetReferenceRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) GetTargetNodeID() (v string) {
	return p.TargetNodeID
}

var MaterializeCanvasStandaloneAssetReferenceRequest_AssetID_DEFAULT string

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) GetAssetID() (v string) {
	if !p.IsSetAssetID() {
		return MaterializeCanvasStandaloneAssetReferenceRequest_AssetID_DEFAULT
	}
	return *p.AssetID
}

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) GetTargetPort() (v CanvasPort) {
	return p.TargetPort
}

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) GetReferenceType() (v CanvasNodeMentionReferenceType) {
	return p.ReferenceType
}

var MaterializeCanvasStandaloneAssetReferenceRequest_AssetNodePosition_DEFAULT *CanvasNodePosition

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) GetAssetNodePosition() (v *CanvasNodePosition) {
	if !p.IsSetAssetNodePosition() {
		return MaterializeCanvasStandaloneAssetReferenceRequest_AssetNodePosition_DEFAULT
	}
	return p.AssetNodePosition
}

var MaterializeCanvasStandaloneAssetReferenceRequest_UploadedAsset_DEFAULT *CanvasUploadedAsset

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) GetUploadedAsset() (v *CanvasUploadedAsset) {
	if !p.IsSetUploadedAsset() {
		return MaterializeCanvasStandaloneAssetReferenceRequest_UploadedAsset_DEFAULT
	}
	return p.UploadedAsset
}

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) IsSetAssetID() bool {
	return p.AssetID != nil
}

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) IsSetAssetNodePosition() bool {
	return p.AssetNodePosition != nil
}

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) IsSetUploadedAsset() bool {
	return p.UploadedAsset != nil
}

func (p *MaterializeCanvasStandaloneAssetReferenceRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("MaterializeCanvasStandaloneAssetReferenceRequest(%+v)", *p)
}

type MaterializeCanvasStandaloneAssetReferenceResponse struct {
	AssetNode        *CanvasNode `json:"AssetNode"`
	TargetNode       *CanvasNode `json:"TargetNode"`
	CanvasRevision   int64       `json:"CanvasRevision"`
	CreatedAssetNode bool        `json:"CreatedAssetNode"`
}

func NewMaterializeCanvasStandaloneAssetReferenceResponse() *MaterializeCanvasStandaloneAssetReferenceResponse {
	return &MaterializeCanvasStandaloneAssetReferenceResponse{}
}

func (p *MaterializeCanvasStandaloneAssetReferenceResponse) InitDefault() {
}

var MaterializeCanvasStandaloneAssetReferenceResponse_AssetNode_DEFAULT *CanvasNode

func (p *MaterializeCanvasStandaloneAssetReferenceResponse) GetAssetNode() (v *CanvasNode) {
	if !p.IsSetAssetNode() {
		return MaterializeCanvasStandaloneAssetReferenceResponse_AssetNode_DEFAULT
	}
	return p.AssetNode
}

var MaterializeCanvasStandaloneAssetReferenceResponse_TargetNode_DEFAULT *CanvasNode

func (p *MaterializeCanvasStandaloneAssetReferenceResponse) GetTargetNode() (v *CanvasNode) {
	if !p.IsSetTargetNode() {
		return MaterializeCanvasStandaloneAssetReferenceResponse_TargetNode_DEFAULT
	}
	return p.TargetNode
}

func (p *MaterializeCanvasStandaloneAssetReferenceResponse) GetCanvasRevision() (v int64) {
	return p.CanvasRevision
}

func (p *MaterializeCanvasStandaloneAssetReferenceResponse) GetCreatedAssetNode() (v bool) {
	return p.CreatedAssetNode
}

func (p *MaterializeCanvasStandaloneAssetReferenceResponse) IsSetAssetNode() bool {
	return p.AssetNode != nil
}

func (p *MaterializeCanvasStandaloneAssetReferenceResponse) IsSetTargetNode() bool {
	return p.TargetNode != nil
}

func (p *MaterializeCanvasStandaloneAssetReferenceResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("MaterializeCanvasStandaloneAssetReferenceResponse(%+v)", *p)
}

type DeleteCanvasEdgeRequest struct {
	WorkspaceID  *string `json:"WorkspaceID,omitempty"`
	ProjectID    string  `json:"ProjectID"`
	CanvasID     string  `json:"CanvasID"`
	TargetNodeID string  `json:"TargetNodeID"`
	EdgeID       string  `json:"EdgeID"`
}

func NewDeleteCanvasEdgeRequest() *DeleteCanvasEdgeRequest {
	return &DeleteCanvasEdgeRequest{}
}

func (p *DeleteCanvasEdgeRequest) InitDefault() {
}

var DeleteCanvasEdgeRequest_WorkspaceID_DEFAULT string

func (p *DeleteCanvasEdgeRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return DeleteCanvasEdgeRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *DeleteCanvasEdgeRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *DeleteCanvasEdgeRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *DeleteCanvasEdgeRequest) GetTargetNodeID() (v string) {
	return p.TargetNodeID
}

func (p *DeleteCanvasEdgeRequest) GetEdgeID() (v string) {
	return p.EdgeID
}

func (p *DeleteCanvasEdgeRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *DeleteCanvasEdgeRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DeleteCanvasEdgeRequest(%+v)", *p)
}

type DeleteCanvasEdgeResponse struct {
	TargetNode     *CanvasNode `json:"TargetNode"`
	CanvasRevision int64       `json:"CanvasRevision"`
}

func NewDeleteCanvasEdgeResponse() *DeleteCanvasEdgeResponse {
	return &DeleteCanvasEdgeResponse{}
}

func (p *DeleteCanvasEdgeResponse) InitDefault() {
}

var DeleteCanvasEdgeResponse_TargetNode_DEFAULT *CanvasNode

func (p *DeleteCanvasEdgeResponse) GetTargetNode() (v *CanvasNode) {
	if !p.IsSetTargetNode() {
		return DeleteCanvasEdgeResponse_TargetNode_DEFAULT
	}
	return p.TargetNode
}

func (p *DeleteCanvasEdgeResponse) GetCanvasRevision() (v int64) {
	return p.CanvasRevision
}

func (p *DeleteCanvasEdgeResponse) IsSetTargetNode() bool {
	return p.TargetNode != nil
}

func (p *DeleteCanvasEdgeResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DeleteCanvasEdgeResponse(%+v)", *p)
}

type StoryboardRankUpdate struct {
	NodeID         string `json:"NodeID"`
	StoryboardRank int64  `json:"StoryboardRank"`
}

func NewStoryboardRankUpdate() *StoryboardRankUpdate {
	return &StoryboardRankUpdate{}
}

func (p *StoryboardRankUpdate) InitDefault() {
}

func (p *StoryboardRankUpdate) GetNodeID() (v string) {
	return p.NodeID
}

func (p *StoryboardRankUpdate) GetStoryboardRank() (v int64) {
	return p.StoryboardRank
}

func (p *StoryboardRankUpdate) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StoryboardRankUpdate(%+v)", *p)
}

type ReorderStoryboardNodesRequest struct {
	WorkspaceID *string                 `json:"WorkspaceID,omitempty"`
	ProjectID   string                  `json:"ProjectID"`
	CanvasID    string                  `json:"CanvasID"`
	Items       []*StoryboardRankUpdate `json:"Items"`
}

func NewReorderStoryboardNodesRequest() *ReorderStoryboardNodesRequest {
	return &ReorderStoryboardNodesRequest{}
}

func (p *ReorderStoryboardNodesRequest) InitDefault() {
}

var ReorderStoryboardNodesRequest_WorkspaceID_DEFAULT string

func (p *ReorderStoryboardNodesRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return ReorderStoryboardNodesRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *ReorderStoryboardNodesRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *ReorderStoryboardNodesRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *ReorderStoryboardNodesRequest) GetItems() (v []*StoryboardRankUpdate) {
	return p.Items
}

func (p *ReorderStoryboardNodesRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *ReorderStoryboardNodesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ReorderStoryboardNodesRequest(%+v)", *p)
}

type ReorderStoryboardNodesResponse struct {
	Nodes          []*CanvasNode `json:"Nodes"`
	CanvasRevision int64         `json:"CanvasRevision"`
}

func NewReorderStoryboardNodesResponse() *ReorderStoryboardNodesResponse {
	return &ReorderStoryboardNodesResponse{}
}

func (p *ReorderStoryboardNodesResponse) InitDefault() {
}

func (p *ReorderStoryboardNodesResponse) GetNodes() (v []*CanvasNode) {
	return p.Nodes
}

func (p *ReorderStoryboardNodesResponse) GetCanvasRevision() (v int64) {
	return p.CanvasRevision
}

func (p *ReorderStoryboardNodesResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ReorderStoryboardNodesResponse(%+v)", *p)
}

// CanvasNodeAssetMentionNode 是 @ 面板直接消费的通用树节点。
// 顶层来源分组、项目素材组和素材叶子共用此结构；Children 为空不改变节点语义。
type CanvasNodeAssetMentionNode struct {
	ID          string                        `json:"ID"`
	Label       string                        `json:"Label"`
	Children    []*CanvasNodeAssetMentionNode `json:"Children"`
	URL         *string                       `json:"URL,omitempty"`
	MediaType   *asset.AssetMediaType         `json:"MediaType,omitempty"`
	Description *string                       `json:"Description,omitempty"`
	// CanvasNodeID 表示该叶子已经是当前画布上的节点；选择时直接建立节点连线。
	CanvasNodeID *string `json:"CanvasNodeID,omitempty"`
	// AssetID 是素材节点或生成节点当前输出对应的底层素材；项目资产叶子也使用该字段。
	AssetID *string `json:"AssetID,omitempty"`
	// NodeType 仅在画布节点叶子上返回，用于前端区分文本与媒体输出。
	NodeType *CanvasNodeType `json:"NodeType,omitempty"`
	// ResourceAssetID 是项目资产叶子的稳定身份；选择后画布节点始终解析其最新 CurrentAssetID。
	ResourceAssetID *string `json:"ResourceAssetID,omitempty"`
	// Reviews 按审核创建时间升序返回素材的全部当前有效记录。
	Reviews []*asset.AssetReview `json:"Reviews,omitempty"`
	// ResourceID 表示项目资源级叶子；选择后画布节点动态解析该 Resource 的主素材。
	ResourceID *string `json:"ResourceID,omitempty"`
	// ReferenceType 是该叶子的唯一活动引用身份类型；分组节点不设置。
	ReferenceType *CanvasNodeMentionReferenceType `json:"ReferenceType,omitempty"`
	// ResourceType 仅用于项目资产缺省封面展示，不参与引用身份判断。
	ResourceType *resource.ResourceType `json:"ResourceType,omitempty"`
	// 项目素材槽位始终可见；Available=false 时禁止确认消费，不能以 URL 是否存在推断。
	Available *bool `json:"Available,omitempty"`
	// 来自生成草稿的活动任务；用于区分生成中与暂无可用产物。
	Generating *bool `json:"Generating,omitempty"`
}

func NewCanvasNodeAssetMentionNode() *CanvasNodeAssetMentionNode {
	return &CanvasNodeAssetMentionNode{}
}

func (p *CanvasNodeAssetMentionNode) InitDefault() {
}

func (p *CanvasNodeAssetMentionNode) GetID() (v string) {
	return p.ID
}

func (p *CanvasNodeAssetMentionNode) GetLabel() (v string) {
	return p.Label
}

func (p *CanvasNodeAssetMentionNode) GetChildren() (v []*CanvasNodeAssetMentionNode) {
	return p.Children
}

var CanvasNodeAssetMentionNode_URL_DEFAULT string

func (p *CanvasNodeAssetMentionNode) GetURL() (v string) {
	if !p.IsSetURL() {
		return CanvasNodeAssetMentionNode_URL_DEFAULT
	}
	return *p.URL
}

var CanvasNodeAssetMentionNode_MediaType_DEFAULT asset.AssetMediaType

func (p *CanvasNodeAssetMentionNode) GetMediaType() (v asset.AssetMediaType) {
	if !p.IsSetMediaType() {
		return CanvasNodeAssetMentionNode_MediaType_DEFAULT
	}
	return *p.MediaType
}

var CanvasNodeAssetMentionNode_Description_DEFAULT string

func (p *CanvasNodeAssetMentionNode) GetDescription() (v string) {
	if !p.IsSetDescription() {
		return CanvasNodeAssetMentionNode_Description_DEFAULT
	}
	return *p.Description
}

var CanvasNodeAssetMentionNode_CanvasNodeID_DEFAULT string

func (p *CanvasNodeAssetMentionNode) GetCanvasNodeID() (v string) {
	if !p.IsSetCanvasNodeID() {
		return CanvasNodeAssetMentionNode_CanvasNodeID_DEFAULT
	}
	return *p.CanvasNodeID
}

var CanvasNodeAssetMentionNode_AssetID_DEFAULT string

func (p *CanvasNodeAssetMentionNode) GetAssetID() (v string) {
	if !p.IsSetAssetID() {
		return CanvasNodeAssetMentionNode_AssetID_DEFAULT
	}
	return *p.AssetID
}

var CanvasNodeAssetMentionNode_NodeType_DEFAULT CanvasNodeType

func (p *CanvasNodeAssetMentionNode) GetNodeType() (v CanvasNodeType) {
	if !p.IsSetNodeType() {
		return CanvasNodeAssetMentionNode_NodeType_DEFAULT
	}
	return *p.NodeType
}

var CanvasNodeAssetMentionNode_ResourceAssetID_DEFAULT string

func (p *CanvasNodeAssetMentionNode) GetResourceAssetID() (v string) {
	if !p.IsSetResourceAssetID() {
		return CanvasNodeAssetMentionNode_ResourceAssetID_DEFAULT
	}
	return *p.ResourceAssetID
}

var CanvasNodeAssetMentionNode_Reviews_DEFAULT []*asset.AssetReview

func (p *CanvasNodeAssetMentionNode) GetReviews() (v []*asset.AssetReview) {
	if !p.IsSetReviews() {
		return CanvasNodeAssetMentionNode_Reviews_DEFAULT
	}
	return p.Reviews
}

var CanvasNodeAssetMentionNode_ResourceID_DEFAULT string

func (p *CanvasNodeAssetMentionNode) GetResourceID() (v string) {
	if !p.IsSetResourceID() {
		return CanvasNodeAssetMentionNode_ResourceID_DEFAULT
	}
	return *p.ResourceID
}

var CanvasNodeAssetMentionNode_ReferenceType_DEFAULT CanvasNodeMentionReferenceType

func (p *CanvasNodeAssetMentionNode) GetReferenceType() (v CanvasNodeMentionReferenceType) {
	if !p.IsSetReferenceType() {
		return CanvasNodeAssetMentionNode_ReferenceType_DEFAULT
	}
	return *p.ReferenceType
}

var CanvasNodeAssetMentionNode_ResourceType_DEFAULT resource.ResourceType

func (p *CanvasNodeAssetMentionNode) GetResourceType() (v resource.ResourceType) {
	if !p.IsSetResourceType() {
		return CanvasNodeAssetMentionNode_ResourceType_DEFAULT
	}
	return *p.ResourceType
}

var CanvasNodeAssetMentionNode_Available_DEFAULT bool

func (p *CanvasNodeAssetMentionNode) GetAvailable() (v bool) {
	if !p.IsSetAvailable() {
		return CanvasNodeAssetMentionNode_Available_DEFAULT
	}
	return *p.Available
}

var CanvasNodeAssetMentionNode_Generating_DEFAULT bool

func (p *CanvasNodeAssetMentionNode) GetGenerating() (v bool) {
	if !p.IsSetGenerating() {
		return CanvasNodeAssetMentionNode_Generating_DEFAULT
	}
	return *p.Generating
}

func (p *CanvasNodeAssetMentionNode) IsSetURL() bool {
	return p.URL != nil
}

func (p *CanvasNodeAssetMentionNode) IsSetMediaType() bool {
	return p.MediaType != nil
}

func (p *CanvasNodeAssetMentionNode) IsSetDescription() bool {
	return p.Description != nil
}

func (p *CanvasNodeAssetMentionNode) IsSetCanvasNodeID() bool {
	return p.CanvasNodeID != nil
}

func (p *CanvasNodeAssetMentionNode) IsSetAssetID() bool {
	return p.AssetID != nil
}

func (p *CanvasNodeAssetMentionNode) IsSetNodeType() bool {
	return p.NodeType != nil
}

func (p *CanvasNodeAssetMentionNode) IsSetResourceAssetID() bool {
	return p.ResourceAssetID != nil
}

func (p *CanvasNodeAssetMentionNode) IsSetReviews() bool {
	return p.Reviews != nil
}

func (p *CanvasNodeAssetMentionNode) IsSetResourceID() bool {
	return p.ResourceID != nil
}

func (p *CanvasNodeAssetMentionNode) IsSetReferenceType() bool {
	return p.ReferenceType != nil
}

func (p *CanvasNodeAssetMentionNode) IsSetResourceType() bool {
	return p.ResourceType != nil
}

func (p *CanvasNodeAssetMentionNode) IsSetAvailable() bool {
	return p.Available != nil
}

func (p *CanvasNodeAssetMentionNode) IsSetGenerating() bool {
	return p.Generating != nil
}

func (p *CanvasNodeAssetMentionNode) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeAssetMentionNode(%+v)", *p)
}

// SearchCanvasNodeAssetsRequest 查询当前节点可用的引用、画布节点和项目资产。
// Keyword 同时匹配画布节点 name/text/prompt 与项目资产 name/description。
// Cursor 是服务端返回的不透明游标；首次查询不传，后续原样回传。
// Limit 是本次最多返回的可选素材组/叶子数量。
// MediaTypes 是调用方允许返回的媒体类型集合。
type SearchCanvasNodeAssetsRequest struct {
	WorkspaceID *string               `json:"WorkspaceID,omitempty"`
	ProjectID   string                `json:"ProjectID"`
	CanvasID    string                `json:"CanvasID"`
	NodeID      string                `json:"NodeID"`
	Keyword     *string               `json:"Keyword,omitempty"`
	Cursor      *string               `json:"Cursor,omitempty"`
	Limit       int32                 `json:"Limit"`
	MediaTypes  []CanvasNodeMediaType `json:"MediaTypes,omitempty"`
}

func NewSearchCanvasNodeAssetsRequest() *SearchCanvasNodeAssetsRequest {
	return &SearchCanvasNodeAssetsRequest{}
}

func (p *SearchCanvasNodeAssetsRequest) InitDefault() {
}

var SearchCanvasNodeAssetsRequest_WorkspaceID_DEFAULT string

func (p *SearchCanvasNodeAssetsRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return SearchCanvasNodeAssetsRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *SearchCanvasNodeAssetsRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *SearchCanvasNodeAssetsRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *SearchCanvasNodeAssetsRequest) GetNodeID() (v string) {
	return p.NodeID
}

var SearchCanvasNodeAssetsRequest_Keyword_DEFAULT string

func (p *SearchCanvasNodeAssetsRequest) GetKeyword() (v string) {
	if !p.IsSetKeyword() {
		return SearchCanvasNodeAssetsRequest_Keyword_DEFAULT
	}
	return *p.Keyword
}

var SearchCanvasNodeAssetsRequest_Cursor_DEFAULT string

func (p *SearchCanvasNodeAssetsRequest) GetCursor() (v string) {
	if !p.IsSetCursor() {
		return SearchCanvasNodeAssetsRequest_Cursor_DEFAULT
	}
	return *p.Cursor
}

func (p *SearchCanvasNodeAssetsRequest) GetLimit() (v int32) {
	return p.Limit
}

var SearchCanvasNodeAssetsRequest_MediaTypes_DEFAULT []CanvasNodeMediaType

func (p *SearchCanvasNodeAssetsRequest) GetMediaTypes() (v []CanvasNodeMediaType) {
	if !p.IsSetMediaTypes() {
		return SearchCanvasNodeAssetsRequest_MediaTypes_DEFAULT
	}
	return p.MediaTypes
}

func (p *SearchCanvasNodeAssetsRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *SearchCanvasNodeAssetsRequest) IsSetKeyword() bool {
	return p.Keyword != nil
}

func (p *SearchCanvasNodeAssetsRequest) IsSetCursor() bool {
	return p.Cursor != nil
}

func (p *SearchCanvasNodeAssetsRequest) IsSetMediaTypes() bool {
	return p.MediaTypes != nil
}

func (p *SearchCanvasNodeAssetsRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("SearchCanvasNodeAssetsRequest(%+v)", *p)
}

type SearchCanvasNodeAssetsResponse struct {
	Items      []*CanvasNodeAssetMentionNode `json:"Items"`
	NextCursor *string                       `json:"NextCursor,omitempty"`
}

func NewSearchCanvasNodeAssetsResponse() *SearchCanvasNodeAssetsResponse {
	return &SearchCanvasNodeAssetsResponse{}
}

func (p *SearchCanvasNodeAssetsResponse) InitDefault() {
}

func (p *SearchCanvasNodeAssetsResponse) GetItems() (v []*CanvasNodeAssetMentionNode) {
	return p.Items
}

var SearchCanvasNodeAssetsResponse_NextCursor_DEFAULT string

func (p *SearchCanvasNodeAssetsResponse) GetNextCursor() (v string) {
	if !p.IsSetNextCursor() {
		return SearchCanvasNodeAssetsResponse_NextCursor_DEFAULT
	}
	return *p.NextCursor
}

func (p *SearchCanvasNodeAssetsResponse) IsSetNextCursor() bool {
	return p.NextCursor != nil
}

func (p *SearchCanvasNodeAssetsResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("SearchCanvasNodeAssetsResponse(%+v)", *p)
}

// StartCanvasNodeAssetsMatch 以已保存 Revision 启动持久任务，不接受编辑草稿。
type StartCanvasNodeAssetsMatchRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	NodeID      string  `json:"NodeID"`
	Revision    int64   `json:"Revision"`
}

func NewStartCanvasNodeAssetsMatchRequest() *StartCanvasNodeAssetsMatchRequest {
	return &StartCanvasNodeAssetsMatchRequest{}
}

func (p *StartCanvasNodeAssetsMatchRequest) InitDefault() {
}

var StartCanvasNodeAssetsMatchRequest_WorkspaceID_DEFAULT string

func (p *StartCanvasNodeAssetsMatchRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return StartCanvasNodeAssetsMatchRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *StartCanvasNodeAssetsMatchRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *StartCanvasNodeAssetsMatchRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *StartCanvasNodeAssetsMatchRequest) GetNodeID() (v string) {
	return p.NodeID
}

func (p *StartCanvasNodeAssetsMatchRequest) GetRevision() (v int64) {
	return p.Revision
}

func (p *StartCanvasNodeAssetsMatchRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *StartCanvasNodeAssetsMatchRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StartCanvasNodeAssetsMatchRequest(%+v)", *p)
}

type CancelCanvasNodeAssetsMatchRequest struct {
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	ProjectID   string  `json:"ProjectID"`
	CanvasID    string  `json:"CanvasID"`
	NodeID      string  `json:"NodeID"`
	TaskRunID   string  `json:"TaskRunID"`
}

func NewCancelCanvasNodeAssetsMatchRequest() *CancelCanvasNodeAssetsMatchRequest {
	return &CancelCanvasNodeAssetsMatchRequest{}
}

func (p *CancelCanvasNodeAssetsMatchRequest) InitDefault() {
}

var CancelCanvasNodeAssetsMatchRequest_WorkspaceID_DEFAULT string

func (p *CancelCanvasNodeAssetsMatchRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return CancelCanvasNodeAssetsMatchRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *CancelCanvasNodeAssetsMatchRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *CancelCanvasNodeAssetsMatchRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *CancelCanvasNodeAssetsMatchRequest) GetNodeID() (v string) {
	return p.NodeID
}

func (p *CancelCanvasNodeAssetsMatchRequest) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *CancelCanvasNodeAssetsMatchRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *CancelCanvasNodeAssetsMatchRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CancelCanvasNodeAssetsMatchRequest(%+v)", *p)
}

type StartCanvasNodeAssetsMatchResponse struct {
	TaskRunID string `json:"TaskRunID"`
}

func NewStartCanvasNodeAssetsMatchResponse() *StartCanvasNodeAssetsMatchResponse {
	return &StartCanvasNodeAssetsMatchResponse{}
}

func (p *StartCanvasNodeAssetsMatchResponse) InitDefault() {
}

func (p *StartCanvasNodeAssetsMatchResponse) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *StartCanvasNodeAssetsMatchResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("StartCanvasNodeAssetsMatchResponse(%+v)", *p)
}

type CanvasNodeStateTarget struct {
	NodeID    string `json:"NodeID"`
	TaskRunID string `json:"TaskRunID"`
}

func NewCanvasNodeStateTarget() *CanvasNodeStateTarget {
	return &CanvasNodeStateTarget{}
}

func (p *CanvasNodeStateTarget) InitDefault() {
}

func (p *CanvasNodeStateTarget) GetNodeID() (v string) {
	return p.NodeID
}

func (p *CanvasNodeStateTarget) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *CanvasNodeStateTarget) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeStateTarget(%+v)", *p)
}

// Node 与 RelatedNodes 是已持久化业务数据；匹配与生成使用不同 TaskType。
type CanvasNodeState struct {
	NodeID              string                         `json:"NodeID"`
	TaskRunID           string                         `json:"TaskRunID"`
	Status              CanvasGenerationStatus         `json:"Status"`
	TaskType            CanvasNodeTaskType             `json:"TaskType"`
	Node                *CanvasNode                    `json:"Node"`
	RelatedNodes        []*CanvasNode                  `json:"RelatedNodes"`
	ErrorCode           *string                        `json:"ErrorCode,omitempty"`
	ErrorMessage        *string                        `json:"ErrorMessage,omitempty"`
	SeedanceTaskID      *string                        `json:"SeedanceTaskID,omitempty"`
	VideoProviderStatus *CanvasNodeVideoProviderStatus `json:"VideoProviderStatus,omitempty"`
}

func NewCanvasNodeState() *CanvasNodeState {
	return &CanvasNodeState{}
}

func (p *CanvasNodeState) InitDefault() {
}

func (p *CanvasNodeState) GetNodeID() (v string) {
	return p.NodeID
}

func (p *CanvasNodeState) GetTaskRunID() (v string) {
	return p.TaskRunID
}

func (p *CanvasNodeState) GetStatus() (v CanvasGenerationStatus) {
	return p.Status
}

func (p *CanvasNodeState) GetTaskType() (v CanvasNodeTaskType) {
	return p.TaskType
}

var CanvasNodeState_Node_DEFAULT *CanvasNode

func (p *CanvasNodeState) GetNode() (v *CanvasNode) {
	if !p.IsSetNode() {
		return CanvasNodeState_Node_DEFAULT
	}
	return p.Node
}

func (p *CanvasNodeState) GetRelatedNodes() (v []*CanvasNode) {
	return p.RelatedNodes
}

var CanvasNodeState_ErrorCode_DEFAULT string

func (p *CanvasNodeState) GetErrorCode() (v string) {
	if !p.IsSetErrorCode() {
		return CanvasNodeState_ErrorCode_DEFAULT
	}
	return *p.ErrorCode
}

var CanvasNodeState_ErrorMessage_DEFAULT string

func (p *CanvasNodeState) GetErrorMessage() (v string) {
	if !p.IsSetErrorMessage() {
		return CanvasNodeState_ErrorMessage_DEFAULT
	}
	return *p.ErrorMessage
}

var CanvasNodeState_SeedanceTaskID_DEFAULT string

func (p *CanvasNodeState) GetSeedanceTaskID() (v string) {
	if !p.IsSetSeedanceTaskID() {
		return CanvasNodeState_SeedanceTaskID_DEFAULT
	}
	return *p.SeedanceTaskID
}

var CanvasNodeState_VideoProviderStatus_DEFAULT CanvasNodeVideoProviderStatus

func (p *CanvasNodeState) GetVideoProviderStatus() (v CanvasNodeVideoProviderStatus) {
	if !p.IsSetVideoProviderStatus() {
		return CanvasNodeState_VideoProviderStatus_DEFAULT
	}
	return *p.VideoProviderStatus
}

func (p *CanvasNodeState) IsSetNode() bool {
	return p.Node != nil
}

func (p *CanvasNodeState) IsSetErrorCode() bool {
	return p.ErrorCode != nil
}

func (p *CanvasNodeState) IsSetErrorMessage() bool {
	return p.ErrorMessage != nil
}

func (p *CanvasNodeState) IsSetSeedanceTaskID() bool {
	return p.SeedanceTaskID != nil
}

func (p *CanvasNodeState) IsSetVideoProviderStatus() bool {
	return p.VideoProviderStatus != nil
}

func (p *CanvasNodeState) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CanvasNodeState(%+v)", *p)
}

type BatchGetCanvasNodeStatesRequest struct {
	WorkspaceID *string                  `json:"WorkspaceID,omitempty"`
	ProjectID   string                   `json:"ProjectID"`
	CanvasID    string                   `json:"CanvasID"`
	Targets     []*CanvasNodeStateTarget `json:"Targets"`
}

func NewBatchGetCanvasNodeStatesRequest() *BatchGetCanvasNodeStatesRequest {
	return &BatchGetCanvasNodeStatesRequest{}
}

func (p *BatchGetCanvasNodeStatesRequest) InitDefault() {
}

var BatchGetCanvasNodeStatesRequest_WorkspaceID_DEFAULT string

func (p *BatchGetCanvasNodeStatesRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return BatchGetCanvasNodeStatesRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *BatchGetCanvasNodeStatesRequest) GetProjectID() (v string) {
	return p.ProjectID
}

func (p *BatchGetCanvasNodeStatesRequest) GetCanvasID() (v string) {
	return p.CanvasID
}

func (p *BatchGetCanvasNodeStatesRequest) GetTargets() (v []*CanvasNodeStateTarget) {
	return p.Targets
}

func (p *BatchGetCanvasNodeStatesRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *BatchGetCanvasNodeStatesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetCanvasNodeStatesRequest(%+v)", *p)
}

type BatchGetCanvasNodeStatesResponse struct {
	Items []*CanvasNodeState `json:"Items"`
}

func NewBatchGetCanvasNodeStatesResponse() *BatchGetCanvasNodeStatesResponse {
	return &BatchGetCanvasNodeStatesResponse{}
}

func (p *BatchGetCanvasNodeStatesResponse) InitDefault() {
}

func (p *BatchGetCanvasNodeStatesResponse) GetItems() (v []*CanvasNodeState) {
	return p.Items
}

func (p *BatchGetCanvasNodeStatesResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BatchGetCanvasNodeStatesResponse(%+v)", *p)
}
