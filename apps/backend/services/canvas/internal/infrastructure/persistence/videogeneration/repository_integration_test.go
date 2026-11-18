//go:build integration

package videogeneration

import (
	"context"
	"os"
	"testing"
	"time"

	frame "github.com/example/monorepo/canvas/internal/application/firstlastframe"
	app "github.com/example/monorepo/canvas/internal/application/videogeneration"
	domain "github.com/example/monorepo/canvas/internal/domain/videogeneration"
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

func TestFrameCheckpointCannotReplaceArtifacts(t *testing.T) {
	ctx := context.Background()
	repo := testRepository(t, ctx)
	now := time.Now().UTC().Truncate(time.Millisecond)
	id := func() string { return uuid.Must(uuid.NewV7()).String() }
	generation := domain.Generation{TaskRunID: id(), TenantID: id(), ProjectID: id(), CanvasID: id(), NodeID: id(), Status: "running", ProviderWorkspaceID: "provider", CreatedAt: now, UpdatedAt: now}
	if err := repo.CreateGeneration(ctx, generation); err != nil {
		t.Fatal(err)
	}
	child := id()
	if ok, err := repo.AttachFirstLastFrameTask(ctx, generation.TaskRunID, child, now); err != nil || !ok {
		t.Fatalf("attach: %v %v", ok, err)
	}
	checkpoint := frame.Result{FirstFrameSourceAssetID: "first", FirstFrameSourceRevisionID: "v1", FirstFrameSizeBytes: 42}
	if ok, err := repo.RecordArtifactCheckpoint(ctx, generation.TaskRunID, child, checkpoint, now); err != nil || !ok {
		t.Fatalf("first checkpoint: %v %v", ok, err)
	}
	conflict := checkpoint
	conflict.FirstFrameSourceRevisionID = "v2"
	if ok, err := repo.RecordArtifactCheckpoint(ctx, generation.TaskRunID, child, conflict, now); err != nil || ok {
		t.Fatalf("conflicting checkpoint: %v %v", ok, err)
	}
	checkpoint.LastFrameSourceAssetID = "last"
	checkpoint.LastFrameSourceRevisionID = "v3"
	checkpoint.LastFrameSizeBytes = 93
	if ok, err := repo.RecordArtifactCheckpoint(ctx, generation.TaskRunID, child, checkpoint, now); err != nil || !ok {
		t.Fatalf("two checkpoints: %v %v", ok, err)
	}
	first, last := id(), id()
	if ok, err := repo.CommitAssets(ctx, generation.TaskRunID, child, checkpoint, first, last, now); err != nil || !ok {
		t.Fatalf("commit: %v %v", ok, err)
	}
	if ok, err := repo.CommitAssets(ctx, generation.TaskRunID, child, checkpoint, id(), id(), now); err != nil || ok {
		t.Fatalf("duplicate commit: %v %v", ok, err)
	}
	saved, err := repo.GetGeneration(ctx, app.Scope{TenantID: generation.TenantID}, generation.TaskRunID)
	if err != nil || saved.FirstFrameAssetID != first || saved.LastFrameAssetID != last {
		t.Fatalf("persisted frames: %+v %v", saved, err)
	}
}
