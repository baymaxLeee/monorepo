//go:build integration

package quota

import (
	"context"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	app "github.com/example/monorepo/canvas/internal/application/quota"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

func TestConcurrentStorageReservationsShareOneSlot(t *testing.T) {
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
	repo := NewRepository(transaction.New(pool), slog.Default())
	now := time.Now().UTC()
	cap := int64(19)
	req := app.ReserveRequest{TenantID: uuid.NewString(), Resource: app.ResourceStorage, Value: cap, TenantLimit: &cap, LimitAvailable: true, Enforce: true,
		TargetType: "asset", TargetID: uuid.NewString(), Now: now, ExpiresAt: now.Add(time.Hour)}
	object := app.StorageObject{TenantID: req.TenantID, ObjectType: "artifact", ObjectKey: uuid.NewString(), Category: "asset", OwnerType: req.TargetType, OwnerID: req.TargetID, SizeBytes: cap, BillingClass: app.BillingBillable}
	req.IdempotencyKey = app.StorageIdempotencyKey(object.ObjectType, object.ObjectKey)
	defer func() {
		_, _ = pool.Exec(ctx, "DELETE FROM tenant_storage_usage_ledger WHERE tenant_id=$1", req.TenantID)
		_, _ = pool.Exec(ctx, "DELETE FROM resource_quota_reservations WHERE tenant_id=$1", req.TenantID)
		_, _ = pool.Exec(ctx, "DELETE FROM resource_usage_counters WHERE scope_type='tenant' AND scope_id=$1", req.TenantID)
	}()
	var wg sync.WaitGroup
	start := make(chan struct{})
	reservations := make([]app.Reservation, 2)
	errs := make([]error, 2)
	for i := range reservations {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			attempt := req
			attempt.ID = uuid.NewString()
			<-start
			reservations[i], errs[i] = repo.Reserve(ctx, attempt)
		}(i)
	}
	close(start)
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if reservations[0] != reservations[1] {
		t.Fatalf("different reservations for one key: %+v", reservations)
	}
	checkUsage := func(used, reserved int64) {
		t.Helper()
		usage, err := repo.Usage(ctx, req.TenantID, app.ResourceStorage)
		if err != nil || usage.Used != used || usage.Reserved != reserved {
			t.Fatalf("usage=%+v, err=%v; want used=%d reserved=%d", usage, err, used, reserved)
		}
	}
	checkUsage(0, cap)
	for _, reservation := range reservations {
		if err := repo.CommitStorage(ctx, reservation, object, now); err != nil {
			t.Fatal(err)
		}
	}
	checkUsage(cap, 0)
	for i := 0; i < 2; i++ {
		ok, err := repo.ReleaseStorage(ctx, object.ObjectType, object.ObjectKey, now)
		if err != nil || ok != (i == 0) {
			t.Fatalf("release %d: ok=%v err=%v", i, ok, err)
		}
	}
	checkUsage(0, 0)
}
