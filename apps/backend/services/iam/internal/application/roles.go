package application

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/example/monorepo/iam/internal/application/contracts"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/models"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/repositories"
)

// RoleName is the single platform role. Platform authority (org lifecycle,
// global registry, platform dashboards) is granted only by holding it; it is
// orthogonal to org-scoped roles (org_admin/member).
const RoleSuperAdmin = "super_admin"

type RoleService struct {
	store *repositories.Store
}

func NewRoleService(store *repositories.Store) *RoleService {
	return &RoleService{store: store}
}

// IsSuperAdmin reports whether the user holds the platform super_admin role.
// Queried against the DB so a freshly revoked role takes effect immediately.
func (s *RoleService) IsSuperAdmin(ctx context.Context, userID string) (bool, error) {
	roles, err := s.store.UserRoles(ctx, userID)
	if err != nil {
		return false, err
	}
	for _, role := range roles {
		if role.Name == RoleSuperAdmin {
			return true, nil
		}
	}
	return false, nil
}

func (s *RoleService) List(ctx context.Context) ([]contracts.RoleResponse, error) {
	roles, err := s.store.ListRoles(ctx)
	if err != nil {
		return nil, err
	}
	return RoleResponses(roles), nil
}

func (s *RoleService) ListUserRoles(ctx context.Context, userID string) ([]contracts.RoleResponse, error) {
	roles, err := s.store.UserRoles(ctx, userID)
	if err != nil {
		return nil, err
	}
	return RoleResponses(roles), nil
}

func (s *RoleService) Assign(ctx context.Context, userID, roleID string, meta AuditMeta) error {
	roleID = strings.TrimSpace(roleID)
	if roleID == "" {
		return ErrInvalidRole
	}
	roleName := ""
	if role, e := s.store.RoleByID(ctx, roleID); e == nil {
		roleName = role.Name
	}
	err := mutateWithAudit(ctx, s.store, auditEntry{
		Action: "platform.role.assign",
		Actor:  meta.ActorUserID,
		Target: userID,
		After:  map[string]any{"roleId": roleID, "role": roleName},
		Trace:  meta.TraceID,
	}, func(txStore *repositories.Store) error {
		if err := txStore.AssignRole(ctx, userID, roleID); err != nil {
			return err
		}
		return txStore.RevokeUserRefreshTokens(ctx, userID)
	})
	if err != nil {
		return ErrRoleAssignmentFailed
	}
	return nil
}

// Remove revokes a platform role. Revoking the last super_admin is rejected so
// the platform never ends up without an administrator.
func (s *RoleService) Remove(ctx context.Context, userID, roleID string, meta AuditMeta) error {
	role, err := s.store.RoleByID(ctx, roleID)
	if err != nil {
		return ErrRoleAssignmentAbsent
	}
	removeErr := mutateWithAudit(ctx, s.store, auditEntry{
		Action: "platform.role.remove",
		Actor:  meta.ActorUserID,
		Target: userID,
		Before: map[string]any{"roleId": roleID, "role": role.Name},
		Trace:  meta.TraceID,
	}, func(txStore *repositories.Store) error {
		return txStore.RemoveRolePreservingSuperAdmin(ctx, userID, roleID)
	})
	if errors.Is(removeErr, repositories.ErrInvariant) {
		return ErrLastSuperAdmin
	}
	if removeErr != nil {
		return ErrRoleAssignmentAbsent
	}
	return nil
}

func RoleResponse(role models.Role) contracts.RoleResponse {
	return contracts.RoleResponse{
		ID:          role.ID,
		Name:        role.Name,
		Description: role.Description,
		CreatedAt:   role.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func RoleResponses(roles []models.Role) []contracts.RoleResponse {
	out := make([]contracts.RoleResponse, 0, len(roles))
	for _, role := range roles {
		out = append(out, RoleResponse(role))
	}
	return out
}
