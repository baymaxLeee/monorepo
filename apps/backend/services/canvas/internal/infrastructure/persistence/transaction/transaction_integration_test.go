//go:build integration

package transaction

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGeneratedQueriesShareTransactionAndSavepoints(t *testing.T) {
	ctx := context.Background()
	url := os.Getenv("CANVAS_STREAM_TEST_DSN")
	if url == "" {
		t.Fatal("CANVAS_STREAM_TEST_DSN required")
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	manager := New(pool)
	id := uuid.NewString()
	abort := errors.New("rollback")
	err = manager.WithinTransaction(ctx, func(ctx context.Context) error {
		if err := manager.Queries(ctx).CreateProjectUsagePolicy(ctx, sqlc.CreateProjectUsagePolicyParams{ProjectID: id, TenantID: "tenant", WorkspaceID: "workspace"}); err != nil {
			return err
		}
		err := manager.WithinTransaction(ctx, func(ctx context.Context) error {
			limit := int64(5)
			count, err := manager.Queries(ctx).UpdateProjectUsageLimit(ctx, sqlc.UpdateProjectUsageLimitParams{ProjectID: id, TenantID: "tenant", WorkspaceID: "workspace", UsageLimitMicros: &limit})
			if err != nil {
				return err
			}
			if count != 1 {
				t.Fatal("savepoint did not see outer insert")
			}
			return abort
		})
		if !errors.Is(err, abort) {
			return err
		}
		var ok bool
		if err := manager.DB(ctx).QueryRow(ctx, "SELECT usage_limit_micros IS NULL FROM project_usage_policies WHERE project_id=$1", id).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			t.Fatal("outer transaction did not see rolled back savepoint")
		}
		return abort
	})
	if !errors.Is(err, abort) {
		t.Fatal(err)
	}
	var exists bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM project_usage_policies WHERE project_id=$1)", id).Scan(&exists); err != nil || exists {
		t.Fatalf("outer rollback: exists=%v err=%v", exists, err)
	}
}
