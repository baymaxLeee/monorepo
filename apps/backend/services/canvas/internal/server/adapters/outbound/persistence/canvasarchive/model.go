package canvasarchive

import (
	"encoding/json"
	"time"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
)

type canvasVideoArchiveExportRow struct {
	TaskRunID   persistenceid.UUID `gorm:"primaryKey;index:idx_canvas_video_archive_exports_scope,priority:5,sort:desc;index:idx_canvas_video_archive_exports_list,priority:6,sort:desc"`
	TenantID    string             `gorm:"size:64;not null;index:idx_canvas_video_archive_exports_scope,priority:1;index:idx_canvas_video_archive_exports_list,priority:1"`
	WorkspaceID *string            `gorm:"size:64;index:idx_canvas_video_archive_exports_scope,priority:2;index:idx_canvas_video_archive_exports_list,priority:2"`
	ProjectID   persistenceid.UUID `gorm:"not null;index:idx_canvas_video_archive_exports_scope,priority:3;index:idx_canvas_video_archive_exports_list,priority:3"`
	CanvasID    persistenceid.UUID `gorm:"not null;index:idx_canvas_video_archive_exports_scope,priority:4;index:idx_canvas_video_archive_exports_list,priority:4"`

	Status       string `gorm:"size:32;not null;index"`
	ErrorCode    string `gorm:"size:128;not null"`
	ErrorMessage string `gorm:"type:text;not null"`
	InputCount   int32  `gorm:"not null"`

	OutputFilename string `gorm:"size:255;not null"`
	OutputPath     string `gorm:"size:512;not null"`
	OutputSize     int64  `gorm:"not null"`
	OutputSHA256   string `gorm:"size:64;not null"`

	UploadID  string `gorm:"size:255;not null"`
	PartSize  int64  `gorm:"not null"`
	CreatedBy string `gorm:"size:64;not null"`

	RetentionStartedAt       *time.Time
	RetentionGuaranteedUntil *time.Time
	CleanupStatus            string     `gorm:"size:32;not null;index:idx_canvas_video_archive_cleanup_due,priority:1"`
	CleanupNextAt            *time.Time `gorm:"index:idx_canvas_video_archive_cleanup_due,priority:2"`
	CleanupLeaseUntil        *time.Time
	CleanupStateVersion      int64  `gorm:"not null"`
	CleanupAttempts          int32  `gorm:"not null"`
	CleanupLastError         string `gorm:"type:text;not null"`

	StartedAt  *time.Time
	FinishedAt *time.Time
	CreatedAt  time.Time `gorm:"not null;index:idx_canvas_video_archive_exports_scope,priority:6,sort:desc;index:idx_canvas_video_archive_exports_list,priority:5,sort:desc"`
	UpdatedAt  time.Time `gorm:"not null"`
}

func (canvasVideoArchiveExportRow) TableName() string {
	return "canvas_video_archive_exports"
}

type canvasVideoArchiveExportInputRow struct {
	TaskRunID persistenceid.UUID `gorm:"primaryKey"`
	Inputs    json.RawMessage    `gorm:"type:json;not null"`
	CreatedAt time.Time          `gorm:"not null"`
}

func (canvasVideoArchiveExportInputRow) TableName() string {
	return "canvas_video_archive_export_inputs"
}

func Models() []any {
	return []any{&canvasVideoArchiveExportRow{}, &canvasVideoArchiveExportInputRow{}}
}
