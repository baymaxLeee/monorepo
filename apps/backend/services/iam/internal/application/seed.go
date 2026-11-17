package application

import (
	"context"
	"time"

	"github.com/example/monorepo/iam/internal/domain"
)

func EnsureSystemBootstrap(ctx context.Context, store Store, security Security, cfg SeedConfig) error {
	passwordHash, err := security.HashPassword(cfg.SuperAdminPassword)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	user := User{
		ID:              cfg.SuperAdminID,
		Account:         domain.NormalizeAccount(cfg.SuperAdminAccount),
		Email:           domain.NormalizeEmail(cfg.SuperAdminEmail),
		EmailNormalized: domain.NormalizeEmail(cfg.SuperAdminEmail),
		DisplayName:     cfg.SuperAdminDisplayName,
		Locale:          "zh-CN",
		Timezone:        "Asia/Shanghai",
		Theme:           "system",
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	role := Role{
		ID:          "role-super-admin",
		Name:        "super_admin",
		Description: "System super administrator",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	tenant := Tenant{
		ID: "system-tenant", Name: "平台", Slug: "platform", CreatedAt: now, UpdatedAt: now,
	}
	guestSystemKey := "guest-workspace"
	workspace := Workspace{
		TenantID:      "system-tenant",
		ID:            cfg.GuestWorkspaceID,
		Name:          cfg.GuestWorkspaceName,
		Slug:          cfg.GuestWorkspaceSlug,
		OwnerUserID:   user.ID,
		SystemManaged: true,
		SystemKey:     &guestSystemKey,
		JoinPolicy:    "open",
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	return mutateWithAudit(ctx, store, auditEntry{
		Action: "system.bootstrap", Target: user.ID, Workspace: workspace.ID,
		After: map[string]any{"superAdminId": user.ID, "guestWorkspaceId": workspace.ID},
	}, func(txStore Store) error {
		if err := txStore.EnsureTenant(ctx, tenant); err != nil {
			return err
		}
		if err := txStore.EnsureUserWithPassword(ctx, user, cfg.SuperAdminPassword, passwordHash); err != nil {
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
		if err := txStore.EnsureWorkspace(ctx, workspace); err != nil {
			return err
		}
		if err := txStore.EnsureWorkspaceMember(ctx, workspace.ID, user.ID, "workspace_admin", "active"); err != nil {
			return err
		}
		return txStore.EnsureAllUsersInGuestWorkspace(ctx, workspace.ID)
	})
}
