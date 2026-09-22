package benefitpackage

import (
	"time"

	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

type assetReviewRow struct {
	ID                  persistenceid.UUID `gorm:"primaryKey"`
	TaskRunID           persistenceid.UUID `gorm:"not null;uniqueIndex"`
	TenantID            string             `gorm:"size:64;not null;index:idx_asset_reviews_scope,priority:1;uniqueIndex:uniq_asset_reviews_scope_asset_package,priority:1"`
	WorkspaceID         *string            `gorm:"size:64;not null;index:idx_asset_reviews_scope,priority:2;uniqueIndex:uniq_asset_reviews_scope_asset_package,priority:2"`
	ProjectID           persistenceid.UUID `gorm:"not null;index:idx_asset_reviews_scope,priority:3"`
	PackageID           string             `gorm:"size:64;not null;uniqueIndex:uniq_asset_reviews_scope_asset_package,priority:4"`
	PackageName         string             `gorm:"size:80;not null"`
	ModelIDs            []string           `gorm:"serializer:json;type:text;not null"`
	SystemPresetModels  bool               `gorm:"not null"`
	AssetID             persistenceid.UUID `gorm:"not null;index:idx_asset_reviews_scope,priority:4;uniqueIndex:uniq_asset_reviews_scope_asset_package,priority:3"`
	ProviderAssetID     string             `gorm:"size:128;not null;default:''"`
	ReservationID       string             `gorm:"size:64;not null;default:'';index"`
	Status              string             `gorm:"size:32;not null"`
	FailureReason       string             `gorm:"size:512;not null;default:''"`
	SubmissionStartedAt *time.Time
	SubmittedAt         *time.Time
	CreatedAt           time.Time             `gorm:"not null"`
	UpdatedAt           time.Time             `gorm:"not null"`
	DeletedAt           soft_delete.DeletedAt `gorm:"softDelete:milli"`
}

func (assetReviewRow) TableName() string { return "asset_reviews" }

type assetReviewCleanupOutboxRow struct {
	ReviewID        persistenceid.UUID `gorm:"primaryKey"`
	AssetID         persistenceid.UUID `gorm:"not null;index"`
	PackageID       string             `gorm:"size:64;not null"`
	TenantID        string             `gorm:"size:64;not null"`
	WorkspaceID     *string            `gorm:"size:64;not null"`
	ProviderAssetID string             `gorm:"size:128;not null;default:''"`
	ReservationID   string             `gorm:"size:64;not null"`
	Status          string             `gorm:"size:16;not null;default:'pending';index:idx_asset_review_cleanup_due,priority:1"`
	NextAttemptAt   time.Time          `gorm:"not null;index:idx_asset_review_cleanup_due,priority:2"`
	LeaseUntil      *time.Time         `gorm:"index:idx_asset_review_cleanup_due,priority:3"`
	StateVersion    int64              `gorm:"not null"`
	Attempts        int32              `gorm:"not null"`
	LastError       string             `gorm:"size:512;not null"`
	CreatedAt       time.Time          `gorm:"not null"`
	UpdatedAt       time.Time          `gorm:"not null"`
}

func (assetReviewCleanupOutboxRow) TableName() string { return "asset_review_cleanup_outbox" }

func Models() []any { return []any{&assetReviewRow{}, &assetReviewCleanupOutboxRow{}} }
