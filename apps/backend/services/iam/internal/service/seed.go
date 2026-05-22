package service

import (
	"context"
	"time"

	"github.com/example/monorepo/iam/internal/config"
	"github.com/example/monorepo/iam/internal/crud"
	"github.com/example/monorepo/iam/internal/model"
	"github.com/example/monorepo/iam/internal/security"
)

func SeedDemoSuperAdmin(ctx context.Context, store *crud.Store, cfg config.Config) error {
	passwordHash, err := security.HashPassword(cfg.SuperAdminPassword)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	user := model.User{
		ID:              cfg.SuperAdminID,
		Account:         NormalizeAccount(cfg.SuperAdminAccount),
		Email:           NormalizeEmail(cfg.SuperAdminEmail),
		EmailNormalized: NormalizeEmail(cfg.SuperAdminEmail),
		DisplayName:     cfg.SuperAdminDisplayName,
		Locale:          "zh-CN",
		Timezone:        "Asia/Shanghai",
		Theme:           "system",
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := store.EnsureUserWithPassword(ctx, user, passwordHash); err != nil {
		return err
	}
	role := model.Role{
		ID:          "role-super-admin",
		Name:        "super_admin",
		Description: "Demo super administrator",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := store.EnsureRole(ctx, role); err != nil {
		return err
	}
	storedRole, err := store.RoleByName(ctx, role.Name)
	if err != nil {
		return err
	}
	return store.AssignRole(ctx, user.ID, storedRole.ID)
}
