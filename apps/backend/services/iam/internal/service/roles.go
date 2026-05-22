package service

import (
	"context"
	"strings"
	"time"

	"github.com/example/monorepo/iam/internal/crud"
	"github.com/example/monorepo/iam/internal/model"
	"github.com/example/monorepo/iam/internal/schema"
)

type RoleService struct {
	store *crud.Store
}

func NewRoleService(store *crud.Store) *RoleService {
	return &RoleService{store: store}
}

func (s *RoleService) List(ctx context.Context) ([]schema.RoleResponse, error) {
	roles, err := s.store.ListRoles(ctx)
	if err != nil {
		return nil, err
	}
	return RoleResponses(roles), nil
}

func (s *RoleService) Create(ctx context.Context, req schema.RoleRequest) (schema.RoleResponse, error) {
	name := NormalizeRoleName(req.Name)
	if !ValidRoleName(name) {
		return schema.RoleResponse{}, ErrInvalidRole
	}
	now := time.Now().UTC()
	role := model.Role{
		ID:          NewID(),
		Name:        name,
		Description: strings.TrimSpace(req.Description),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.store.CreateRole(ctx, role); err != nil {
		return schema.RoleResponse{}, ErrConflict
	}
	return RoleResponse(role), nil
}

func (s *RoleService) ListUserRoles(ctx context.Context, userID string) ([]schema.RoleResponse, error) {
	roles, err := s.store.UserRoles(ctx, userID)
	if err != nil {
		return nil, err
	}
	return RoleResponses(roles), nil
}

func (s *RoleService) Assign(ctx context.Context, userID, roleID string) error {
	roleID = strings.TrimSpace(roleID)
	if roleID == "" {
		return ErrInvalidRole
	}
	if err := s.store.AssignRole(ctx, userID, roleID); err != nil {
		return ErrRoleAssignmentFailed
	}
	return nil
}

func (s *RoleService) Remove(ctx context.Context, userID, roleID string) error {
	if err := s.store.RemoveRole(ctx, userID, roleID); err != nil {
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

func NormalizeRoleName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func ValidRoleName(name string) bool {
	return name != "" && len(name) <= 64 && !strings.ContainsAny(name, " \t\r\n")
}
