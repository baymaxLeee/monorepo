package persistence

import "time"

type AssetMatchRun struct {
	ID             string `gorm:"primaryKey"`
	CanvasID       string
	NodeID         string
	NodeRevision   int64
	OriginalPrompt string
	Candidates     string `gorm:"type:jsonb"`
	Applied        bool
	Error          string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func (AssetMatchRun) TableName() string { return "canvas_asset_match_runs" }
