package imagegeneration

import (
	"time"

	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

type runRow struct {
	TaskRunID           persistenceid.UUID            `gorm:"primaryKey"`
	TargetType          string                        `gorm:"size:64;not null;index:idx_image_generation_run_target,priority:1"`
	TargetID            persistenceid.UUID            `gorm:"not null;index:idx_image_generation_run_target,priority:2"`
	TargetRevision      int64                         `gorm:"not null"`
	TenantID            string                        `gorm:"size:64;not null;index:idx_image_generation_runs_scope,priority:1"`
	InvocationProjectID string                        `gorm:"size:64;not null;index"`
	WorkspaceID         *string                       `gorm:"size:64;index:idx_image_generation_runs_scope,priority:2"`
	Prompt              string                        `gorm:"type:mediumtext;not null"`
	ModelID             string                        `gorm:"size:128;not null"`
	Resolution          string                        `gorm:"size:16;not null"`
	AspectRatio         string                        `gorm:"size:16;not null"`
	Watermark           bool                          `gorm:"not null"`
	InputSnapshots      []domaingenerationinput.Input `gorm:"type:json;serializer:json"`
	OutputOwnerType     int16                         `gorm:"not null"`
	OutputOwnerID       persistenceid.UUID            `gorm:"not null"`
	BindingOutcome      string                        `gorm:"size:32;not null"`
	Stage               string                        `gorm:"size:32;not null"`
	ProviderAttempt     int32                         `gorm:"not null"`
	ProviderImageURL    string                        `gorm:"type:text;not null"`
	SourceAssetID       string                        `gorm:"column:source_asset_id;size:128;not null"`
	SourceRevisionID    string                        `gorm:"column:source_revision_id;size:64;not null"`
	ArtifactSizeBytes   int64                         `gorm:"not null"`
	OutputAssetID       *persistenceid.UUID
	ErrorCode           string    `gorm:"size:128;not null"`
	ErrorMessage        string    `gorm:"type:text;not null"`
	CreatedBy           string    `gorm:"size:64;not null"`
	CreatedAt           time.Time `gorm:"not null;index"`
	UpdatedAt           time.Time `gorm:"not null"`
	CompletedAt         *time.Time
}

func (runRow) TableName() string { return "image_generation_runs" }

type runInputRow struct {
	ID         uint64             `gorm:"primaryKey;autoIncrement"`
	TaskRunID  persistenceid.UUID `gorm:"not null;uniqueIndex:uniq_image_generation_run_input_position,priority:1;uniqueIndex:uniq_image_generation_run_input_asset,priority:1;index"`
	Position   int32              `gorm:"not null;uniqueIndex:uniq_image_generation_run_input_position,priority:2"`
	SourceType string             `gorm:"size:32;not null"`
	AssetID    persistenceid.UUID `gorm:"not null;uniqueIndex:uniq_image_generation_run_input_asset,priority:2"`
}

func (runInputRow) TableName() string { return "image_generation_run_inputs" }

func Models() []any { return []any{&runRow{}, &runInputRow{}} }
