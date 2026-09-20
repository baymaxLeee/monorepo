package resource

import (
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	ErrInvalidResource    = errors.New("invalid resource")
	ErrInvalidType        = errors.New("invalid resource type")
	ErrInvalidName        = errors.New("invalid resource name")
	ErrInvalidDescription = errors.New("invalid resource description")
	ErrRevisionConflict   = errors.New("resource revision conflict")
	// ErrReadOnly 表示面向用户的写接口试图修改 OFFICIAL Resource 或其绑定项。
	// OFFICIAL 对用户只读，只能由受信对账维护（ADR-002）。
	ErrReadOnly = errors.New("resource is read-only")
)

type Type int16

const (
	TypeCharacter Type = iota + 1
	TypeScene
	TypeProp
	TypeAudio
)

func (t Type) Valid() bool {
	return t == TypeCharacter || t == TypeScene || t == TypeProp || t == TypeAudio
}

// maxImageResourceAssets 是单个图片类资源（人物/场景/道具）下子资产（形象/场景图/道具图）的数量上限。
// 产品口径统一为 200（liuyuzhuo.2002 确认）；前端达上限置灰新建入口，后端在创建拦截点做权威兜底。
const maxImageResourceAssets int32 = 200

func (t Type) ResourceAssetLimit() int32 {
	if t == TypeAudio {
		return 1
	}
	if t.Valid() {
		return maxImageResourceAssets
	}
	return 0
}

type OwnerType int16

const (
	OwnerProject OwnerType = 1
	// OwnerOfficial 是官方资源（当前用于预置音色）：不属于任何 Project，
	// 对用户只读，只能由受信对账维护（ADR-002）。
	OwnerOfficial OwnerType = 2
)

func (o OwnerType) Valid() bool { return o == OwnerProject || o == OwnerOfficial }

// ReadOnly 表示该所有权下的 Resource 及其绑定项禁止任何面向用户的写操作。
func (o OwnerType) ReadOnly() bool { return o == OwnerOfficial }

type Resource struct {
	ID                         string
	TenantID                   string
	WorkspaceID                *string
	OwnerType                  OwnerType
	OwnerID                    string
	Type                       Type
	Name                       string
	Description                string
	PrimaryResourceAssetID     *string
	Revision                   int64
	ResourceAssetCount         int32
	ApprovedResourceAssetCount int32
	CreatedBy                  string
	CreatedAt                  time.Time
	UpdatedAt                  time.Time
	DeletedAt                  *time.Time
}

// ResourceAssetLimit 是该 Resource 允许的未删除 ResourceAsset 数量上限。
//
// 判定按所有权优先：OFFICIAL 一律为 1，因为官方素材的语义是「一条官方条目对应一份官方
// 内容」，不存在同一条目下多张备选图。这样将来开放官方人物/场景/道具时无需再改上限逻辑，
// 单素材约束也不依赖「官方目前只有音频」这一暂时事实。非官方仍按类型判定。
func (r Resource) ResourceAssetLimit() int32 {
	if !r.Type.Valid() {
		return 0
	}
	if r.OwnerType == OwnerOfficial {
		return 1
	}
	return r.Type.ResourceAssetLimit()
}

type NewInput struct {
	ID          string
	TenantID    string
	WorkspaceID *string
	OwnerType   OwnerType
	OwnerID     string
	Type        Type
	Name        string
	Description string
	CreatedBy   string
	Now         time.Time
}

func New(input NewInput) (Resource, error) {
	if !input.Type.Valid() {
		return Resource{}, ErrInvalidType
	}
	if err := validateName(input.Name); err != nil {
		return Resource{}, err
	}
	if !utf8.ValidString(input.Description) || utf8.RuneCountInString(input.Description) > 200 {
		return Resource{}, ErrInvalidDescription
	}
	if strings.TrimSpace(input.ID) == "" || strings.TrimSpace(input.TenantID) == "" ||
		!input.OwnerType.Valid() || strings.TrimSpace(input.OwnerID) == "" ||
		strings.TrimSpace(input.CreatedBy) == "" || input.Now.IsZero() {
		return Resource{}, ErrInvalidResource
	}
	return Resource{
		ID: input.ID, TenantID: input.TenantID, WorkspaceID: cloneString(input.WorkspaceID),
		OwnerType: input.OwnerType, OwnerID: input.OwnerID, Type: input.Type,
		Name: input.Name, Description: input.Description, Revision: 1,
		CreatedBy: input.CreatedBy, CreatedAt: input.Now.UTC(), UpdatedAt: input.Now.UTC(),
	}, nil
}

func (r *Resource) Update(name, description string, expectedRevision int64, now time.Time) (bool, error) {
	if r.Revision != expectedRevision {
		return false, ErrRevisionConflict
	}
	if err := validateName(name); err != nil {
		return false, err
	}
	if !utf8.ValidString(description) || utf8.RuneCountInString(description) > 200 {
		return false, ErrInvalidDescription
	}
	if r.Name == name && r.Description == description {
		return false, nil
	}
	r.Name = name
	r.Description = description
	r.Revision++
	r.UpdatedAt = now.UTC()
	return true, nil
}

func (r *Resource) Delete(expectedRevision int64, now time.Time) error {
	if r.Revision != expectedRevision {
		return ErrRevisionConflict
	}
	deletedAt := now.UTC()
	r.DeletedAt = &deletedAt
	r.Revision++
	r.UpdatedAt = deletedAt
	return nil
}

func (r *Resource) TouchAssets(expectedRevision int64, primaryID *string, count int32, now time.Time) (bool, error) {
	if r.Revision != expectedRevision {
		return false, ErrRevisionConflict
	}
	if count < 0 || (count == 0 && primaryID != nil) || (count > 0 && primaryID == nil) {
		return false, ErrInvalidResource
	}
	if equalStringPointers(r.PrimaryResourceAssetID, primaryID) && r.ResourceAssetCount == count {
		return false, nil
	}
	r.PrimaryResourceAssetID = cloneString(primaryID)
	r.ResourceAssetCount = count
	r.Revision++
	r.UpdatedAt = now.UTC()
	return true, nil
}

func (r *Resource) AttachResourceAsset(expectedRevision int64, resourceAssetID string, now time.Time) error {
	resourceAssetID = strings.TrimSpace(resourceAssetID)
	if resourceAssetID == "" {
		return ErrInvalidResource
	}
	primaryID := r.PrimaryResourceAssetID
	if primaryID == nil {
		primaryID = &resourceAssetID
	}
	_, err := r.TouchAssets(expectedRevision, primaryID, r.ResourceAssetCount+1, now)
	return err
}

func (r *Resource) Touch(expectedRevision int64, now time.Time) error {
	if r.Revision != expectedRevision {
		return ErrRevisionConflict
	}
	r.Revision++
	r.UpdatedAt = now.UTC()
	return nil
}

const maxNameRunes = 128

func validateName(name string) error {
	return validateNameWithLimit(name, maxNameRunes)
}

func validateNameWithLimit(name string, maxRunes int) error {
	if !utf8.ValidString(name) {
		return ErrInvalidName
	}
	runes := []rune(name)
	if len(runes) < 1 || len(runes) > maxRunes ||
		invalidBoundaryRune(runes[0]) || invalidBoundaryRune(runes[len(runes)-1]) {
		return ErrInvalidName
	}
	return nil
}

// ValidateOfficialName is the trusted manifest validation entry point.
func ValidateOfficialName(name string) error {
	return validateName(name)
}

func invalidBoundaryRune(value rune) bool {
	return value == '-' || value == '_' || unicode.IsSpace(value)
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func equalStringPointers(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}
