//go:build integration

package canvasnode

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	reviewapp "github.com/example/monorepo/canvas/internal/application/benefitpackage"
	archive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	textapp "github.com/example/monorepo/canvas/internal/application/canvastextgeneration"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	task "github.com/example/monorepo/canvas/internal/domain/task"
	reviewrepo "github.com/example/monorepo/canvas/internal/infrastructure/persistence/benefitpackage"
	archiverepo "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvasarchive"
	textrepo "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvastextgeneration"
	taskrepo "github.com/example/monorepo/canvas/internal/infrastructure/persistence/task"

	app "github.com/example/monorepo/canvas/internal/application/canvas"
	stream "github.com/example/monorepo/canvas/internal/application/canvasstream"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	tx "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCanvasJournalPostgres(t *testing.T) {
	dsn := os.Getenv("CANVAS_STREAM_TEST_DSN")
	if dsn == "" {
		t.Fatal("CANVAS_STREAM_TEST_DSN must point to an isolated database with the Canvas baseline")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	store := tx.New(pool)
	exec := func(ctx context.Context, stmt string, args ...any) error {
		return store.WithinTransaction(ctx, func(ctx context.Context) error { _, err := store.DB(ctx).Exec(ctx, stmt, args...); return err })
	}
	repo := NewRepository(store)
	journal := NewEventJournal(store, repo)
	journal.Register()
	id := func() string { return uuid.Must(uuid.NewV7()).String() }
	project, canvas := id(), id()
	workspace := "sse-test"
	scope := app.Scope{TenantID: id(), WorkspaceID: &workspace, CallerID: "alice"}
	now := time.Now().UTC()
	for _, entry := range []struct {
		sql  string
		args []any
	}{
		{"INSERT INTO projects(id,tenant_id,workspace_id,name,created_by,created_at,updated_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,0)", []any{project, scope.TenantID, workspace, "test", "alice", now, now}},
		{"INSERT INTO canvases(id,tenant_id,workspace_id,project_id,name,created_by,created_at,updated_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,0)", []any{canvas, scope.TenantID, workspace, project, "test", "alice", now, now}},
	} {
		if _, e := pool.Exec(ctx, entry.sql, entry.args...); e != nil {
			t.Fatal(e)
		}
	}
	initial, err := journal.Snapshot(ctx, scope, project, canvas)
	if err != nil {
		t.Fatal(err)
	}
	if initial.Cursor != 1 || len(initial.Nodes) != 0 {
		t.Fatalf("empty checkpoint: %+v", initial)
	}

	rows := []canvasnodeRow{}
	for range 2 {
		node, e := domain.NewCanvasNode(domain.CanvasNodeInput{ID: id(), TenantID: scope.TenantID, WorkspaceID: &workspace, ProjectID: project, CanvasID: canvas, CreatedBy: "alice", Type: domain.NodeTypeText, Name: "text", Text: "hello", Now: now})
		if e != nil {
			t.Fatal(e)
		}
		row, e := toRow(node)
		if e != nil {
			t.Fatal(e)
		}
		rows = append(rows, row)
	}
	err = store.WithinTransaction(ctx, func(ctx context.Context) error {
		for i := range rows {
			if e := insertNode(ctx, store.Queries(ctx), rows[i]); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	events, err := journal.Events(ctx, scope, project, canvas, 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Cursor != 2 || len(events[0].Patches) != 2 {
		t.Fatalf("one business transaction must publish one frame: %+v", events)
	}
	failure := errors.New("rollback")
	err = store.WithinTransaction(ctx, func(ctx context.Context) error {
		if e := exec(ctx, "UPDATE canvas_nodes SET revision=2 WHERE id=$1", rows[0].ID); e != nil {
			return e
		}
		return failure
	})
	if !errors.Is(err, failure) {
		t.Fatal(err)
	}
	if cursor, e := journal.Cursor(ctx, scope, project, canvas); e != nil || cursor != 2 {
		t.Fatalf("rollback advanced cursor: %d %v", cursor, e)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := range rows {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs <- exec(ctx, "UPDATE canvas_nodes SET revision=3 WHERE id=$1", rows[i].ID)
		}(i)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	replica := NewEventJournal(store, repo)
	events, err = replica.Events(ctx, scope, project, canvas, 2, 10)
	if err != nil || len(events) != 2 || events[0].BaseCursor != 2 || events[1].Cursor != 4 {
		t.Fatalf("cross-replica ordered replay: %+v %v", events, err)
	}
	foreign := scope
	foreign.TenantID = "foreign"
	if _, e := replica.Events(ctx, foreign, project, canvas, 4, 10); !errors.Is(e, app.ErrNotFound) {
		t.Fatalf("cross-tenant read: %v", e)
	}
	private, e := domain.NewCanvasNode(domain.CanvasNodeInput{ID: id(), TenantID: scope.TenantID, WorkspaceID: &workspace, ProjectID: project, CanvasID: canvas, CreatedBy: "alice", Type: domain.NodeTypeStoryboardDraft, Name: "draft", Prompt: "private", Now: now})
	if e != nil {
		t.Fatal(e)
	}
	row, e := toRow(private)
	if e != nil {
		t.Fatal(e)
	}
	if e = store.WithinTransaction(ctx, func(ctx context.Context) error { return insertNode(ctx, store.Queries(ctx), row) }); e != nil {
		t.Fatal(e)
	}
	bob := scope
	bob.CallerID = "bob"
	events, e = replica.Events(ctx, bob, project, canvas, 4, 10)
	if e != nil || len(events) != 1 || len(events[0].Patches) != 0 || events[0].Cursor != 5 {
		t.Fatalf("private visibility barrier: %+v %v", events, e)
	}
	state, e := replica.Snapshot(ctx, bob, project, canvas)
	if e != nil || len(state.Nodes) != 2 || len(state.Drafts) != 0 {
		t.Fatalf("private snapshot: %+v %v", state, e)
	}
	// An event storage failure must roll back the business write, including the revision update.
	if _, e = pool.Exec(ctx, fmt.Sprintf("ALTER TABLE canvas_events ADD CONSTRAINT test_reject_next CHECK (canvas_id <> '%s' OR sequence < 6)", canvas)); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { pool.Exec(ctx, "ALTER TABLE canvas_events DROP CONSTRAINT IF EXISTS test_reject_next") })
	if e = exec(ctx, "UPDATE canvas_nodes SET revision=9 WHERE id=$1", rows[0].ID); e == nil {
		t.Fatal("expected journal failure")
	}
	saved, e := store.Queries(ctx).NodeGetByID(ctx, sqlc.NodeGetByIDParams{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ID: rows[0].ID})
	if e != nil || saved.Revision != 3 {
		t.Fatalf("journal failure committed business mutation: %d %v", saved.Revision, e)
	}
	if _, e = pool.Exec(ctx, "ALTER TABLE canvas_events DROP CONSTRAINT test_reject_next"); e != nil {
		t.Fatal(e)
	}

	// Exercise every non-graph producer through its real repository and database callbacks.
	cursor := int64(5)
	expectPatch := func(kind stream.PatchKind) stream.Patch {
		t.Helper()
		frames, e := journal.Events(ctx, scope, project, canvas, cursor, 100)
		if e != nil {
			t.Fatal(e)
		}
		var found *stream.Patch
		for _, frame := range frames {
			cursor = frame.Cursor
			for _, patch := range frame.Patches {
				if patch.Kind == kind {
					value := patch
					found = &value
				}
			}
		}
		if found == nil {
			t.Fatalf("missing %s at cursor %d: %+v", kind, cursor, frames)
		}
		return *found
	}
	if e = exec(ctx, "UPDATE canvases SET name='renamed', revision=2, default_view=2 WHERE id=$1", canvas); e != nil {
		t.Fatal(e)
	}
	if metadata := expectPatch(stream.PatchCanvasUpsert).Canvas; metadata.Name != "renamed" || metadata.Revision != 2 {
		t.Fatalf("metadata: %+v", metadata)
	}
	run := task.TaskRun{ID: id(), TenantID: scope.TenantID, WorkspaceID: &workspace, CreatedBy: "alice", RunType: task.RunTypeCanvasNodeTextGeneration, SubjectType: task.SubjectTypeCanvasNode, SubjectID: rows[0].ID, Status: task.StatusRunning, StateVersion: 1, CreatedAt: now, UpdatedAt: now}
	if e = taskrepo.NewRepository(store).Create(ctx, run); e != nil {
		t.Fatal(e)
	}
	if got := expectPatch(stream.PatchTaskUpsert).Task; got.TaskRunID != run.ID || got.Status != "running" {
		t.Fatalf("task: %+v", got)
	}
	protectedSnapshot, e := journal.Snapshot(ctx, scope, project, canvas)
	if e != nil || len(protectedSnapshot.ProtectedNodeIDs) != 1 || protectedSnapshot.ProtectedNodeIDs[0] != run.SubjectID {
		t.Fatalf("pending task must protect its node after the active slot clears: %+v %v", protectedSnapshot.ProtectedNodeIDs, e)
	}
	textStore := textrepo.NewRepository(store)
	if e = textStore.Create(ctx, scope, textapp.Session{ID: run.ID, ProjectID: project, CanvasID: canvas, NodeID: run.SubjectID, Status: task.StatusRunning, CreatedAt: now, UpdatedAt: now}); e != nil {
		t.Fatal(e)
	}
	expectPatch(stream.PatchTextStatus)
	if e = textStore.Append(ctx, scope, run.ID, 0, "你好", now); e != nil {
		t.Fatal(e)
	}
	if delta := expectPatch(stream.PatchTextAppend).TextDelta; delta.Content != "你好" || delta.EndOffset != 6 {
		t.Fatalf("UTF-8 checkpoint: %+v", delta)
	}
	if e = textStore.Append(ctx, scope, run.ID, 0, "重复", now); e == nil {
		t.Fatal("stale offset accepted")
	}
	if e = textStore.Finish(ctx, scope, run.ID, task.StatusFailed, &textapp.Failure{Code: "interrupted"}, "", now); e != nil {
		t.Fatal(e)
	}
	if terminal := expectPatch(stream.PatchTextStatus).TextStatus; terminal.Offset != 6 || terminal.Status != "failed" {
		t.Fatalf("partial text lost: %+v", terminal)
	}
	assetID := id()

	if e = exec(ctx, "UPDATE canvas_nodes SET asset_id=$1 WHERE id=$2", assetID, rows[1].ID); e != nil {
		t.Fatal(e)
	}
	expectPatch(stream.PatchNodeUpsert)
	reviews := reviewrepo.NewRepository(store)
	reviewID, reviewRunID := id(), id()
	if _, e = reviews.ReplaceAssetReview(ctx, reviewapp.ReserveAssetReviewInput{ID: reviewID, TaskRunID: reviewRunID, TenantID: scope.TenantID, WorkspaceID: &workspace, ProjectID: project, PackageID: "package", PackageName: "Review", AssetID: assetID, ModelIDs: []string{}, Now: now}); e != nil {
		t.Fatal(e)
	}
	initialReview := expectPatch(stream.PatchNodeReviewsUpsert)
	if e = reviews.MarkAssetReviewProcessing(ctx, reviewID, reviewRunID, "provider", now); e != nil {
		t.Fatal(e)
	}
	expectPatch(stream.PatchNodeReviewsUpsert)
	if e = reviews.MarkAssetReviewTerminal(ctx, reviewID, domainasset.ReviewStatusApproved, "", now.Add(time.Second)); e != nil {
		t.Fatal(e)
	}
	expectPatch(stream.PatchNodeReviewsUpsert)
	if initialReview.NodeReviews.Reviews[0].Status != domainasset.ReviewStatusSubmitting {
		t.Fatal("replay review was replaced by live state")
	}
	archiveStore := archiverepo.NewRepository(store)
	export := archive.Export{TaskRunID: id(), TenantID: scope.TenantID, WorkspaceID: &workspace, ProjectID: project, CanvasID: canvas, CreatedBy: "alice", Status: task.StatusQueued, CreatedAt: now, UpdatedAt: now}
	if e = archiveStore.Create(ctx, export, nil); e != nil {
		t.Fatal(e)
	}
	expectPatch(stream.PatchArchiveUpsert)
	if _, e = archiveStore.UpdateLifecycle(ctx, export.TaskRunID, task.StatusQueued, archive.LifecycleUpdate{Status: task.StatusFailed, ErrorMessage: "test failure"}, now); e != nil {
		t.Fatal(e)
	}
	if got := expectPatch(stream.PatchArchiveUpsert).Archive; got.Status != task.StatusFailed {
		t.Fatalf("archive: %+v", got)
	}
	final, e := journal.Snapshot(ctx, scope, project, canvas)
	if e != nil || final.Cursor != cursor || final.Canvas.Name != "renamed" || len(final.Archives) != 1 || final.Texts[0].Content != "你好" {
		t.Fatalf("snapshot/replay disagree: %+v %v", final, e)
	}

	if _, e = pool.Exec(ctx, "DELETE FROM canvas_events WHERE canvas_id=$1 AND sequence=3", canvas); e != nil {
		t.Fatal(e)
	}
	if _, e = replica.Events(ctx, scope, project, canvas, 2, 10); !errors.Is(e, stream.ErrCursorExpired) {
		t.Fatalf("missing retained event: %v", e)
	}
}
