// Package officialasset 维护官方清单条目在某个 scope 下的注册与物化记录。
//
// 一条清单条目声明一个完整对象：一个官方 Resource + 其唯一 ResourceAsset + 一份音频内容，
// 三者 1:1。对账以清单自带的 slug 为匹配键——它与音色名称、blob 都解耦，因此改名与换内容
// 都不会被误判成「旧条目下线 + 新条目上线」。
//
// 官方素材没有外部 asset ID：统一上传后只存在 AgentFrame 自己的内部标识。一份内容只上传一次
// 得到共享的 BlobID，再为每个 scope 各调用一次 LongLiveArtifact，各自得到 ArtifactID 与
// Asset。按 ADR-010，BlobID 与 ArtifactID 都只是存储定位，不成为领域对象身份。
package officialasset

import (
	"errors"
	"strings"
	"time"

	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
)

var (
	ErrInvalidOfficialAsset = errors.New("invalid official asset")
	ErrInvalidScope         = errors.New("invalid official asset scope")
	ErrInvalidLongLiveState = errors.New("invalid official asset long-live state")
	ErrInvalidMediaType     = errors.New("invalid official asset media type")
	ErrInvalidRegistration  = errors.New("invalid official asset registration result")
	ErrInvalidMaterializing = errors.New("invalid official asset materialization")
)

// sha256HexLength 是 SHA-256 摘要的十六进制长度，与仓库既有 *_sha256 列宽一致。
const sha256HexLength = 64

// LongLiveStatus 是该 scope 下 LongLiveArtifact 的注册状态。
type LongLiveStatus int16

const (
	LongLivePending LongLiveStatus = iota + 1
	LongLiveRegistering
	LongLiveCompleted
	LongLiveFailed
)

func (s LongLiveStatus) Valid() bool { return s >= LongLivePending && s <= LongLiveFailed }

// Scope 是官方条目的物化范围。官方 Resource 与 PROJECT Resource 共用 resources 表和
// 同一套 scope 条件，官方记录必须在调用方 scope 下存在才可见，因此按 scope 各注册一份。
type Scope struct {
	TenantID    string
	WorkspaceID *string
}

func (s Scope) Valid() bool { return strings.TrimSpace(s.TenantID) != "" }

// OfficialAsset 是一条清单条目在某个 scope 下的注册与物化记录。
//
// 只有 LongLiveCompleted 才持有 InternalAssetID、ArtifactID 与 FileSHA256；
// ResourceID / ResourceAssetID 在物化前为空。
type OfficialAsset struct {
	// Slug 是清单自带的稳定标识，也是对账匹配键。
	Slug            string
	Scope           Scope
	ArtifactID      string
	InternalAssetID string
	ResourceID      string
	ResourceAssetID string
	LongLiveStatus  LongLiveStatus
	FileSHA256      string
	FileName        string
	MediaType       domainasset.MediaType
	SizeBytes       int64
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type NewInput struct {
	Slug      string
	Scope     Scope
	FileName  string
	MediaType domainasset.MediaType
	Now       time.Time
}

// New 登记一条尚未注册的清单条目。注册结果由 MarkRegistered 写入、物化结果由
// Materialize 写入，因此这里都不接受。
func New(input NewInput) (OfficialAsset, error) {
	if !input.Scope.Valid() {
		return OfficialAsset{}, ErrInvalidScope
	}
	if !input.MediaType.Valid() {
		return OfficialAsset{}, ErrInvalidMediaType
	}
	// 不要求 FileName：音频产物由 magico 脚本另行生成，条目可以先按音色名登记，待产物就位
	// 后再补入文件名。缺文件的条目不会被挂载，因此不会产生空插槽。
	if strings.TrimSpace(input.Slug) == "" || input.Now.IsZero() {
		return OfficialAsset{}, ErrInvalidOfficialAsset
	}
	now := input.Now.UTC()
	return OfficialAsset{
		Slug:           strings.TrimSpace(input.Slug),
		Scope:          input.Scope,
		LongLiveStatus: LongLivePending,
		FileName:       input.FileName,
		MediaType:      input.MediaType,
		CreatedAt:      now,
		UpdatedAt:      now,
	}, nil
}

// Materialized 表示该条目已在本 scope 下物化出 Resource 与 ResourceAsset。
func (a OfficialAsset) Materialized() bool {
	return a.ResourceID != "" && a.ResourceAssetID != ""
}

// MountableAssetID 返回可挂载到 ResourceAsset 的内部 Asset ID。
//
// 只有注册完成的条目才可挂载：未完成时返回 false，对账据此跳过挂载而不是创建一个没有
// 内容的空插槽。
func (a OfficialAsset) MountableAssetID() (string, bool) {
	if a.LongLiveStatus != LongLiveCompleted || a.InternalAssetID == "" {
		return "", false
	}
	return a.InternalAssetID, true
}

// NeedsRevision 判断已物化的条目是否需要把 ResourceAsset 换版到新的内部 Asset。
//
// 同一 slug 重新上传后会指向新的内部 Asset，此时对账必须推进 ResourceAsset 的 revision，
// 而不是原地改写既有 Asset（ADR-010：内容不可原地改写）。
func (a OfficialAsset) NeedsRevision(currentAssetID string) bool {
	mountable, ok := a.MountableAssetID()
	if !ok || !a.Materialized() {
		return false
	}
	return mountable != currentAssetID
}

// NeedsRegistration reports whether this scope must register the current
// manifest content version. REGISTERING is deliberately retryable so a crash
// after checkpointing that state cannot strand the entry forever.
func (a OfficialAsset) NeedsRegistration(fileSHA256 string) bool {
	return a.LongLiveStatus != LongLiveCompleted ||
		a.FileSHA256 != strings.ToLower(strings.TrimSpace(fileSHA256))
}

// BeginRegistration checkpoints a retryable scope registration attempt. It
// preserves the last completed Asset and materialization until replacement
// succeeds, so an update failure does not make the existing preset disappear.
func (a OfficialAsset) BeginRegistration(now time.Time) (OfficialAsset, error) {
	if now.IsZero() {
		return OfficialAsset{}, ErrInvalidOfficialAsset
	}
	a.LongLiveStatus = LongLiveRegistering
	a.UpdatedAt = now.UTC()
	return a, nil
}

type RegistrationResult struct {
	ArtifactID      string
	InternalAssetID string
	FileSHA256      string
	SizeBytes       int64
	Now             time.Time
}

// MarkRegistered 固定该 scope 下的 ArtifactID 与内部 Asset。
//
// 允许对已完成条目重新写入：同一 slug 换内容是官方素材的正常更新路径，换内容后对账会把
// ResourceAsset 换版到新 Asset。
func (a OfficialAsset) MarkRegistered(result RegistrationResult) (OfficialAsset, error) {
	if a.LongLiveStatus != LongLiveRegistering {
		return OfficialAsset{}, ErrInvalidLongLiveState
	}
	if strings.TrimSpace(result.ArtifactID) == "" ||
		strings.TrimSpace(result.InternalAssetID) == "" ||
		result.SizeBytes <= 0 || result.Now.IsZero() {
		return OfficialAsset{}, ErrInvalidRegistration
	}
	if !validSHA256Hex(result.FileSHA256) {
		return OfficialAsset{}, ErrInvalidRegistration
	}
	a.ArtifactID = strings.TrimSpace(result.ArtifactID)
	a.InternalAssetID = strings.TrimSpace(result.InternalAssetID)
	a.FileSHA256 = strings.ToLower(strings.TrimSpace(result.FileSHA256))
	a.SizeBytes = result.SizeBytes
	a.LongLiveStatus = LongLiveCompleted
	a.UpdatedAt = result.Now.UTC()
	return a, nil
}

// MarkLongLiveFailed 记录一次失败的注册尝试。
//
// 保留既有物化结果，使已上线的官方条目不因一次注册失败而消失。
func (a OfficialAsset) MarkLongLiveFailed(now time.Time) (OfficialAsset, error) {
	if now.IsZero() {
		return OfficialAsset{}, ErrInvalidOfficialAsset
	}
	a.LongLiveStatus = LongLiveFailed
	a.UpdatedAt = now.UTC()
	return a, nil
}

// Materialize 记录本 scope 下对账物化出的 Resource 与其唯一 ResourceAsset。
//
// 物化结果是对账的稳定反查键：不能改用 InternalAssetID 经 resource_assets
// .current_asset_id 反查，因为换版正是要改掉 current_asset_id。
func (a OfficialAsset) Materialize(resourceID, resourceAssetID string, now time.Time) (OfficialAsset, error) {
	if strings.TrimSpace(resourceID) == "" || strings.TrimSpace(resourceAssetID) == "" || now.IsZero() {
		return OfficialAsset{}, ErrInvalidMaterializing
	}
	a.ResourceID = strings.TrimSpace(resourceID)
	a.ResourceAssetID = strings.TrimSpace(resourceAssetID)
	a.UpdatedAt = now.UTC()
	return a, nil
}

// ResetMaterialization 清除已悬空的 Resource 映射，但保留已注册内容，供对账重新物化。
func (a OfficialAsset) ResetMaterialization(now time.Time) (OfficialAsset, error) {
	if now.IsZero() {
		return OfficialAsset{}, ErrInvalidMaterializing
	}
	a.ResourceID = ""
	a.ResourceAssetID = ""
	a.UpdatedAt = now.UTC()
	return a, nil
}

func validSHA256Hex(value string) bool {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) != sha256HexLength {
		return false
	}
	for _, char := range trimmed {
		switch {
		case char >= '0' && char <= '9':
		case char >= 'a' && char <= 'f':
		case char >= 'A' && char <= 'F':
		default:
			return false
		}
	}
	return true
}
