package projectusage

import (
	"time"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

type aigwCallRow struct {
	TaskRunID        persistenceid.UUID `gorm:"primaryKey"`
	CallOrdinal      int32              `gorm:"primaryKey"`
	CallType         string             `gorm:"size:64;not null"`
	ProjectID        persistenceid.UUID `gorm:"not null"`
	ModelID          string             `gorm:"size:128;not null"`
	ModelName        string             `gorm:"size:255;not null"`
	ModelSource      string             `gorm:"size:128;not null"`
	RequestStartedAt *time.Time
	RequestID        *string   `gorm:"size:191;uniqueIndex:idx_task_run_aigw_calls_request"`
	CaptureResult    *string   `gorm:"size:32"`
	BillingStatus    string    `gorm:"size:32;not null"`
	SettlementReason *string   `gorm:"size:32"`
	Amount           *string   `gorm:"type:decimal(38,18)"`
	Currency         *string   `gorm:"size:16"`
	ReviewReason     string    `gorm:"type:text;not null"`
	StateVersion     int64     `gorm:"not null"`
	CreatedAt        time.Time `gorm:"not null"`
	UpdatedAt        time.Time `gorm:"not null"`
	FinalizedAt      *time.Time
}

func (aigwCallRow) TableName() string { return "task_run_aigw_calls" }

type usageRecordRow struct {
	TaskRunID               persistenceid.UUID `gorm:"primaryKey;index:idx_project_usage_export,priority:5;index:idx_project_usage_name_due,priority:3"`
	TenantID                string             `gorm:"size:64;not null;index:idx_project_usage_export,priority:1"`
	WorkspaceID             *string            `gorm:"size:64;index:idx_project_usage_export,priority:2"`
	ProjectID               persistenceid.UUID `gorm:"not null;index:idx_project_usage_export,priority:3"`
	TaskType                string             `gorm:"column:run_type;size:64;not null"`
	ResourceType            string             `gorm:"size:64;not null"`
	ModelID                 string             `gorm:"size:128;not null"`
	ModelName               string             `gorm:"size:255;not null"`
	ModelSource             string             `gorm:"size:128;not null"`
	CreatedBy               string             `gorm:"size:64;not null"`
	CreatedByName           string             `gorm:"size:191;not null"`
	CreatedByNameResolvedAt *time.Time         `gorm:"index:idx_project_usage_name_due,priority:1"`
	ConsumedAt              time.Time          `gorm:"not null;index:idx_project_usage_export,priority:4"`
	CallCount               int32              `gorm:"not null"`
	FinalCallCount          int32              `gorm:"not null"`
	BillingStatus           string             `gorm:"size:32;not null;index:idx_project_usage_due,priority:1"`
	TotalAmount             *string            `gorm:"type:decimal(38,18)"`
	Currency                *string            `gorm:"size:16"`
	BillingAttempts         int32              `gorm:"not null"`
	NoProgressAttempts      int32              `gorm:"not null"`
	NextAttemptAt           *time.Time         `gorm:"index:idx_project_usage_due,priority:2"`
	LeaseOwner              string             `gorm:"size:128;not null"`
	LeaseUntil              *time.Time
	StateVersion            int64     `gorm:"not null"`
	ReviewReason            string    `gorm:"type:text;not null"`
	CreatedAt               time.Time `gorm:"not null;index:idx_project_usage_name_due,priority:2"`
	UpdatedAt               time.Time `gorm:"not null"`
	BillingFinalizedAt      *time.Time
}

func (usageRecordRow) TableName() string { return "project_usage_records" }

func Models() []any { return []any{&aigwCallRow{}, &usageRecordRow{}} }
