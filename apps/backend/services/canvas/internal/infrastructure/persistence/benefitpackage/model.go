package benefitpackage

import (
	"time"

	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

type packageRow struct {
	ID                       persistenceid.UUID    `gorm:"primaryKey"`
	TenantID                 string                `gorm:"size:64;not null;index:idx_packages_tenant,priority:1;uniqueIndex:uniq_packages_tenant_name_active,priority:1"`
	IsPreset                 bool                  `gorm:"not null;default:false;index:idx_packages_tenant,priority:2"`
	Name                     string                `gorm:"size:80;not null;uniqueIndex:uniq_packages_tenant_name_active,priority:2"`
	ProjectName              string                `gorm:"size:128;not null"`
	AssetGroupID             string                `gorm:"size:128;not null;uniqueIndex:uniq_packages_asset_group_active,priority:1"`
	EncryptedAccessKeyID     string                `gorm:"type:text;not null"`
	EncryptedSecretAccessKey string                `gorm:"type:text;not null"`
	Enabled                  bool                  `gorm:"not null;default:true"`
	ScopeType                string                `gorm:"size:32;not null"`
	Revision                 int64                 `gorm:"not null;default:1"`
	CreatedBy                string                `gorm:"size:64;not null"`
	UpdatedBy                string                `gorm:"size:64;not null"`
	CreatedAt                time.Time             `gorm:"not null"`
	UpdatedAt                time.Time             `gorm:"not null;index"`
	DeletedAt                soft_delete.DeletedAt `gorm:"softDelete:milli;index;uniqueIndex:uniq_packages_tenant_name_active,priority:3;uniqueIndex:uniq_packages_asset_group_active,priority:2"`
}

func (packageRow) TableName() string { return "packages" }

type packageModelRow struct {
	ID        uint64                `gorm:"primaryKey;autoIncrement"`
	TenantID  string                `gorm:"size:64;not null;uniqueIndex:uniq_package_models_tenant_model_active,priority:1;index:idx_package_models_package,priority:1"`
	PackageID persistenceid.UUID    `gorm:"not null;uniqueIndex:uniq_package_models_package_model_active,priority:1;index:idx_package_models_package,priority:2"`
	ModelID   string                `gorm:"size:128;not null;uniqueIndex:uniq_package_models_tenant_model_active,priority:2;uniqueIndex:uniq_package_models_package_model_active,priority:2"`
	CreatedAt time.Time             `gorm:"not null"`
	DeletedAt soft_delete.DeletedAt `gorm:"softDelete:milli;uniqueIndex:uniq_package_models_tenant_model_active,priority:3;uniqueIndex:uniq_package_models_package_model_active,priority:3;index:idx_package_models_package,priority:3"`
}

func (packageModelRow) TableName() string { return "package_models" }

// assetReviewRow records the current review submitted through a package.
// Provider configuration remains owned by packages and is never snapshotted here.
type assetReviewRow struct {
	ID                  persistenceid.UUID `gorm:"primaryKey"`
	TaskRunID           persistenceid.UUID `gorm:"not null;uniqueIndex"`
	TenantID            string             `gorm:"size:64;not null;index:idx_asset_reviews_package,priority:1;index:idx_asset_reviews_asset_scope,priority:1;uniqueIndex:uniq_asset_reviews_tenant_asset_package,priority:1"`
	WorkspaceID         *string            `gorm:"size:64;index:idx_asset_reviews_asset_scope,priority:2"`
	ProjectID           persistenceid.UUID `gorm:"not null"`
	PackageID           persistenceid.UUID `gorm:"not null;index:idx_asset_reviews_package,priority:2;uniqueIndex:uniq_asset_reviews_tenant_asset_package,priority:3"`
	PackageName         string             `gorm:"size:80;not null"`
	ScopeType           string             `gorm:"size:32;not null"`
	AssetID             persistenceid.UUID `gorm:"not null;index:idx_asset_reviews_asset_scope,priority:3;uniqueIndex:uniq_asset_reviews_tenant_asset_package,priority:2"`
	ProviderAssetID     string             `gorm:"size:128;not null;default:''"`
	Status              string             `gorm:"size:32;not null"`
	FailureReason       string             `gorm:"size:512;not null;default:''"`
	QuotaReservationID  string             `gorm:"size:64;not null;default:'';index"`
	SubmissionStartedAt *time.Time
	SubmittedAt         *time.Time            `gorm:"index:idx_asset_reviews_package,priority:3"`
	CreatedAt           time.Time             `gorm:"not null"`
	UpdatedAt           time.Time             `gorm:"not null"`
	DeletedAt           soft_delete.DeletedAt `gorm:"softDelete:milli;index:idx_asset_reviews_package,priority:4"`
}

func (assetReviewRow) TableName() string { return "asset_reviews" }

type assetReviewCleanupOutboxRow struct {
	ReviewID                 persistenceid.UUID `gorm:"primaryKey"`
	AssetID                  persistenceid.UUID `gorm:"not null;index"`
	PackageID                persistenceid.UUID `gorm:"not null;index:idx_asset_review_cleanup_package,priority:2"`
	TenantID                 string             `gorm:"size:64;not null;index:idx_asset_review_cleanup_package,priority:1"`
	ProviderAssetID          string             `gorm:"size:128;not null"`
	ProjectName              string             `gorm:"size:128;not null"`
	EncryptedAccessKeyID     string             `gorm:"type:text;not null"`
	EncryptedSecretAccessKey string             `gorm:"type:text;not null"`
	QuotaReservationID       string             `gorm:"size:64;not null;default:'';index"`
	Status                   string             `gorm:"size:16;not null;default:'pending';index:idx_asset_review_cleanup_due,priority:1;index:idx_asset_review_cleanup_package,priority:3"`
	NextAttemptAt            time.Time          `gorm:"not null;index:idx_asset_review_cleanup_due,priority:2"`
	LeaseUntil               *time.Time         `gorm:"index:idx_asset_review_cleanup_due,priority:3"`
	StateVersion             int64              `gorm:"not null"`
	Attempts                 int32              `gorm:"not null"`
	LastError                string             `gorm:"size:512;not null"`
	CreatedAt                time.Time          `gorm:"not null"`
	UpdatedAt                time.Time          `gorm:"not null"`
}

func (assetReviewCleanupOutboxRow) TableName() string { return "asset_review_cleanup_outbox" }

func Models() []any {
	return []any{&packageRow{}, &packageModelRow{}, &assetReviewRow{}, &assetReviewCleanupOutboxRow{}}
}
