package videogeneration

import (
	"time"

	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

type canvasnodeVideoGenerationRow struct {
	TaskRunID                     persistenceid.UUID `gorm:"primaryKey;index:idx_canvasnode_video_generations_scope,priority:8,sort:desc"`
	TenantID                      string             `gorm:"size:64;not null;index:idx_canvasnode_video_generations_scope,priority:1"`
	WorkspaceID                   *string            `gorm:"size:64;index:idx_canvasnode_video_generations_scope,priority:2"`
	ProjectID                     persistenceid.UUID `gorm:"not null;index:idx_canvasnode_video_generations_scope,priority:3"`
	CanvasID                      persistenceid.UUID `gorm:"not null;index:idx_canvasnode_video_generations_scope,priority:4"`
	NodeID                        persistenceid.UUID `gorm:"not null;index:idx_canvasnode_video_generations_scope,priority:5"`
	HiddenAt                      *time.Time         `gorm:"index:idx_canvasnode_video_generations_scope,priority:6"`
	Status                        string             `gorm:"size:32;not null"`
	ProviderStatus                string             `gorm:"size:32;not null"`
	ModelServiceID                string             `gorm:"size:128;not null"`
	Resolution                    int16              `gorm:"not null"`
	AspectRatio                   int16              `gorm:"not null"`
	DurationSeconds               int32              `gorm:"not null"`
	OutputDurationSeconds         *int32
	GenerateAudio                 bool    `gorm:"not null"`
	Watermark                     bool    `gorm:"not null"`
	Prompt                        string  `gorm:"type:mediumtext;not null"`
	ProviderWorkspaceID           string  `gorm:"column:provider_workspace_id;size:128;not null"`
	ProviderTaskID                *string `gorm:"size:128;uniqueIndex:uniq_canvasnode_video_generation_provider_task"`
	SeedanceTaskID                *string `gorm:"column:real_task_id;size:128"`
	ProviderVideoURL              string  `gorm:"type:text;not null"`
	ProviderErrorCode             string  `gorm:"size:128;not null"`
	ProviderErrorMessage          string  `gorm:"type:text;not null"`
	AssetID                       *persistenceid.UUID
	FirstLastFrameTaskRunID       *string `gorm:"size:64;uniqueIndex"`
	FirstFrameCheckpointID        *string `gorm:"size:64"`
	LastFrameCheckpointID         *string `gorm:"size:64"`
	FirstFrameCheckpointSizeBytes int64   `gorm:"not null;default:0"`
	LastFrameCheckpointSizeBytes  int64   `gorm:"not null;default:0"`
	FirstFrameAssetID             *persistenceid.UUID
	LastFrameAssetID              *persistenceid.UUID
	Inputs                        []domaingenerationinput.Input `gorm:"type:json;serializer:json"`
	ErrorMessage                  string                        `gorm:"type:text;not null"`
	CreatedBy                     string                        `gorm:"size:64;not null"`
	CompletedAt                   *time.Time
	CreatedAt                     time.Time `gorm:"not null;index:idx_canvasnode_video_generations_scope,priority:7,sort:desc"`
	UpdatedAt                     time.Time `gorm:"not null"`
}

func (canvasnodeVideoGenerationRow) TableName() string { return "canvas_node_generations" }

func Models() []any {
	return []any{&canvasnodeVideoGenerationRow{}}
}
