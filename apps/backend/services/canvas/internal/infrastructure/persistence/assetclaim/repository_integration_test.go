//go:build integration

package assetclaim

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	app "github.com/example/monorepo/canvas/internal/application/assetclaim"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

func TestReplacedIntentRevokesDeliveryLease(t *testing.T) {
	ctx := context.Background()
	dsn := os.Getenv("CANVAS_STREAM_TEST_DSN")
	if dsn == "" {
		t.Fatal("CANVAS_STREAM_TEST_DSN required")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := transaction.New(pool)
	repo := NewRepository(store)
	now := time.Now().UTC().Truncate(time.Millisecond)
	intent := app.Intent{TenantID: uuid.NewString(), OwnerType: "canvas_asset", OwnerID: uuid.NewString(), Slot: "source", AssetID: "asset", RevisionID: "v1", Kind: app.KindStrong, Generation: 1}
	rollback := errors.New("rollback test data")
	err = store.WithinTransaction(ctx, func(ctx context.Context) error {
		if err := repo.EnsureActive(ctx, intent, now); err != nil {
			return err
		}
		first, err := repo.ClaimDue(ctx, now, now.Add(time.Minute), 1)
		if err != nil {
			return err
		}
		if len(first) != 1 || first[0].OwnerID != intent.OwnerID {
			t.Fatalf("claims=%+v", first)
		}
		conflicting := intent
		conflicting.RevisionID = "v2"
		if err := repo.EnsureActive(ctx, conflicting, now); !errors.Is(err, app.ErrConflict) {
			t.Fatalf("same-generation conflict: %v", err)
		}
		intent.Generation++
		if err := repo.EnsureReleased(ctx, intent, now); err != nil {
			return err
		}
		if ok, err := repo.MarkDelivered(ctx, first[0], now); err != nil || ok {
			t.Fatalf("stale delivery: ok=%v err=%v", ok, err)
		}
		second, err := repo.ClaimDue(ctx, now, now.Add(time.Minute), 1)
		if err != nil {
			return err
		}
		if len(second) != 1 || second[0].DesiredState != app.DesiredReleased {
			t.Fatalf("release intent=%+v", second)
		}
		if ok, err := repo.MarkDelivered(ctx, second[0], now); err != nil || !ok {
			t.Fatalf("release delivery: ok=%v err=%v", ok, err)
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatal(err)
	}
}
