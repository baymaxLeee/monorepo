package application

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/example/monorepo/iam/internal/application/contracts"
	"github.com/example/monorepo/iam/internal/bootstrap/config"
	"github.com/example/monorepo/iam/internal/domain"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/models"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/repositories"
	"github.com/example/monorepo/iam/internal/infrastructure/security"
)

type WorkspaceService struct {
	store *repositories.Store
	cfg   config.ServerConfig
}

func NewWorkspaceService(store *repositories.Store, cfg config.ServerConfig) *WorkspaceService {
	return &WorkspaceService{store: store, cfg: cfg}
}

// ListPublic returns the applyable workspace list as {id,name} only — no member
// counts, owners, or slugs leak to anonymous callers.
func (s *WorkspaceService) ListPublic(ctx context.Context) ([]contracts.WorkspaceSummary, error) {
	workspaces, err := s.store.ListWorkspaces(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]contracts.WorkspaceSummary, 0, len(workspaces))
	for _, workspace := range workspaces {
		out = append(out, contracts.WorkspaceSummary{TenantID: workspace.TenantID, ID: workspace.ID, Name: workspace.Name})
	}
	return out, nil
}

func (s *WorkspaceService) ListForAdmin(ctx context.Context) ([]contracts.WorkspaceAdminView, error) {
	rows, err := s.store.ListWorkspacesForAdmin(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]contracts.WorkspaceAdminView, 0, len(rows))
	for _, row := range rows {
		out = append(out, contracts.WorkspaceAdminView{
			TenantID: row.TenantID, ID: row.ID, Name: row.Name, Slug: row.Slug, OwnerUserID: row.OwnerUserID,
			SystemManaged: row.SystemManaged, JoinPolicy: row.JoinPolicy,
			MemberCount: row.MemberCount, CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return out, nil
}

// Create makes an workspace and its first active workspace_admin/owner. Exactly one of
// {existing OwnerUserID, inline owner account} must be supplied; the calling
// super_admin is not auto-joined.
func (s *WorkspaceService) Create(ctx context.Context, req contracts.CreateWorkspaceRequest, meta AuditMeta) (contracts.WorkspaceAdminView, error) {
	if _, err := s.store.TenantByID(ctx, strings.TrimSpace(req.TenantID)); err != nil {
		return contracts.WorkspaceAdminView{}, ErrInvalidWorkspace
	}
	name := strings.TrimSpace(req.Name)
	slug := domain.NormalizeSlug(req.Slug)
	if name == "" || !domain.ValidSlug(slug) {
		return contracts.WorkspaceAdminView{}, ErrInvalidWorkspace
	}
	hasExisting := strings.TrimSpace(req.OwnerUserID) != ""
	hasInline := strings.TrimSpace(req.OwnerAccount) != ""
	if hasExisting == hasInline {
		return contracts.WorkspaceAdminView{}, ErrInvalidWorkspace // exactly one owner source
	}
	now := time.Now().UTC()
	workspace := models.Workspace{
		TenantID: strings.TrimSpace(req.TenantID), ID: NewID(), Name: name, Slug: slug, JoinPolicy: "approval",
		CreatedAt: now, UpdatedAt: now,
	}
	if hasExisting {
		ownerID := strings.TrimSpace(req.OwnerUserID)
		if _, err := s.store.UserByID(ctx, ownerID); err != nil {
			return contracts.WorkspaceAdminView{}, ErrOwnerNotFound
		}
		workspace.OwnerUserID = ownerID
		if err := mutateWithAudit(ctx, s.store, auditEntry{
			Action: "workspace.create", Actor: meta.ActorUserID, Target: ownerID, Workspace: workspace.ID,
			After: map[string]any{"workspaceId": workspace.ID, "name": workspace.Name, "slug": workspace.Slug, "ownerUserId": ownerID}, Trace: meta.TraceID,
		}, func(txStore *repositories.Store) error {
			return txStore.CreateWorkspaceWithOwner(ctx, workspace, ownerID)
		}); err != nil {
			return contracts.WorkspaceAdminView{}, ErrConflict
		}
	} else {
		account := domain.NormalizeAccount(req.OwnerAccount)
		email := domain.NormalizeEmail(req.OwnerEmail)
		if !domain.ValidAccount(account) || !domain.ValidEmail(email) || len(req.OwnerPassword) < 6 {
			return contracts.WorkspaceAdminView{}, ErrInvalidWorkspace
		}
		hash, err := security.HashPassword(req.OwnerPassword)
		if err != nil {
			return contracts.WorkspaceAdminView{}, err
		}
		display := strings.TrimSpace(req.OwnerDisplayName)
		if display == "" {
			display = account
		}
		owner := models.User{
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
		workspace.OwnerUserID = owner.ID
		if err := mutateWithAudit(ctx, s.store, auditEntry{
			Action: "workspace.create", Actor: meta.ActorUserID, Target: owner.ID, Workspace: workspace.ID,
			After: map[string]any{"workspaceId": workspace.ID, "name": workspace.Name, "slug": workspace.Slug, "ownerUserId": owner.ID}, Trace: meta.TraceID,
		}, func(txStore *repositories.Store) error {
			return txStore.CreateWorkspaceWithNewOwner(ctx, workspace, owner, hash, s.cfg.GuestWorkspaceID)
		}); err != nil {
			return contracts.WorkspaceAdminView{}, ErrConflict
		}
	}
	return contracts.WorkspaceAdminView{
		TenantID: workspace.TenantID, ID: workspace.ID, Name: workspace.Name, Slug: workspace.Slug, OwnerUserID: workspace.OwnerUserID,
		JoinPolicy: workspace.JoinPolicy, MemberCount: 1, CreatedAt: workspace.CreatedAt.UTC().Format(time.RFC3339),
	}, nil
}

// CreateWorkspaceAdmin creates an account and makes it an active workspace_admin of workspaceID.
func (s *WorkspaceService) CreateWorkspaceAdmin(ctx context.Context, workspaceID string, req contracts.CreateWorkspaceAdminRequest, meta AuditMeta) (contracts.WorkspaceMemberView, error) {
	if _, err := s.store.WorkspaceByID(ctx, workspaceID); err != nil {
		return contracts.WorkspaceMemberView{}, ErrWorkspaceNotFound
	}
	account := domain.NormalizeAccount(req.Account)
	email := domain.NormalizeEmail(req.Email)
	if !domain.ValidAccount(account) || !domain.ValidEmail(email) || len(req.Password) < 6 {
		return contracts.WorkspaceMemberView{}, ErrInvalidRegistration
	}
	hash, err := security.HashPassword(req.Password)
	if err != nil {
		return contracts.WorkspaceMemberView{}, err
	}
	display := strings.TrimSpace(req.DisplayName)
	if display == "" {
		display = account
	}
	now := time.Now().UTC()
	user := models.User{
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
		Action: "workspace.admin.create", Actor: meta.ActorUserID, Target: user.ID, Workspace: workspaceID,
		After: map[string]any{"userId": user.ID, "account": user.Account, "role": "workspace_admin", "status": "active"}, Trace: meta.TraceID,
	}, func(txStore *repositories.Store) error {
		return txStore.CreateUserWithMembership(ctx, user, hash, s.cfg.GuestWorkspaceID, workspaceID, "workspace_admin", "active")
	}); err != nil {
		return contracts.WorkspaceMemberView{}, ErrConflict
	}
	return contracts.WorkspaceMemberView{
		UserID:      user.ID,
		Account:     user.Account,
		DisplayName: user.DisplayName,
		Email:       user.Email,
		Role:        "workspace_admin",
		Status:      "active",
		CreatedAt:   now.UTC().Format(time.RFC3339),
	}, nil
}

func (s *WorkspaceService) TransferOwner(ctx context.Context, workspaceID, newOwnerUserID string, meta AuditMeta) error {
	newOwnerUserID = strings.TrimSpace(newOwnerUserID)
	if newOwnerUserID == "" {
		return ErrInvalidWorkspace
	}
	var oldOwner string
	if workspace, err := s.store.WorkspaceByID(ctx, workspaceID); err == nil {
		oldOwner = workspace.OwnerUserID
	}
	err := mutateWithAudit(ctx, s.store, auditEntry{
		Action:    "workspace.owner.transfer",
		Actor:     meta.ActorUserID,
		Target:    newOwnerUserID,
		Workspace: workspaceID,
		Before:    map[string]any{"ownerUserId": oldOwner},
		After:     map[string]any{"ownerUserId": newOwnerUserID},
		Trace:     meta.TraceID,
	}, func(txStore *repositories.Store) error {
		if err := txStore.TransferOwner(ctx, workspaceID, newOwnerUserID); err != nil {
			return err
		}
		return txStore.RevokeUserRefreshTokens(ctx, newOwnerUserID)
	})
	return mapMembershipErr(err)
}

func (s *WorkspaceService) ListMembers(ctx context.Context, workspaceID, status string) ([]contracts.WorkspaceMemberView, error) {
	rows, err := s.store.ListWorkspaceMembers(ctx, workspaceID, strings.TrimSpace(status))
	if err != nil {
		return nil, err
	}
	out := make([]contracts.WorkspaceMemberView, 0, len(rows))
	for _, row := range rows {
		out = append(out, workspaceMemberView(row))
	}
	return out, nil
}

func (s *WorkspaceService) Approve(ctx context.Context, workspaceID, userID, reviewerID string, meta AuditMeta) error {
	beforeRole, beforeStatus, _ := s.store.MemberRoleStatus(ctx, workspaceID, userID)
	err := mutateWithAudit(ctx, s.store, auditEntry{
		Action:    "member.approve",
		Actor:     reviewerID,
		Target:    userID,
		Workspace: workspaceID,
		Before:    map[string]any{"role": beforeRole, "status": beforeStatus},
		After:     map[string]any{"status": "active"},
		Trace:     meta.TraceID,
	}, func(txStore *repositories.Store) error {
		if err := txStore.ApproveMembership(ctx, workspaceID, userID, reviewerID); err != nil {
			return err
		}
		return txStore.RevokeUserRefreshTokens(ctx, userID)
	})
	return mapMembershipErr(err)
}

func (s *WorkspaceService) Reject(ctx context.Context, workspaceID, userID, reviewerID, reason string, meta AuditMeta) error {
	reason = strings.TrimSpace(reason)
	beforeRole, beforeStatus, _ := s.store.MemberRoleStatus(ctx, workspaceID, userID)
	err := mutateWithAudit(ctx, s.store, auditEntry{
		Action:    "member.reject",
		Actor:     reviewerID,
		Target:    userID,
		Workspace: workspaceID,
		Before:    map[string]any{"role": beforeRole, "status": beforeStatus},
		After:     map[string]any{"status": "rejected"},
		Reason:    reason,
		Trace:     meta.TraceID,
	}, func(txStore *repositories.Store) error {
		if err := txStore.RejectMembership(ctx, workspaceID, userID, reviewerID, reason); err != nil {
			return err
		}
		return txStore.RevokeUserRefreshTokens(ctx, userID)
	})
	return mapMembershipErr(err)
}

func (s *WorkspaceService) SetMemberRole(ctx context.Context, workspaceID, userID, role string, meta AuditMeta) error {
	role = strings.TrimSpace(role)
	if !domain.ValidMemberRole(role) {
		return ErrInvalidRole
	}
	beforeRole, _, _ := s.store.MemberRoleStatus(ctx, workspaceID, userID)
	err := mutateWithAudit(ctx, s.store, auditEntry{
		Action:    "member.role.set",
		Actor:     meta.ActorUserID,
		Target:    userID,
		Workspace: workspaceID,
		Before:    map[string]any{"role": beforeRole},
		After:     map[string]any{"role": role},
		Trace:     meta.TraceID,
	}, func(txStore *repositories.Store) error {
		if err := txStore.SetMemberRole(ctx, workspaceID, userID, role); err != nil {
			return err
		}
		return txStore.RevokeUserRefreshTokens(ctx, userID)
	})
	return mapMembershipErr(err)
}

// Apply lets a user (re)apply to an workspace from none/rejected.
func (s *WorkspaceService) Apply(ctx context.Context, workspaceID, userID string, meta AuditMeta) error {
	workspace, err := s.store.WorkspaceByID(ctx, workspaceID)
	if err != nil {
		return ErrWorkspaceNotFound
	}
	if workspace.SystemManaged || workspace.JoinPolicy != "approval" {
		return ErrConflict
	}
	err = mutateWithAudit(ctx, s.store, auditEntry{
		Action: "member.apply", Actor: userID, Target: userID, Workspace: workspaceID,
		After: map[string]any{"status": "pending"}, Trace: meta.TraceID,
	}, func(txStore *repositories.Store) error {
		return txStore.ApplyMembership(ctx, workspaceID, userID)
	})
	return mapMembershipErr(err)
}

func workspaceMemberView(row repositories.WorkspaceMemberRow) contracts.WorkspaceMemberView {
	view := contracts.WorkspaceMemberView{
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
	case errors.Is(err, repositories.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, repositories.ErrConflict):
		return ErrConflict
	case errors.Is(err, repositories.ErrInvariant):
		return ErrInvariant
	case errors.Is(err, repositories.ErrNotActiveMember):
		return ErrNotActiveMember
	default:
		return err
	}
}

// ErrNotFound mirrors repositories.ErrNotFound at the service boundary for router
// mapping without importing crud there.
var ErrNotFound = errors.New("not found")
