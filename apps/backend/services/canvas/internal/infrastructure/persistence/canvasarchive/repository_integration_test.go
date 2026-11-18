//go:build integration

package canvasarchive

import (
	"context"
	"os"
	"testing"
	"time"

	app "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	"github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testRepository(t *testing.T, ctx context.Context) *Repository {
	t.Helper()
	dsn := os.Getenv("CANVAS_STREAM_TEST_DSN")
	if dsn == "" {
		t.Fatal("CANVAS_STREAM_TEST_DSN must point to an isolated database with the Canvas migrations")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return NewRepository(transaction.New(pool))
}

func TestArchiveCleanupRejectsStaleLease(t *testing.T) {
	ctx := context.Background()
	repo := testRepository(t, ctx)
	now := time.Now().UTC().Truncate(time.Millisecond)
	id := func() string { return uuid.Must(uuid.NewV7()).String() }
	item := app.Export{TaskRunID: id(), TenantID: id(), ProjectID: id(), CanvasID: id(), Status: task.StatusRunning, CleanupStatus: app.CleanupStatusWaiting, CreatedAt: now, UpdatedAt: now}
	if err := repo.Create(ctx, item, nil); err != nil {
		t.Fatal(err)
	}
	result := app.SuccessResult{AssetID: "file", RevisionID: "version", SHA256: "checksum", RetentionStartedAt: now}
	if ok, err := repo.RecordOutput(ctx, item.TaskRunID, task.StatusRunning, result, now); err != nil || !ok {
		t.Fatalf("record output: %v %v", ok, err)
	}
	if ok, err := repo.UpdateLifecycle(ctx, item.TaskRunID, task.StatusRunning, app.LifecycleUpdate{Status: task.StatusFailed, FinishedAt: &now}, now); err != nil || !ok {
		t.Fatalf("terminate: %v %v", ok, err)
	}
	due := now.Add(terminalAssociationCleanupGrace)
	claimed, err := repo.ClaimCleanupDue(ctx, due, due.Add(time.Minute), 1)
	if err != nil || len(claimed) != 1 || claimed[0].TaskRunID != item.TaskRunID {
		t.Fatalf("claim: %+v %v", claimed, err)
	}
	if ok, err := repo.CompleteCleanup(ctx, item, due); err != nil || ok {
		t.Fatalf("stale lease: %v %v", ok, err)
	}
	if ok, err := repo.CompleteCleanup(ctx, claimed[0], due); err != nil || !ok {
		t.Fatalf("complete lease: %v %v", ok, err)
	}
	saved, err := repo.GetByTaskRunID(ctx, item.TaskRunID)
	if err != nil || saved.CleanupStatus != app.CleanupStatusCompleted || saved.FinishedAt == nil || !saved.FinishedAt.Equal(now) {
		t.Fatalf("persisted cleanup: %+v %v", saved, err)
	}
}
