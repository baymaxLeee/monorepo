package models

import (
	"time"

	"github.com/example/monorepo/iam/internal/application"
)

// Persistence reuses application-owned port records at the adapter boundary.
// GORM's conventional table/column mapping matches the existing schema; only
// adapter-private relationship records remain concrete here.
type User = application.User
type RefreshToken = application.RefreshToken
type Role = application.Role
type Tenant = application.Tenant
type Workspace = application.Workspace
type IamAuditEvent = application.IamAuditEvent

type UserCredential struct {
	UserID            string     `gorm:"type:varchar(26);primaryKey"`
	PasswordHash      string     `gorm:"type:varchar(255);not null"`
	PasswordChangedAt time.Time  `gorm:"type:datetime(6);not null"`
	FailedAttempts    int        `gorm:"not null;default:0"`
	LockedUntil       *time.Time `gorm:"type:datetime(6)"`
	CreatedAt         time.Time  `gorm:"type:datetime(6);not null"`
	UpdatedAt         time.Time  `gorm:"type:datetime(6);not null"`
	User              User       `gorm:"constraint:OnDelete:CASCADE;"`
}

type UserRole struct {
	UserID    string    `gorm:"type:varchar(26);primaryKey"`
	RoleID    string    `gorm:"type:varchar(26);primaryKey;index:idx_user_roles_role_id"`
	CreatedAt time.Time `gorm:"type:datetime(6);not null"`
	User      User      `gorm:"constraint:OnDelete:CASCADE;"`
	Role      Role      `gorm:"constraint:OnDelete:CASCADE;"`
}

type WorkspaceMember struct {
	WorkspaceID     string     `gorm:"type:varchar(26);primaryKey"`
	UserID          string     `gorm:"type:varchar(26);primaryKey;index:idx_workspace_members_user"`
	Role            string     `gorm:"type:varchar(32);not null;default:'member'"`
	Status          string     `gorm:"type:varchar(16);not null;default:'pending'"`
	ReviewedBy      *string    `gorm:"type:varchar(26)"`
	ReviewedAt      *time.Time `gorm:"type:datetime(6)"`
	RejectionReason *string    `gorm:"type:varchar(255)"`
	CreatedAt       time.Time  `gorm:"type:datetime(6);not null"`
}

func (UserCredential) TableName() string  { return "user_credentials" }
func (UserRole) TableName() string        { return "user_roles" }
func (WorkspaceMember) TableName() string { return "workspace_members" }
