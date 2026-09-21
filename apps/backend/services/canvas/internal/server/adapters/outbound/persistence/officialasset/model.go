package officialasset

import (
	"time"

	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
)

// officialAssetRow 记录一条官方清单条目：清单 slug、它在本 scope 下的注册进度与内部
// Asset，以及对账物化出的 OFFICIAL Resource 与其唯一 ResourceAsset。
//
// 官方素材没有外部 asset ID：统一上传后只存在 AgentFrame 自己的内部标识。一份内容只上传一次
// 得到共享 BlobID，再为每个 scope 各调一次 LongLiveArtifact 得到各自的 ArtifactID。
//
// 官方 Resource 与 PROJECT Resource 共用 resources 表和同一套 scope 条件，官方记录
// 必须按 scope 各物化一份才可见，因此本表同样按 scope 记录：一条清单条目在每个 scope
// 各有一行。
//
// ResourceID 是对账的稳定反查键。不能改用 InternalAssetID -> resource_assets
// .current_asset_id 反查：换版正是要改掉 current_asset_id，那条链路在换版瞬间就断了。
type officialAssetRow struct {
	ID          uint64  `gorm:"primaryKey;autoIncrement"`
	Slug        string  `gorm:"size:255;not null;uniqueIndex:uniq_official_assets_scope,priority:1;index:idx_official_assets_slug"`
	TenantID    string  `gorm:"size:64;not null;uniqueIndex:uniq_official_assets_scope,priority:2;uniqueIndex:uniq_official_assets_internal,priority:1"`
	WorkspaceID *string `gorm:"size:64"`
	// WorkspaceKey 是 WorkspaceID 的 NOT NULL 归一化投影（NULL workspace 记为空串），
	// 只用于让唯一索引覆盖到 workspace 维度。MySQL 唯一索引不对 NULL 去重，直接把可空
	// 的 WorkspaceID 放进索引会让所有「无 workspace」的行互不冲突、幂等保护失效；把
	// WorkspaceID 本身改成 NOT NULL 又会破坏既有的可空 workspace scope 语义。
	WorkspaceKey string `gorm:"size:64;not null;default:'';uniqueIndex:uniq_official_assets_scope,priority:3;uniqueIndex:uniq_official_assets_internal,priority:2"`
	// ArtifactID 是该 scope 下 LongLiveArtifact 返回的标识。按 scope 各注册一次，因此
	// 同一份内容在不同 scope 有不同 ArtifactID。
	ArtifactID *string `gorm:"size:128"`
	// InternalAssetID 在注册完成前为 NULL。唯一性只在 scope 内成立：同一份官方内容会被
	// 各 scope 各注册一次。
	InternalAssetID *persistenceid.UUID `gorm:"uniqueIndex:uniq_official_assets_internal,priority:3"`
	// ResourceID / ResourceAssetID 在物化前为 NULL。
	ResourceID      *persistenceid.UUID `gorm:"index:idx_official_assets_resource"`
	ResourceAssetID *persistenceid.UUID `gorm:"index"`
	LongLiveStatus  int16               `gorm:"not null;default:1;index"`
	FileSHA256      *string             `gorm:"size:64"`
	FileName        string              `gorm:"size:512;not null;default:''"`
	MediaType       int16               `gorm:"not null"`
	SizeBytes       int64               `gorm:"not null;default:0"`
	CreatedAt       time.Time           `gorm:"not null"`
	UpdatedAt       time.Time           `gorm:"not null"`
	// DeletedAt 参与 scope 唯一索引，使软删除后同一条目可以在同一 scope 重新上架。
	DeletedAt soft_delete.DeletedAt `gorm:"softDelete:milli;index;uniqueIndex:uniq_official_assets_scope,priority:4"`
}

func (officialAssetRow) TableName() string { return "official_assets" }

type officialAssetBlobRow struct {
	ID             uint64     `gorm:"primaryKey;autoIncrement"`
	Slug           string     `gorm:"size:255;not null;uniqueIndex:uniq_official_asset_blobs_version,priority:1"`
	FileSHA256     string     `gorm:"size:64;not null;uniqueIndex:uniq_official_asset_blobs_version,priority:2"`
	BlobID         *string    `gorm:"size:255"`
	Status         int16      `gorm:"not null;default:1;index"`
	LeaseOwner     *string    `gorm:"size:64"`
	LeaseExpiresAt *time.Time `gorm:"index"`
	FileName       string     `gorm:"size:512;not null"`
	ContentType    string     `gorm:"size:255;not null"`
	SizeBytes      int64      `gorm:"not null;default:0"`
	CreatedAt      time.Time  `gorm:"not null"`
	UpdatedAt      time.Time  `gorm:"not null"`
}

func (officialAssetBlobRow) TableName() string { return "official_asset_blobs" }

func Models() []any {
	return []any{&officialAssetRow{}, &officialAssetBlobRow{}}
}
