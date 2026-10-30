package canvasnode

import (
	"encoding/json"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"time"
)

type eventHeadRow struct {
	CanvasID  persistenceid.UUID `gorm:"primaryKey"`
	Sequence  int64
	Data      json.RawMessage `gorm:"type:jsonb"`
	UpdatedAt time.Time
}

func (eventHeadRow) TableName() string { return "canvas_event_heads" }

type eventRow struct {
	CanvasID  persistenceid.UUID `gorm:"primaryKey"`
	Sequence  int64              `gorm:"primaryKey"`
	Data      json.RawMessage    `gorm:"type:jsonb"`
	CreatedAt time.Time
}

func (eventRow) TableName() string { return "canvas_events" }
