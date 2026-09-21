package canvasstoryboard

import (
	"time"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
)

type row struct {
	TaskRunID                    persistenceid.UUID `gorm:"primaryKey;index:idx_storyboard_drafts_current,priority:7,sort:desc"`
	TenantID                     string             `gorm:"size:64;not null;index:idx_storyboard_drafts_current,priority:1"`
	WorkspaceID                  *string            `gorm:"size:64;index:idx_storyboard_drafts_current,priority:2"`
	ProjectID                    persistenceid.UUID `gorm:"not null;index:idx_storyboard_drafts_current,priority:3"`
	CanvasID                     persistenceid.UUID `gorm:"not null;index:idx_storyboard_drafts_current,priority:4"`
	CreatedBy                    string             `gorm:"size:64;not null;index:idx_storyboard_drafts_current,priority:5"`
	ResolvedAt                   *time.Time         `gorm:"index:idx_storyboard_drafts_current,priority:6"`
	Plot                         string             `gorm:"type:mediumtext;not null"`
	VideoModelServiceID          string             `gorm:"size:128;not null"`
	InferenceModelServiceID      string             `gorm:"size:128;not null;default:''"`
	VideoResolution              int16              `gorm:"not null"`
	VideoAspectRatio             int16              `gorm:"not null"`
	VideoGenerateAudio           bool               `gorm:"not null"`
	VideoWatermark               bool               `gorm:"not null"`
	CanvasNodeDurationMinSeconds int32              `gorm:"not null;default:0"`
	CanvasNodeDurationMaxSeconds int32              `gorm:"not null;default:0"`
	TotalDurationMinSeconds      int32              `gorm:"not null;default:0"`
	TotalDurationMaxSeconds      int32              `gorm:"not null;default:0"`
	MaxCanvasNodes               int32              `gorm:"not null"`
	ProtocolVersion              int32              `gorm:"not null;default:1"`
	SourceBeatsJSON              *string            `gorm:"type:mediumtext"`
	PlanJSON                     *string            `gorm:"type:mediumtext"`
	// LegacyNextCallOrdinal preserves the released schema until a later contract migration.
	// Runtime ordinal decisions are owned exclusively by StoryboardModelCallLedger.
	LegacyNextCallOrdinal int32  `gorm:"column:next_call_ordinal;not null;default:0;->:false;<-:false"`
	Status                string `gorm:"size:32;not null"`
	DraftsJSON            string `gorm:"type:mediumtext;not null"`
	DiagnosticsJSON       string `gorm:"type:mediumtext;not null"`
	ErrorCode             string `gorm:"size:128;not null"`
	ErrorMessage          string `gorm:"type:text;not null"`
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

func (row) TableName() string { return "canvas_storyboard_drafts" }

func Models() []any { return []any{&row{}} }
