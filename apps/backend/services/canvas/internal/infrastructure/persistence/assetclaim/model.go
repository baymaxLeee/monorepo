package assetclaim

import "time"

type intentRow struct {
	TenantID      string `gorm:"size:64;primaryKey"`
	WorkspaceID   string `gorm:"size:64;primaryKey"`
	OwnerType     string `gorm:"size:64;primaryKey"`
	OwnerID       string `gorm:"size:128;primaryKey"`
	Slot          string `gorm:"size:64;primaryKey"`
	AssetID       string `gorm:"size:64;not null;default:''"`
	RevisionID    string `gorm:"size:64;not null;default:''"`
	Kind          string `gorm:"size:16;not null;default:'strong'"`
	Generation    int64  `gorm:"not null"`
	DesiredState  string `gorm:"size:16;not null"`
	DeliveredAt   *time.Time
	ExpiresAt     *time.Time
	NextAttemptAt time.Time  `gorm:"not null;index:idx_asset_claim_intents_due,priority:2"`
	LeaseUntil    *time.Time `gorm:"index:idx_asset_claim_intents_due,priority:3"`
	StateVersion  int64      `gorm:"not null"`
	Attempts      int32      `gorm:"not null"`
	LastError     string     `gorm:"size:512;not null"`
	CreatedAt     time.Time  `gorm:"not null"`
	UpdatedAt     time.Time  `gorm:"not null"`
}

func (intentRow) TableName() string { return "asset_claim_intents" }
func Models() []any                 { return []any{&intentRow{}} }
