package models

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
	ID     string `gorm:"type:char(26);primaryKey"`
	UserID string `gorm:"type:char(26);not null;index:idx_refresh_tokens_user_id"`
	// ActiveOrgID is the org this refresh session is bound to. NULL means no
	// active scope (pending/rejected member, or a super_admin who has not
	// selected an org). The access JWT's org_id/org_role is derived from this +
	// a live active-membership lookup, never from an implicit "first org".
	ActiveOrgID       *string    `gorm:"type:char(26)"`
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
	ID            string    `gorm:"type:char(26);primaryKey"`
	Name          string    `gorm:"type:varchar(120);not null"`
	Slug          string    `gorm:"type:varchar(64);not null;uniqueIndex:uq_organizations_slug"`
	OwnerUserID   string    `gorm:"type:char(26);not null;index:idx_organizations_owner"`
	SystemManaged bool      `gorm:"not null;default:false"`
	SystemKey     *string   `gorm:"type:varchar(32);uniqueIndex:uq_organizations_system_key"`
	JoinPolicy    string    `gorm:"type:varchar(16);not null;default:'approval'"`
	CreatedAt     time.Time `gorm:"type:datetime(6);not null"`
	UpdatedAt     time.Time `gorm:"type:datetime(6);not null"`
}

// OrganizationMember joins users to organizations. A user can belong to
// multiple orgs; each membership carries an explicit review status and an
// org-scoped role. A session binds exactly one active org — the DB never picks
// "the first membership" on the user's behalf.
//
// Role  ∈ {org_admin, member}          (org-scoped; orthogonal to platform role)
// Status ∈ {pending, active, rejected} (only active can bind a session org)
type OrganizationMember struct {
	OrgID           string     `gorm:"type:char(26);primaryKey"`
	UserID          string     `gorm:"type:char(26);primaryKey;index:idx_org_members_user"`
	Role            string     `gorm:"type:varchar(32);not null;default:'member'"`
	Status          string     `gorm:"type:varchar(16);not null;default:'pending'"`
	ReviewedBy      *string    `gorm:"type:char(26)"`
	ReviewedAt      *time.Time `gorm:"type:datetime(6)"`
	RejectionReason *string    `gorm:"type:varchar(255)"`
	CreatedAt       time.Time  `gorm:"type:datetime(6);not null"`
}

// IamAuditEvent is an append-only audit record for high-value identity
// operations (org creation, membership review, role/owner change, platform
// role change, active-org switch). No FKs to users/orgs: rows must survive
// deletion. Never store passwords, tokens, or credentials in before/after.
type IamAuditEvent struct {
	ID           string    `gorm:"type:char(26);primaryKey"`
	Action       string    `gorm:"type:varchar(64);not null;index:idx_iam_audit_action_created,priority:1"`
	ActorUserID  *string   `gorm:"type:char(26);index:idx_iam_audit_actor"`
	TargetUserID *string   `gorm:"type:char(26)"`
	OrgID        *string   `gorm:"type:char(26);index:idx_iam_audit_org"`
	BeforeJSON   *string   `gorm:"type:json"`
	AfterJSON    *string   `gorm:"type:json"`
	Result       string    `gorm:"type:varchar(16);not null"`
	Reason       *string   `gorm:"type:varchar(255)"`
	TraceID      *string   `gorm:"type:varchar(64)"`
	CreatedAt    time.Time `gorm:"type:datetime(6);not null;index:idx_iam_audit_action_created,priority:2"`
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

func (IamAuditEvent) TableName() string {
	return "iam_audit_events"
}
