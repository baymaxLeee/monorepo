package repositories

import (
	"context"

	"github.com/example/monorepo/iam/internal/application"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/sqlc"
)

func fromRole(row sqlc.Role) application.Role {
	return application.Role(row)
}

func (s *Store) EnsureRole(ctx context.Context, v application.Role) error {
	return s.q.EnsureRole(ctx, sqlc.EnsureRoleParams(v))
}

func (s *Store) RoleByID(ctx context.Context, id string) (application.Role, error) {
	row, err := s.q.RoleByID(ctx, id)
	return fromRole(row), missing(err)
}

func (s *Store) RoleByName(ctx context.Context, name string) (application.Role, error) {
	row, err := s.q.RoleByName(ctx, name)
	return fromRole(row), missing(err)
}

func (s *Store) ListRoles(ctx context.Context) ([]application.Role, error) {
	rows, err := s.q.ListRoles(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]application.Role, len(rows))
	for i, row := range rows {
		out[i] = fromRole(row)
	}
	return out, nil
}

func (s *Store) UserRoles(ctx context.Context, userID string) ([]application.Role, error) {
	rows, err := s.q.UserRoles(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]application.Role, len(rows))
	for i, row := range rows {
		out[i] = fromRole(row)
	}
	return out, nil
}

func (s *Store) CountUsersWithRole(ctx context.Context, roleName string) (int64, error) {
	return s.q.CountUsersWithRole(ctx, roleName)
}

func (s *Store) AssignRole(ctx context.Context, userID, roleID string) error {
	return s.q.AssignRole(ctx, sqlc.AssignRoleParams{UserID: userID, RoleID: roleID})
}

func (s *Store) RemoveRolePreservingSuperAdmin(ctx context.Context, userID, roleID string) error {
	return s.inTx(ctx, func(tx *Store) error {
		role, err := tx.q.LockRole(ctx, roleID)
		if err != nil {
			return missing(err)
		}
		if role.Name == "super_admin" {
			count, err := tx.q.CountEnabledWithRole(ctx, roleID)
			if err != nil {
				return err
			}
			if count <= 1 {
				return ErrInvariant
			}
		}
		count, err := tx.q.RemoveRole(ctx, sqlc.RemoveRoleParams{UserID: userID, RoleID: roleID})
		if err != nil {
			return err
		}
		if count == 0 {
			return ErrNotFound
		}
		return tx.RevokeUserRefreshTokens(ctx, userID)
	})
}
