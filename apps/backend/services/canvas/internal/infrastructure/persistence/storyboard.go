package persistence

import "time"

type StoryboardDraft struct {
	ID              string `gorm:"primaryKey"`
	CanvasID        string
	TenantID        string
	WorkspaceID     string
	UserID          string
	OperationID     string
	RequestHash     string
	Revision        int64
	Input           string `gorm:"type:jsonb"`
	Shots           string `gorm:"type:jsonb"`
	Status          string
	Error           string
	TaskID          string
	CancelRequested bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (StoryboardDraft) TableName() string { return "canvas_storyboard_sessions" }
