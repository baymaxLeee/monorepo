package persistence

import "time"

type CanvasView struct {
	CanvasID  string `gorm:"primaryKey"`
	UserID    string `gorm:"primaryKey"`
	X         float64
	Y         float64
	Zoom      float64
	UpdatedAt time.Time
}

func (CanvasView) TableName() string { return "canvas_views" }
