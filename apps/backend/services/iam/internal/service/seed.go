package service

import (
	"context"
	"time"

	"github.com/example/monorepo/iam/internal/config"
	"github.com/example/monorepo/iam/internal/crud"
	"github.com/example/monorepo/iam/internal/model"
	"github.com/example/monorepo/iam/internal/security"
)

func EnsureSystemBootstrap(ctx context.Context, store *crud.Store, cfg config.Config) error {
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
	role := model.Role{
		ID:          "role-super-admin",
		Name:        "super_admin",
		Description: "System super administrator",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	guestSystemKey := "guest-org"
	org := model.Organization{
		ID:            cfg.GuestOrgID,
		Name:          cfg.GuestOrgName,
		Slug:          cfg.GuestOrgSlug,
		OwnerUserID:   user.ID,
		SystemManaged: true,
		SystemKey:     &guestSystemKey,
		JoinPolicy:    "open",
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	return mutateWithAudit(ctx, store, auditEntry{
		Action: "system.bootstrap", Target: user.ID, Org: org.ID,
		After: map[string]any{"superAdminId": user.ID, "guestOrgId": org.ID},
	}, func(txStore *crud.Store) error {
		if err := txStore.EnsureUserWithPassword(ctx, user, passwordHash); err != nil {
			return err
		}
		if err := txStore.EnsureRole(ctx, role); err != nil {
			return err
		}
		storedRole, err := txStore.RoleByName(ctx, role.Name)
		if err != nil {
			return err
		}
		if err := txStore.AssignRole(ctx, user.ID, storedRole.ID); err != nil {
			return err
		}
		if err := txStore.EnsureOrganization(ctx, org); err != nil {
			return err
		}
		if err := txStore.EnsureOrgMember(ctx, org.ID, user.ID, "org_admin", "active"); err != nil {
			return err
		}
		return txStore.EnsureAllUsersInGuestOrg(ctx, org.ID)
	})
}
