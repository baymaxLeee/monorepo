package model

import "time"

type User struct {
	ID              string     `gorm:"type:char(26);primaryKey"`
	Account         string     `gorm:"type:varchar(64);not null;uniqueIndex:uq_users_account"`
	Email           string     `gorm:"type:varchar(320);not null"`
	EmailNormalized string     `gorm:"type:varchar(320);not null;uniqueIndex:uq_users_email_normalized"`
	DisplayName     string     `gorm:"type:varchar(120);not null"`
	AvatarURL       string     `gorm:"type:varchar(2048);not null;default:''"`
	Phone           string     `gorm:"type:varchar(32);not null;default:''"`
	Locale          string     `gorm:"type:varchar(16);not null;default:'zh-CN'"`
	Timezone        string     `gorm:"type:varchar(64);not null;default:'Asia/Shanghai'"`
	Theme           string     `gorm:"type:varchar(20);not null;default:'system'"`
	MarketingOptIn  bool       `gorm:"not null;default:false"`
	EmailVerifiedAt *time.Time `gorm:"type:datetime(6)"`
	DisabledAt      *time.Time `gorm:"type:datetime(6)"`
	LastLoginAt     *time.Time `gorm:"type:datetime(6)"`
	CreatedAt       time.Time  `gorm:"type:datetime(6);not null;index:idx_users_created_at"`
	UpdatedAt       time.Time  `gorm:"type:datetime(6);not null"`
}

type UserCredential struct {
	UserID            string     `gorm:"type:char(26);primaryKey"`
	PasswordHash      string     `gorm:"type:varchar(255);not null"`
	PasswordChangedAt time.Time  `gorm:"type:datetime(6);not null"`
	FailedAttempts    int        `gorm:"not null;default:0"`
	LockedUntil       *time.Time `gorm:"type:datetime(6)"`
	CreatedAt         time.Time  `gorm:"type:datetime(6);not null"`
	UpdatedAt         time.Time  `gorm:"type:datetime(6);not null"`
	User              User       `gorm:"constraint:OnDelete:CASCADE;"`
}

type RefreshToken struct {
	ID                string     `gorm:"type:char(26);primaryKey"`
	UserID            string     `gorm:"type:char(26);not null;index:idx_refresh_tokens_user_id"`
	TokenHash         string     `gorm:"type:char(44);not null;uniqueIndex:uq_refresh_tokens_hash"`
	UserAgent         string     `gorm:"type:varchar(512);not null;default:''"`
	IPAddress         string     `gorm:"type:varchar(64);not null;default:''"`
	ExpiresAt         time.Time  `gorm:"type:datetime(6);not null;index:idx_refresh_tokens_expires_at"`
	RevokedAt         *time.Time `gorm:"type:datetime(6)"`
	CreatedAt         time.Time  `gorm:"type:datetime(6);not null"`
	LastUsedAt        *time.Time `gorm:"type:datetime(6)"`
	ReplacedByTokenID *string    `gorm:"type:char(26)"`
	User              User       `gorm:"constraint:OnDelete:CASCADE;"`
}

type Role struct {
	ID          string    `gorm:"type:char(26);primaryKey"`
	Name        string    `gorm:"type:varchar(64);not null;uniqueIndex:uq_roles_name"`
	Description string    `gorm:"type:varchar(255);not null;default:''"`
	CreatedAt   time.Time `gorm:"type:datetime(6);not null"`
	UpdatedAt   time.Time `gorm:"type:datetime(6);not null"`
}

type UserRole struct {
	UserID    string    `gorm:"type:char(26);primaryKey"`
	RoleID    string    `gorm:"type:char(26);primaryKey;index:idx_user_roles_role_id"`
	CreatedAt time.Time `gorm:"type:datetime(6);not null"`
	User      User      `gorm:"constraint:OnDelete:CASCADE;"`
	Role      Role      `gorm:"constraint:OnDelete:CASCADE;"`
}

// Organization is the team tenant that owns shared resources (knowledge base,
// bots). It is deliberately distinct from any future desktop-client
// "workspace" (a local working context), which is an orthogonal concept.
type Organization struct {
	ID          string    `gorm:"type:char(26);primaryKey"`
	Name        string    `gorm:"type:varchar(120);not null"`
	Slug        string    `gorm:"type:varchar(64);not null;uniqueIndex:uq_organizations_slug"`
	OwnerUserID string    `gorm:"type:char(26);not null;index:idx_organizations_owner"`
	CreatedAt   time.Time `gorm:"type:datetime(6);not null"`
	UpdatedAt   time.Time `gorm:"type:datetime(6);not null"`
}

// OrganizationMember joins users to organizations. Modeled as a join table so a
// user can belong to multiple orgs later; the MVP seeds a single membership per
// user and treats it as the active org.
type OrganizationMember struct {
	OrgID     string    `gorm:"type:char(26);primaryKey"`
	UserID    string    `gorm:"type:char(26);primaryKey;index:idx_org_members_user"`
	Role      string    `gorm:"type:varchar(32);not null;default:'member'"`
	CreatedAt time.Time `gorm:"type:datetime(6);not null"`
}

func (UserCredential) TableName() string {
	return "user_credentials"
}

func (RefreshToken) TableName() string {
	return "refresh_tokens"
}

func (UserRole) TableName() string {
	return "user_roles"
}

func (Organization) TableName() string {
	return "organizations"
}

func (OrganizationMember) TableName() string {
	return "organization_members"
}
