package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/example/monorepo/iam/internal/config"
	"github.com/example/monorepo/iam/internal/crud"
	"github.com/example/monorepo/iam/internal/model"
	"github.com/example/monorepo/iam/internal/schema"
	"github.com/example/monorepo/iam/internal/security"
)

type OrgService struct {
	store *crud.Store
	cfg   config.Config
}

func NewOrgService(store *crud.Store, cfg config.Config) *OrgService {
	return &OrgService{store: store, cfg: cfg}
}

// ListPublic returns the applyable org list as {id,name} only — no member
// counts, owners, or slugs leak to anonymous callers.
func (s *OrgService) ListPublic(ctx context.Context) ([]schema.OrgSummary, error) {
	orgs, err := s.store.ListOrganizations(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]schema.OrgSummary, 0, len(orgs))
	for _, org := range orgs {
		out = append(out, schema.OrgSummary{ID: org.ID, Name: org.Name})
	}
	return out, nil
}

func (s *OrgService) ListForAdmin(ctx context.Context) ([]schema.OrgAdminView, error) {
	rows, err := s.store.ListOrganizationsForAdmin(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]schema.OrgAdminView, 0, len(rows))
	for _, row := range rows {
		out = append(out, schema.OrgAdminView{
			ID: row.ID, Name: row.Name, Slug: row.Slug, OwnerUserID: row.OwnerUserID,
			SystemManaged: row.SystemManaged, JoinPolicy: row.JoinPolicy,
			MemberCount: row.MemberCount, CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return out, nil
}

// Create makes an org and its first active org_admin/owner. Exactly one of
// {existing OwnerUserID, inline owner account} must be supplied; the calling
// super_admin is not auto-joined.
func (s *OrgService) Create(ctx context.Context, req schema.CreateOrgRequest, meta AuditMeta) (schema.OrgAdminView, error) {
	name := strings.TrimSpace(req.Name)
	slug := normalizeSlug(req.Slug)
	if name == "" || !validSlug(slug) {
		return schema.OrgAdminView{}, ErrInvalidOrg
	}
	hasExisting := strings.TrimSpace(req.OwnerUserID) != ""
	hasInline := strings.TrimSpace(req.OwnerAccount) != ""
	if hasExisting == hasInline {
		return schema.OrgAdminView{}, ErrInvalidOrg // exactly one owner source
	}
	now := time.Now().UTC()
	org := model.Organization{
		ID: NewID(), Name: name, Slug: slug, JoinPolicy: "approval",
		CreatedAt: now, UpdatedAt: now,
	}
	if hasExisting {
		ownerID := strings.TrimSpace(req.OwnerUserID)
		if _, err := s.store.UserByID(ctx, ownerID); err != nil {
			return schema.OrgAdminView{}, ErrOwnerNotFound
		}
		org.OwnerUserID = ownerID
		if err := mutateWithAudit(ctx, s.store, auditEntry{
			Action: "org.create", Actor: meta.ActorUserID, Target: ownerID, Org: org.ID,
			After: map[string]any{"orgId": org.ID, "name": org.Name, "slug": org.Slug, "ownerUserId": ownerID}, Trace: meta.TraceID,
		}, func(txStore *crud.Store) error {
			return txStore.CreateOrganizationWithOwner(ctx, org, ownerID)
		}); err != nil {
			return schema.OrgAdminView{}, ErrConflict
		}
	} else {
		account := NormalizeAccount(req.OwnerAccount)
		email := NormalizeEmail(req.OwnerEmail)
		if !ValidAccount(account) || !ValidEmail(email) || len(req.OwnerPassword) < 6 {
			return schema.OrgAdminView{}, ErrInvalidOrg
		}
		hash, err := security.HashPassword(req.OwnerPassword)
		if err != nil {
			return schema.OrgAdminView{}, err
		}
		display := strings.TrimSpace(req.OwnerDisplayName)
		if display == "" {
			display = account
		}
		owner := model.User{
			ID:              NewID(),
			Account:         account,
			Email:           email,
			EmailNormalized: email,
			DisplayName:     display,
			Locale:          "zh-CN",
			Timezone:        "Asia/Shanghai",
			Theme:           "system",
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		org.OwnerUserID = owner.ID
		if err := mutateWithAudit(ctx, s.store, auditEntry{
			Action: "org.create", Actor: meta.ActorUserID, Target: owner.ID, Org: org.ID,
			After: map[string]any{"orgId": org.ID, "name": org.Name, "slug": org.Slug, "ownerUserId": owner.ID}, Trace: meta.TraceID,
		}, func(txStore *crud.Store) error {
			return txStore.CreateOrganizationWithNewOwner(ctx, org, owner, hash, s.cfg.GuestOrgID)
		}); err != nil {
			return schema.OrgAdminView{}, ErrConflict
		}
	}
	return schema.OrgAdminView{
		ID: org.ID, Name: org.Name, Slug: org.Slug, OwnerUserID: org.OwnerUserID,
		JoinPolicy: org.JoinPolicy, MemberCount: 1, CreatedAt: org.CreatedAt.UTC().Format(time.RFC3339),
	}, nil
}

// CreateOrgAdmin creates an account and makes it an active org_admin of orgID.
func (s *OrgService) CreateOrgAdmin(ctx context.Context, orgID string, req schema.CreateOrgAdminRequest, meta AuditMeta) (schema.OrgMemberView, error) {
	if _, err := s.store.OrganizationByID(ctx, orgID); err != nil {
		return schema.OrgMemberView{}, ErrOrgNotFound
	}
	account := NormalizeAccount(req.Account)
	email := NormalizeEmail(req.Email)
	if !ValidAccount(account) || !ValidEmail(email) || len(req.Password) < 6 {
		return schema.OrgMemberView{}, ErrInvalidRegistration
	}
	hash, err := security.HashPassword(req.Password)
	if err != nil {
		return schema.OrgMemberView{}, err
	}
	display := strings.TrimSpace(req.DisplayName)
	if display == "" {
		display = account
	}
	now := time.Now().UTC()
	user := model.User{
		ID:              NewID(),
		Account:         account,
		Email:           email,
		EmailNormalized: email,
		DisplayName:     display,
		Locale:          "zh-CN",
		Timezone:        "Asia/Shanghai",
		Theme:           "system",
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := mutateWithAudit(ctx, s.store, auditEntry{
		Action: "org.admin.create", Actor: meta.ActorUserID, Target: user.ID, Org: orgID,
		After: map[string]any{"userId": user.ID, "account": user.Account, "role": "org_admin", "status": "active"}, Trace: meta.TraceID,
	}, func(txStore *crud.Store) error {
		return txStore.CreateUserWithMembership(ctx, user, hash, s.cfg.GuestOrgID, orgID, "org_admin", "active")
	}); err != nil {
		return schema.OrgMemberView{}, ErrConflict
	}
	return schema.OrgMemberView{
		UserID:      user.ID,
		Account:     user.Account,
		DisplayName: user.DisplayName,
		Email:       user.Email,
		Role:        "org_admin",
		Status:      "active",
		CreatedAt:   now.UTC().Format(time.RFC3339),
	}, nil
}

func (s *OrgService) TransferOwner(ctx context.Context, orgID, newOwnerUserID string, meta AuditMeta) error {
	newOwnerUserID = strings.TrimSpace(newOwnerUserID)
	if newOwnerUserID == "" {
		return ErrInvalidOrg
	}
	var oldOwner string
	if org, err := s.store.OrganizationByID(ctx, orgID); err == nil {
		oldOwner = org.OwnerUserID
	}
	err := mutateWithAudit(ctx, s.store, auditEntry{
		Action: "org.owner.transfer",
		Actor:  meta.ActorUserID,
		Target: newOwnerUserID,
		Org:    orgID,
		Before: map[string]any{"ownerUserId": oldOwner},
		After:  map[string]any{"ownerUserId": newOwnerUserID},
		Trace:  meta.TraceID,
	}, func(txStore *crud.Store) error {
		if err := txStore.TransferOwner(ctx, orgID, newOwnerUserID); err != nil {
			return err
		}
		return txStore.RevokeUserRefreshTokens(ctx, newOwnerUserID)
	})
	return mapMembershipErr(err)
}

func (s *OrgService) ListMembers(ctx context.Context, orgID, status string) ([]schema.OrgMemberView, error) {
	rows, err := s.store.ListOrgMembers(ctx, orgID, strings.TrimSpace(status))
	if err != nil {
		return nil, err
	}
	out := make([]schema.OrgMemberView, 0, len(rows))
	for _, row := range rows {
		out = append(out, orgMemberView(row))
	}
	return out, nil
}

func (s *OrgService) Approve(ctx context.Context, orgID, userID, reviewerID string, meta AuditMeta) error {
	beforeRole, beforeStatus, _ := s.store.MemberRoleStatus(ctx, orgID, userID)
	err := mutateWithAudit(ctx, s.store, auditEntry{
		Action: "member.approve",
		Actor:  reviewerID,
		Target: userID,
		Org:    orgID,
		Before: map[string]any{"role": beforeRole, "status": beforeStatus},
		After:  map[string]any{"status": "active"},
		Trace:  meta.TraceID,
	}, func(txStore *crud.Store) error {
		if err := txStore.ApproveMembership(ctx, orgID, userID, reviewerID); err != nil {
			return err
		}
		return txStore.RevokeUserRefreshTokens(ctx, userID)
	})
	return mapMembershipErr(err)
}

func (s *OrgService) Reject(ctx context.Context, orgID, userID, reviewerID, reason string, meta AuditMeta) error {
	reason = strings.TrimSpace(reason)
	beforeRole, beforeStatus, _ := s.store.MemberRoleStatus(ctx, orgID, userID)
	err := mutateWithAudit(ctx, s.store, auditEntry{
		Action: "member.reject",
		Actor:  reviewerID,
		Target: userID,
		Org:    orgID,
		Before: map[string]any{"role": beforeRole, "status": beforeStatus},
		After:  map[string]any{"status": "rejected"},
		Reason: reason,
		Trace:  meta.TraceID,
	}, func(txStore *crud.Store) error {
		if err := txStore.RejectMembership(ctx, orgID, userID, reviewerID, reason); err != nil {
			return err
		}
		return txStore.RevokeUserRefreshTokens(ctx, userID)
	})
	return mapMembershipErr(err)
}

func (s *OrgService) SetMemberRole(ctx context.Context, orgID, userID, role string, meta AuditMeta) error {
	role = strings.TrimSpace(role)
	if role != "org_admin" && role != "member" {
		return ErrInvalidRole
	}
	beforeRole, _, _ := s.store.MemberRoleStatus(ctx, orgID, userID)
	err := mutateWithAudit(ctx, s.store, auditEntry{
		Action: "member.role.set",
		Actor:  meta.ActorUserID,
		Target: userID,
		Org:    orgID,
		Before: map[string]any{"role": beforeRole},
		After:  map[string]any{"role": role},
		Trace:  meta.TraceID,
	}, func(txStore *crud.Store) error {
		if err := txStore.SetMemberRole(ctx, orgID, userID, role); err != nil {
			return err
		}
		return txStore.RevokeUserRefreshTokens(ctx, userID)
	})
	return mapMembershipErr(err)
}

// Apply lets a user (re)apply to an org from none/rejected.
func (s *OrgService) Apply(ctx context.Context, orgID, userID string, meta AuditMeta) error {
	org, err := s.store.OrganizationByID(ctx, orgID)
	if err != nil {
		return ErrOrgNotFound
	}
	if org.SystemManaged || org.JoinPolicy != "approval" {
		return ErrConflict
	}
	err = mutateWithAudit(ctx, s.store, auditEntry{
		Action: "member.apply", Actor: userID, Target: userID, Org: orgID,
		After: map[string]any{"status": "pending"}, Trace: meta.TraceID,
	}, func(txStore *crud.Store) error {
		return txStore.ApplyMembership(ctx, orgID, userID)
	})
	return mapMembershipErr(err)
}

func orgMemberView(row crud.OrgMemberRow) schema.OrgMemberView {
	view := schema.OrgMemberView{
		UserID:          row.UserID,
		Account:         row.Account,
		DisplayName:     row.DisplayName,
		Email:           row.Email,
		Role:            row.Role,
		Status:          row.Status,
		ReviewedBy:      row.ReviewedBy,
		RejectionReason: row.RejectionReason,
		CreatedAt:       row.CreatedAt.UTC().Format(time.RFC3339),
	}
	if row.ReviewedAt != nil {
		formatted := row.ReviewedAt.UTC().Format(time.RFC3339)
		view.ReviewedAt = &formatted
	}
	return view
}

func mapMembershipErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, crud.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, crud.ErrConflict):
		return ErrConflict
	case errors.Is(err, crud.ErrInvariant):
		return ErrInvariant
	case errors.Is(err, crud.ErrNotActiveMember):
		return ErrNotActiveMember
	default:
		return err
	}
}

// ErrNotFound mirrors crud.ErrNotFound at the service boundary for router
// mapping without importing crud there.
var ErrNotFound = errors.New("not found")

func normalizeSlug(slug string) string {
	return strings.ToLower(strings.TrimSpace(slug))
}

func validSlug(slug string) bool {
	if slug == "" || len(slug) > 64 {
		return false
	}
	return !strings.ContainsAny(slug, " \t\r\n@")
}
