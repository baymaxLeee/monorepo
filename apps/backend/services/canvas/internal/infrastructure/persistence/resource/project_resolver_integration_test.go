//go:build integration

package resource

import (
	"context"
	"errors"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	"os"
	"testing"

	app "github.com/example/monorepo/canvas/internal/application/resource"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestProjectResolverVisibility(t *testing.T) {
	ctx := context.Background()
	dsn := os.Getenv("CANVAS_STREAM_TEST_DSN")
	if dsn == "" {
		t.Fatal("CANVAS_STREAM_TEST_DSN must point to an isolated migrated Canvas database")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := transaction.New(pool)
	rollback := errors.New("roll back test data")
	err = store.WithinTransaction(ctx, func(ctx context.Context) error {
		tx := store.DB(ctx)
		id := uuid.Must(uuid.NewV7()).String()
		tenant := uuid.NewString()
		_, err := tx.Exec(ctx, `INSERT INTO projects(id,tenant_id,name,created_by,created_at,updated_at,deleted_at)
 VALUES ($1,$2,'resolver test','owner',now(),now(),0)`, id, tenant)
		if err != nil {
			t.Fatal(err)
		}
		resolver := NewProjectResolver(store)
		scope := app.Scope{TenantID: tenant}
		if err = resolver.Validate(ctx, scope, id); err != nil {
			t.Fatal(err)
		}
		wrongScope := app.Scope{TenantID: "other"}
		if err = resolver.Validate(ctx, wrongScope, id); !errors.Is(err, app.ErrProjectNotFound) {
			t.Fatalf("other tenant: %v", err)
		}
		empty := ""
		scope.WorkspaceID = &empty
		if err = resolver.Validate(ctx, scope, id); !errors.Is(err, app.ErrProjectNotFound) {
			t.Fatalf("NULL matched empty workspace: %v", err)
		}
		if _, err = tx.Exec(ctx, "UPDATE projects SET workspace_id='', deleted_at=1 WHERE id=$1", id); err != nil {
			t.Fatal(err)
		}
		if err = resolver.Validate(ctx, scope, id); !errors.Is(err, app.ErrProjectNotFound) {
			t.Fatalf("soft-deleted project: %v", err)
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatal(err)
	}
}
