package quota

import "time"

type usageCounterRow struct {
	ScopeType         string `gorm:"size:16;primaryKey"`
	ScopeID           string `gorm:"size:64;primaryKey"`
	ResourceType      string `gorm:"size:64;primaryKey"`
	UsedValue         int64  `gorm:"not null;default:0"`
	ReservedValue     int64  `gorm:"not null;default:0"`
	Revision          int64  `gorm:"not null;default:0"`
	ReportDirty       bool   `gorm:"not null;default:false;index:idx_resource_usage_report"`
	LastReportedValue int64  `gorm:"not null;default:0"`
	LastReportedAt    *time.Time
	ReportLeaseToken  string     `gorm:"size:64"`
	ReportLeaseUntil  *time.Time `gorm:"index:idx_resource_usage_report"`
	UpdatedAt         time.Time  `gorm:"not null"`
}

func (usageCounterRow) TableName() string { return "resource_usage_counters" }

type reservationRow struct {
	ID                  string    `gorm:"size:64;primaryKey"`
	TenantID            string    `gorm:"size:64;not null;index"`
	ResourceType        string    `gorm:"size:64;not null"`
	IdempotencyKey      string    `gorm:"size:191;not null;uniqueIndex"`
	ReservedValue       int64     `gorm:"not null"`
	WouldReject         bool      `gorm:"not null;default:false"`
	Status              string    `gorm:"size:16;not null"`
	StateVersion        int64     `gorm:"not null;default:1"`
	PendingCleanupCount int64     `gorm:"not null;default:0"`
	TargetType          string    `gorm:"size:32;not null"`
	TargetID            string    `gorm:"size:64;not null;index"`
	ExpiresAt           time.Time `gorm:"not null;index"`
	CreatedAt           time.Time `gorm:"not null"`
	UpdatedAt           time.Time `gorm:"not null"`
}

func (reservationRow) TableName() string { return "resource_quota_reservations" }

type storageUsageLedgerRow struct {
	ObjectType   string  `gorm:"size:32;primaryKey"`
	ObjectKey    string  `gorm:"size:191;primaryKey"`
	TenantID     string  `gorm:"size:64;not null;index:idx_storage_ledger_active,priority:1"`
	WorkspaceID  *string `gorm:"size:64"`
	Category     string  `gorm:"size:32;not null"`
	OwnerType    string  `gorm:"size:32;not null;index"`
	OwnerID      string  `gorm:"size:64;not null;index"`
	SizeBytes    int64   `gorm:"not null"`
	BillingClass string  `gorm:"size:16;not null;index:idx_storage_ledger_active,priority:2"`
	Status       string  `gorm:"size:16;not null;index:idx_storage_ledger_active,priority:3"`
	CreatedAt    time.Time
	ReleasedAt   *time.Time
}

func (storageUsageLedgerRow) TableName() string { return "tenant_storage_usage_ledger" }

func Models() []any {
	return []any{&usageCounterRow{}, &reservationRow{}, &storageUsageLedgerRow{}}
}
