package application

import (
	"context"
	"errors"
	"time"
)

var (
	ErrStoreNotFound        = errors.New("not found")
	ErrStoreConflict        = errors.New("conflict")
	ErrStoreNotActiveMember = errors.New("not an active member")
	ErrStoreInvariant       = errors.New("operation violates an invariant")
)

// Store is the persistence port consumed by IAM use cases. Its types and
// transaction callback are owned here so application code never depends on the
// GORM repository implementation.
type Store interface {
	Transaction(context.Context, func(Store) error) error
	Ping(context.Context) error
	CreateUserWithMembership(context.Context, User, string, string, string, string, string) error
	CreateRegisteredUser(context.Context, User, string, string, string) error
	EnsureUserWithPassword(context.Context, User, string, string) error
	UserByAccount(context.Context, string) (User, string, error)
	UserExistsByAccount(context.Context, string) (bool, error)
	UserByID(context.Context, string) (User, error)
	CreateRefreshToken(context.Context, RefreshToken) error
	RotateRefreshToken(context.Context, string, RefreshToken) (User, *string, error)
	RotateRefreshTokenToWorkspace(context.Context, string, RefreshToken, string, string) (User, error)
	RevokeRefreshToken(context.Context, string) error
	MarkLogin(context.Context, string) error
	EnsureRole(context.Context, Role) error
	RoleByName(context.Context, string) (Role, error)
	ListRoles(context.Context) ([]Role, error)
	AssignRole(context.Context, string, string) error
	UserRoles(context.Context, string) ([]Role, error)
	EnsureWorkspace(context.Context, Workspace) error
	EnsureTenant(context.Context, Tenant) error
	EnsureAllUsersInGuestWorkspace(context.Context, string) error
	EnsureWorkspaceMember(context.Context, string, string, string, string) error
	RoleByID(context.Context, string) (Role, error)
	CountUsersWithRole(context.Context, string) (int64, error)
	WorkspaceByID(context.Context, string) (Workspace, error)
	ListWorkspaces(context.Context) ([]Workspace, error)
	ListWorkspacesForAdmin(context.Context) ([]WorkspaceAdminRow, error)
	CreateWorkspaceWithOwner(context.Context, Workspace, string) error
	CreateWorkspaceWithNewOwner(context.Context, Workspace, User, string, string) error
	TransferOwner(context.Context, string, string) error
	ListUserMemberships(context.Context, string) ([]MembershipRow, error)
	ActiveMembership(context.Context, string, string) (MembershipRow, error)
	ListWorkspaceMembers(context.Context, string, string) ([]WorkspaceMemberRow, error)
	MemberRoleStatus(context.Context, string, string) (string, string, error)
	ApplyMembership(context.Context, string, string) error
	ApproveMembership(context.Context, string, string, string) error
	RejectMembership(context.Context, string, string, string, string) error
	SetMemberRole(context.Context, string, string, string) error
	RemoveRolePreservingSuperAdmin(context.Context, string, string) error
	RevokeUserRefreshTokens(context.Context, string) error
	RecordAudit(context.Context, IamAuditEvent) error
	TenantByID(context.Context, string) (Tenant, error)
	ListTenants(context.Context) ([]Tenant, error)
	CreateTenant(context.Context, Tenant) error
}

type User struct {
	ID, Account, Email, EmailNormalized, DisplayName string
	AvatarURL, Phone, Locale, Timezone, Theme        string
	MarketingOptIn                                   bool
	EmailVerifiedAt, DisabledAt, LastLoginAt         *time.Time
	CreatedAt, UpdatedAt                             time.Time
}

type RefreshToken struct {
	ID, UserID, TokenHash, UserAgent, IPAddress string
	ActiveWorkspaceID                           *string
	ExpiresAt, CreatedAt                        time.Time
	RevokedAt, LastUsedAt                       *time.Time
	ReplacedByTokenID                           *string
	User                                        User
}

type Role struct {
	ID, Name, Description string
	CreatedAt, UpdatedAt  time.Time
}

type Tenant struct {
	ID, Name, Slug       string
	CreatedAt, UpdatedAt time.Time
}

type Workspace struct {
	TenantID, ID, Name, Slug, OwnerUserID, JoinPolicy string
	SystemManaged                                     bool
	SystemKey                                         *string
	CreatedAt, UpdatedAt                              time.Time
}

type IamAuditEvent struct {
	ID, Action, Result                                                             string
	ActorUserID, TargetUserID, WorkspaceID, BeforeJSON, AfterJSON, Reason, TraceID *string
	CreatedAt                                                                      time.Time
}

type WorkspaceAdminRow struct {
	TenantID, ID, Name, Slug, OwnerUserID, JoinPolicy string
	SystemManaged                                     bool
	MemberCount                                       int64
	CreatedAt                                         time.Time
}

type MembershipRow struct {
	TenantID, WorkspaceID, WorkspaceName, Role, Status string
}

type WorkspaceMemberRow struct {
	UserID, Account, DisplayName, Email, Role, Status string
	ReviewedBy, RejectionReason                       *string
	ReviewedAt                                        *time.Time
	CreatedAt                                         time.Time
}
