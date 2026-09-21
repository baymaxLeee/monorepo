package persistence

import "time"

type VideoFrames struct {
	ID              string `gorm:"primaryKey"`
	GenerationID    string
	TaskID          string
	Status          string
	CancelRequested bool
	FirstKey        string
	LastKey         string
	FirstSize       int64
	LastSize        int64
	FirstAssetID    string
	LastAssetID     string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (VideoFrames) TableName() string { return "canvas_video_frames" }
