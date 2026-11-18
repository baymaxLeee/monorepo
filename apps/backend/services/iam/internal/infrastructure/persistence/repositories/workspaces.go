package repositories

import (
	"context"
	"errors"

	"github.com/example/monorepo/iam/internal/application"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"
)

func fromWorkspace(row sqlc.Workspace) application.Workspace {
	return application.Workspace{
		ID:            row.ID,
		Name:          row.Name,
		Slug:          row.Slug,
		OwnerUserID:   row.OwnerUserID,
		CreatedAt:     row.CreatedAt,
		UpdatedAt:     row.UpdatedAt,
		SystemManaged: row.SystemManaged,
		SystemKey:     row.SystemKey,
		JoinPolicy:    row.JoinPolicy,
		TenantID:      row.TenantID,
	}
}

func fromTenant(row sqlc.Tenant) application.Tenant {
	return application.Tenant(row)
}

func (s *Store) createWorkspace(ctx context.Context, v application.Workspace) error {
	return s.q.CreateWorkspace(ctx, sqlc.CreateWorkspaceParams{
		ID:            v.ID,
		Name:          v.Name,
		Slug:          v.Slug,
		OwnerUserID:   v.OwnerUserID,
		CreatedAt:     v.CreatedAt,
		UpdatedAt:     v.UpdatedAt,
		SystemManaged: v.SystemManaged,
		SystemKey:     v.SystemKey,
		JoinPolicy:    v.JoinPolicy,
		TenantID:      v.TenantID,
	})
}

func (s *Store) EnsureTenant(ctx context.Context, v application.Tenant) error {
	return s.q.EnsureTenant(ctx, sqlc.EnsureTenantParams(v))
}

func (s *Store) CreateTenant(ctx context.Context, v application.Tenant) error {
	return s.q.CreateTenant(ctx, sqlc.CreateTenantParams(v))
}

func (s *Store) EnsureWorkspace(ctx context.Context, v application.Workspace) error {
	return s.q.EnsureWorkspace(ctx, sqlc.EnsureWorkspaceParams{
		ID:            v.ID,
		Name:          v.Name,
		Slug:          v.Slug,
		OwnerUserID:   v.OwnerUserID,
		CreatedAt:     v.CreatedAt,
		UpdatedAt:     v.UpdatedAt,
		SystemManaged: v.SystemManaged,
		SystemKey:     v.SystemKey,
		JoinPolicy:    v.JoinPolicy,
		TenantID:      v.TenantID,
	})
}

func (s *Store) WorkspaceByID(ctx context.Context, id string) (application.Workspace, error) {
	row, err := s.q.WorkspaceByID(ctx, id)
	return fromWorkspace(row), missing(err)
}

func (s *Store) TenantByID(ctx context.Context, id string) (application.Tenant, error) {
	row, err := s.q.TenantByID(ctx, id)
	return fromTenant(row), missing(err)
}

func (s *Store) ListWorkspaces(ctx context.Context) ([]application.Workspace, error) {
	rows, err := s.q.ListWorkspaces(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]application.Workspace, len(rows))
	for i, row := range rows {
		out[i] = fromWorkspace(row)
	}
	return out, nil
}

func (s *Store) ListTenants(ctx context.Context) ([]application.Tenant, error) {
	rows, err := s.q.ListTenants(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]application.Tenant, len(rows))
	for i, row := range rows {
		out[i] = fromTenant(row)
	}
	return out, nil
}

func (s *Store) ListWorkspacesForAdmin(ctx context.Context) ([]application.WorkspaceAdminRow, error) {
	rows, err := s.q.ListWorkspacesForAdmin(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]application.WorkspaceAdminRow, len(rows))
	for i, row := range rows {
		out[i] = application.WorkspaceAdminRow{
			TenantID:      row.TenantID,
			ID:            row.ID,
			Name:          row.Name,
			Slug:          row.Slug,
			OwnerUserID:   row.OwnerUserID,
			JoinPolicy:    row.JoinPolicy,
			SystemManaged: row.SystemManaged,
			MemberCount:   row.MemberCount,
			CreatedAt:     row.CreatedAt,
		}
	}
	return out, nil
}

func (s *Store) CreateWorkspaceWithOwner(ctx context.Context, w application.Workspace, ownerID string) error {
	return s.inTx(ctx, func(tx *Store) error {
		if err := tx.createWorkspace(ctx, w); err != nil {
			return err
		}
		return tx.EnsureWorkspaceMember(ctx, w.ID, ownerID, "workspace_admin", "active")
	})
}
func (s *Store) CreateWorkspaceWithNewOwner(ctx context.Context, w application.Workspace, owner application.User, passwordHash, guestWorkspaceID string) error {
	return s.inTx(ctx, func(tx *Store) error {
		if err := tx.createAccount(ctx, owner, passwordHash); err != nil {
			return err
		}
		if err := tx.createWorkspace(ctx, w); err != nil {
			return err
		}
		if err := tx.EnsureWorkspaceMember(ctx, w.ID, owner.ID, "workspace_admin", "active"); err != nil {
			return err
		}
		return tx.q.AddGuestIfMissing(ctx, sqlc.AddGuestIfMissingParams{WorkspaceID: guestWorkspaceID, UserID: owner.ID, Role: "member", Status: "active"})
	})
}
func (s *Store) TransferOwner(ctx context.Context, workspaceID, newOwnerUserID string) error {
	return s.inTx(ctx, func(tx *Store) error {
		workspace, err := tx.q.LockWorkspace(ctx, workspaceID)
		if err != nil {
			return missing(err)
		}
		if workspace.SystemManaged {
			return ErrInvariant
		}
		_, err = tx.q.LockMember(ctx, sqlc.LockMemberParams{WorkspaceID: workspaceID, UserID: newOwnerUserID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvariant
		}
		if err != nil {
			return err
		}
		if err = tx.EnsureWorkspaceMember(ctx, workspaceID, newOwnerUserID, "workspace_admin", "active"); err != nil {
			return err
		}
		return tx.q.SetOwner(ctx, sqlc.SetOwnerParams{ID: workspaceID, OwnerUserID: newOwnerUserID})
	})
}
