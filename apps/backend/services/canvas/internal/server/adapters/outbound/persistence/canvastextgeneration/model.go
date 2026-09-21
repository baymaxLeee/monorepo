package canvastextgeneration

import (
	"time"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/server/domain/generationinput"
)

type row struct {
	TaskRunID            persistenceid.UUID            `gorm:"primaryKey"`
	TenantID             string                        `gorm:"size:64;not null;index:idx_canvas_text_generation_scope,priority:1"`
	WorkspaceID          *string                       `gorm:"size:64;index:idx_canvas_text_generation_scope,priority:2"`
	ProjectID            persistenceid.UUID            `gorm:"not null;index"`
	CanvasID             persistenceid.UUID            `gorm:"not null;index"`
	NodeID               persistenceid.UUID            `gorm:"not null;index:idx_canvas_text_generation_node,priority:1"`
	CreatedBy            string                        `gorm:"size:64;not null"`
	Prompt               string                        `gorm:"type:mediumtext;not null"`
	ModelServiceID       string                        `gorm:"size:128;not null"`
	Inputs               []domaingenerationinput.Input `gorm:"type:json;serializer:json"`
	Content              string                        `gorm:"type:mediumtext;not null"`
	Status               string                        `gorm:"size:32;not null;index:idx_canvas_text_generation_node,priority:2"`
	ErrorCode            string                        `gorm:"size:128;not null"`
	ErrorMessage         string                        `gorm:"type:text;not null"`
	CreatedAt, UpdatedAt time.Time
	FinishedAt           *time.Time
}

func (row) TableName() string { return "canvas_text_generations" }
func Models() []any           { return []any{&row{}} }
