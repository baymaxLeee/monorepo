package contracts

import "time"

type AuthRequest struct {
	Account     string `json:"account"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl"`
	PhoneNumber string `json:"phoneNumber"`
	Locale      string `json:"locale"`
	Timezone    string `json:"timezone"`
	// OrgID is optional. Every user joins guest-org immediately; when supplied,
	// this is an additional approval-based organization application.
	OrgID string `json:"orgId"`
}

type AccountAvailabilityResponse struct {
	Account   string `json:"account"`
	Available bool   `json:"available"`
}

type AuthResponse struct {
	AccessToken string       `json:"accessToken"`
	ExpiresAt   time.Time    `json:"expiresAt"`
	User        UserResponse `json:"user"`
}

// Membership is the caller's own view of one org membership.
type Membership struct {
	OrgID   string `json:"orgId"`
	OrgName string `json:"orgName"`
	Role    string `json:"role"`   // org_admin | member
	Status  string `json:"status"` // pending | active | rejected
}

// UserResponse is the identity DTO. Platform `roles` and per-org
// `memberships` are orthogonal; `activeOrg` is the single org the current
// session is bound to (nil when unscoped). No flat orgId/orgName/type here —
// the two-dimensional model replaces them.
type UserResponse struct {
	ID             string       `json:"id"`
	Account        string       `json:"account"`
	Email          string       `json:"email"`
	DisplayName    string       `json:"displayName"`
	AvatarURL      string       `json:"avatarUrl"`
	Locale         string       `json:"locale"`
	Timezone       string       `json:"timezone"`
	Theme          string       `json:"theme"`
	MarketingOptIn bool         `json:"marketingOptIn"`
	EmailVerified  bool         `json:"emailVerified"`
	Roles          []string     `json:"roles"`
	ActiveOrg      *Membership  `json:"activeOrg"`
	Memberships    []Membership `json:"memberships"`
}

type AssignRoleRequest struct {
	RoleID string `json:"roleId"`
}

type RoleResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
}

// OrgSummary is the public, applyable org list item — deliberately free of
// management info (no member count, owner, or slug).
type OrgSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// OrgAdminView is the super_admin management-list item.
type OrgAdminView struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Slug          string `json:"slug"`
	OwnerUserID   string `json:"ownerUserId"`
	SystemManaged bool   `json:"systemManaged"`
	JoinPolicy    string `json:"joinPolicy"`
	MemberCount   int64  `json:"memberCount"`
	CreatedAt     string `json:"createdAt"`
}

// OrgMemberView is an org_admin's view of one member (approval UI).
type OrgMemberView struct {
	UserID          string  `json:"userId"`
	Account         string  `json:"account"`
	DisplayName     string  `json:"displayName"`
	Email           string  `json:"email"`
	Role            string  `json:"role"`
	Status          string  `json:"status"`
	ReviewedBy      *string `json:"reviewedBy,omitempty"`
	ReviewedAt      *string `json:"reviewedAt,omitempty"`
	RejectionReason *string `json:"rejectionReason,omitempty"`
	CreatedAt       string  `json:"createdAt"`
}

// CreateOrgRequest creates an org and its first owner in one transaction. The
// caller must supply exactly one of: an existing OwnerUserID, or an inline
// owner account (OwnerAccount + OwnerPassword ...). The calling super_admin is
// NOT auto-joined to the new org.
type CreateOrgRequest struct {
	Name             string `json:"name"`
	Slug             string `json:"slug"`
	OwnerUserID      string `json:"ownerUserId"`
	OwnerAccount     string `json:"ownerAccount"`
	OwnerEmail       string `json:"ownerEmail"`
	OwnerPassword    string `json:"ownerPassword"`
	OwnerDisplayName string `json:"ownerDisplayName"`
}

// CreateOrgAdminRequest creates an account and makes it an active org_admin of
// the target org (demo management flow).
type CreateOrgAdminRequest struct {
	Account     string `json:"account"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
}

type TransferOwnerRequest struct {
	NewOwnerUserID string `json:"newOwnerUserId"`
}

type RejectMemberRequest struct {
	Reason string `json:"reason"`
}

type SetMemberRoleRequest struct {
	Role string `json:"role"`
}

type SwitchOrgRequest struct {
	OrgID string `json:"orgId"`
}
