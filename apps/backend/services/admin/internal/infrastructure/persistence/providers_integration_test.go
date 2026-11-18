//go:build integration

package persistence

import (
	"context"
	"errors"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/example/monorepo/admin/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestReplacingDefaultProviderRollsBackOnInsertFailure(t *testing.T) {
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
	repo := ProviderRepository{Pool: pool}
	id := strconv.FormatInt(time.Now().UnixNano(), 36)
	dialect := "ark_responses"
	initial := domain.Provider{ID: id, TenantID: id, WorkspaceID: id, UserID: id, Name: "initial", Model: "model", Kind: "chat", ResponsesDialect: &dialect, IsDefault: true, IsEnabled: true, ContextWindow: 128000}
	stored, err := repo.Create(ctx, initial, true)
	if err != nil || stored.ContextWindow != initial.ContextWindow || stored.PricingJSON != nil || stored.ResponsesDialect == nil || *stored.ResponsesDialect != dialect {
		t.Fatalf("initial provider = %+v, err = %v", stored, err)
	}
	defer repo.Delete(ctx, id, id, id)
	replacement := initial
	replacement.ID += "2"
	replacement.ResponsesDialect = nil
	if _, err = repo.Create(ctx, replacement, true); err == nil {
		t.Fatal("accepted invalid replacement dialect")
	}
	stored, err = repo.Default(ctx, id, id)
	if err != nil || stored.ID != initial.ID {
		t.Fatalf("default after failed replacement = %+v, err = %v", stored, err)
	}
	if _, err = repo.Get(ctx, id, "other", id); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("foreign workspace read: %v", err)
	}
}
