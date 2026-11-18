package repositories

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/example/monorepo/iam/internal/application"
)

// Run against an isolated database with the IAM migrations applied.
func TestPostgresRotationAndMembership(t *testing.T) {
	url := os.Getenv("IAM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("IAM_TEST_DATABASE_URL is required for the PostgreSQL integration test")
	}
	ctx := context.Background()
	store, err := Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	now := time.Now().UTC()
	owner := application.User{ID: application.NewID(), Account: application.NewID(), Email: application.NewID(), EmailNormalized: application.NewID(), DisplayName: "Owner", CreatedAt: now, UpdatedAt: now}
	tenant := application.Tenant{ID: application.NewID(), Name: "tenant", Slug: application.NewID(), CreatedAt: now, UpdatedAt: now}
	space := application.Workspace{ID: application.NewID(), TenantID: tenant.ID, OwnerUserID: owner.ID, Name: "workspace", Slug: application.NewID(), JoinPolicy: "approval", CreatedAt: now, UpdatedAt: now}
	err = store.inTx(ctx, func(tx *Store) error {
		if err := tx.CreateTenant(ctx, tenant); err != nil {
			return err
		}
		if err := tx.createAccount(ctx, owner, "hash"); err != nil {
			return err
		}
		return tx.CreateWorkspaceWithOwner(ctx, space, owner.ID)
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetMemberRole(ctx, space.ID, owner.ID, "member"); !errors.Is(err, ErrInvariant) {
		t.Fatalf("owner demotion: %v", err)
	}
	missingSpace := application.NewID()
	user := owner
	user.ID, user.Account, user.Email, user.EmailNormalized = application.NewID(), application.NewID(), application.NewID(), application.NewID()
	if err := store.CreateRegisteredUser(ctx, user, "hash", space.ID, missingSpace); err == nil {
		t.Fatal("registered user with missing target workspace")
	}
	if exists, err := store.UserExistsByAccount(ctx, user.Account); err != nil || exists {
		t.Fatalf("registration rollback: exists=%v err=%v", exists, err)
	}
	token := application.RefreshToken{ID: application.NewID(), UserID: owner.ID, TokenHash: application.NewID(), ActiveWorkspaceID: &space.ID, ExpiresAt: now.Add(time.Hour), CreatedAt: now}
	if err := store.CreateRefreshToken(ctx, token); err != nil {
		t.Fatal(err)
	}
	var results [2]error
	var wg sync.WaitGroup
	for i := range results {
		wg.Go(func() {
			next := application.RefreshToken{ID: application.NewID(), TokenHash: application.NewID(), ExpiresAt: now.Add(time.Hour), CreatedAt: now}
			user, workspace, err := store.RotateRefreshToken(ctx, token.TokenHash, next)
			results[i] = err
			if err == nil && (user.ID != owner.ID || workspace == nil || *workspace != space.ID) {
				t.Errorf("lost user or active workspace")
			}
		})
	}
	wg.Wait()
	if !(results[0] == nil && errors.Is(results[1], ErrNotFound) || results[1] == nil && errors.Is(results[0], ErrNotFound)) {
		t.Fatalf("rotation results: %v", results)
	}
}
