package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/example/monorepo/iam/internal/crud"
	"github.com/example/monorepo/iam/internal/model"
	"github.com/example/monorepo/iam/internal/schema"
)

// RoleName is the single platform role. Platform authority (org lifecycle,
// global registry, platform dashboards) is granted only by holding it; it is
// orthogonal to org-scoped roles (org_admin/member).
const RoleSuperAdmin = "super_admin"

type RoleService struct {
	store *crud.Store
}

func NewRoleService(store *crud.Store) *RoleService {
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

func (s *RoleService) List(ctx context.Context) ([]schema.RoleResponse, error) {
	roles, err := s.store.ListRoles(ctx)
	if err != nil {
		return nil, err
	}
	return RoleResponses(roles), nil
}

func (s *RoleService) ListUserRoles(ctx context.Context, userID string) ([]schema.RoleResponse, error) {
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
	}, func(txStore *crud.Store) error {
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
	}, func(txStore *crud.Store) error {
		return txStore.RemoveRolePreservingSuperAdmin(ctx, userID, roleID)
	})
	if errors.Is(removeErr, crud.ErrInvariant) {
		return ErrLastSuperAdmin
	}
	if removeErr != nil {
		return ErrRoleAssignmentAbsent
	}
	return nil
}

func RoleResponse(role model.Role) schema.RoleResponse {
	return schema.RoleResponse{
		ID:          role.ID,
		Name:        role.Name,
		Description: role.Description,
		CreatedAt:   role.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func RoleResponses(roles []model.Role) []schema.RoleResponse {
	out := make([]schema.RoleResponse, 0, len(roles))
	for _, role := range roles {
		out = append(out, RoleResponse(role))
	}
	return out
}
