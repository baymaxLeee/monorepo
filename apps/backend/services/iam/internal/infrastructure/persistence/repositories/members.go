package repositories

import (
	"context"

	"github.com/example/monorepo/iam/internal/application"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/sqlc"
)

func (s *Store) ListUserMemberships(ctx context.Context, userID string) ([]application.MembershipRow, error) {
	rows, err := s.q.ListUserMemberships(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]application.MembershipRow, len(rows))
	for i, row := range rows {
		out[i] = application.MembershipRow{
			TenantID:      row.TenantID,
			WorkspaceID:   row.WorkspaceID,
			WorkspaceName: row.WorkspaceName,
			Role:          row.Role,
			Status:        row.Status,
		}
	}
	return out, nil
}

func (s *Store) ListWorkspaceMembers(ctx context.Context, workspaceID, statusFilter string) ([]application.WorkspaceMemberRow, error) {
	rows, err := s.q.ListWorkspaceMembers(ctx, sqlc.ListWorkspaceMembersParams{WorkspaceID: workspaceID, StatusFilter: statusFilter})
	if err != nil {
		return nil, err
	}
	out := make([]application.WorkspaceMemberRow, len(rows))
	for i, row := range rows {
		out[i] = application.WorkspaceMemberRow{
			UserID:          row.UserID,
			Account:         row.Account,
			DisplayName:     row.DisplayName,
			Email:           row.Email,
			Role:            row.Role,
			Status:          row.Status,
			ReviewedBy:      row.ReviewedBy,
			RejectionReason: row.RejectionReason,
			ReviewedAt:      row.ReviewedAt,
			CreatedAt:       row.CreatedAt,
		}
	}
	return out, nil
}

func (s *Store) EnsureAllUsersInGuestWorkspace(ctx context.Context, workspaceID string) error {
	return s.q.EnsureAllUsersInGuestWorkspace(ctx, workspaceID)
}

func (s *Store) EnsureWorkspaceMember(ctx context.Context, workspaceID, userID, role, status string) error {
	return s.q.EnsureWorkspaceMember(ctx, sqlc.EnsureWorkspaceMemberParams{WorkspaceID: workspaceID, UserID: userID, Role: role, Status: status})
}

func (s *Store) ApplyMembership(ctx context.Context, workspaceID, userID string) error {
	return transition(s.q.ApplyMembership(ctx, sqlc.ApplyMembershipParams{WorkspaceID: workspaceID, UserID: userID}))
}

func (s *Store) ApproveMembership(ctx context.Context, workspaceID, userID, reviewerID string) error {
	return transition(s.q.ApproveMembership(ctx, sqlc.ApproveMembershipParams{WorkspaceID: workspaceID, UserID: userID, ReviewedBy: &reviewerID}))
}

func (s *Store) RejectMembership(ctx context.Context, workspaceID, userID, reviewerID, reason string) error {
	return transition(s.q.RejectMembership(ctx, sqlc.RejectMembershipParams{WorkspaceID: workspaceID, UserID: userID, ReviewedBy: &reviewerID, Reason: reason}))
}

func (s *Store) MemberRoleStatus(ctx context.Context, workspaceID, userID string) (string, string, error) {
	row, err := s.q.MemberRoleStatus(ctx, sqlc.MemberRoleStatusParams{WorkspaceID: workspaceID, UserID: userID})
	return row.Role, row.Status, missing(err)
}
func (s *Store) ActiveMembership(ctx context.Context, userID, workspaceID string) (application.MembershipRow, error) {
	row, err := s.q.ActiveMembership(ctx, sqlc.ActiveMembershipParams{UserID: userID, WorkspaceID: workspaceID})
	return application.MembershipRow(row), missing(err)
}

func (s *Store) SetMemberRole(ctx context.Context, workspaceID, userID, role string) error {
	if role != "workspace_admin" && role != "member" {
		return ErrInvariant
	}
	return s.inTx(ctx, func(tx *Store) error {
		w, err := tx.q.LockWorkspace(ctx, workspaceID)
		if err != nil {
			return missing(err)
		}
		m, err := tx.q.LockMember(ctx, sqlc.LockMemberParams{WorkspaceID: workspaceID, UserID: userID})
		if err != nil {
			return missing(err)
		}
		if m.Status != "active" {
			return ErrInvariant
		}
		if m.Role == role {
			return nil
		}
		if role == "member" {
			if w.OwnerUserID == userID {
				return ErrInvariant
			}
			count, err := tx.q.CountActiveAdmins(ctx, workspaceID)
			if err != nil {
				return err
			}
			if count <= 1 {
				return ErrInvariant
			}
		}
		return tx.q.SetActiveRole(ctx, sqlc.SetActiveRoleParams{WorkspaceID: workspaceID, UserID: userID, Role: role})
	})
}
