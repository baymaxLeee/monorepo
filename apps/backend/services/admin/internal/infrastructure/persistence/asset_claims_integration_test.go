//go:build integration

package persistence

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAssetClaimIntentGenerationFollowsStorageClaimLifecycle(t *testing.T) {
	ctx := context.Background()
	dsn := os.Getenv("ADMIN_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("ADMIN_TEST_DATABASE_URL must point to a migrated test database")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	id := uuid.NewString()
	claim := application.AssetClaim{
		TenantID: id, WorkspaceID: id, OwnerType: "skill_node", OwnerID: id, Slot: "content",
		AssetID: uuid.NewString(), RevisionID: uuid.NewString(), Kind: "strong", DesiredState: "active",
	}
	repository := SkillRepository{Pool: pool}
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM asset_claim_intents WHERE tenant_id=$1`, id)
	}()

	if err = repository.UpsertAssetClaim(ctx, claim); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE asset_claim_intents SET delivered_at=$2 WHERE tenant_id=$1`, id, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if err = repository.UpsertAssetClaim(ctx, claim); err != nil {
		t.Fatal(err)
	}
	assertClaimIntent(t, pool, id, 1, "active", true)

	claim.DesiredState = "released"
	if err = repository.UpsertAssetClaim(ctx, claim); err != nil {
		t.Fatal(err)
	}
	assertClaimIntent(t, pool, id, 1, "released", false)

	claim.DesiredState = "active"
	if err = repository.UpsertAssetClaim(ctx, claim); err != nil {
		t.Fatal(err)
	}
	assertClaimIntent(t, pool, id, 2, "active", false)

	claim.AssetID, claim.RevisionID = uuid.NewString(), uuid.NewString()
	if err = repository.UpsertAssetClaim(ctx, claim); err != nil {
		t.Fatal(err)
	}
	assertClaimIntent(t, pool, id, 3, "active", false)
}

func assertClaimIntent(t *testing.T, pool *pgxpool.Pool, tenantID string, wantGeneration int64, wantState string, wantDelivered bool) {
	t.Helper()
	var generation int64
	var state string
	var delivered bool
	err := pool.QueryRow(context.Background(), `
		SELECT generation, desired_state, delivered_at IS NOT NULL
		FROM asset_claim_intents WHERE tenant_id=$1
	`, tenantID).Scan(&generation, &state, &delivered)
	if err != nil {
		t.Fatal(err)
	}
	if generation != wantGeneration || state != wantState || delivered != wantDelivered {
		t.Fatalf("claim intent = generation %d, state %q, delivered %v; want %d, %q, %v",
			generation, state, delivered, wantGeneration, wantState, wantDelivered)
	}
}
