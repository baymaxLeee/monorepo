//go:build integration

package canvasnode

import (
	"context"
	"errors"
	"fmt"
	reviewapp "github.com/example/monorepo/canvas/internal/application/benefitpackage"
	archive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	textapp "github.com/example/monorepo/canvas/internal/application/canvastextgeneration"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	task "github.com/example/monorepo/canvas/internal/domain/task"
	reviewrepo "github.com/example/monorepo/canvas/internal/infrastructure/persistence/benefitpackage"
	archiverepo "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvasarchive"
	textrepo "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvastextgeneration"
	taskrepo "github.com/example/monorepo/canvas/internal/infrastructure/persistence/task"
	"os"
	"sync"
	"testing"
	"time"

	app "github.com/example/monorepo/canvas/internal/application/canvas"
	stream "github.com/example/monorepo/canvas/internal/application/canvasstream"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	tx "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestCanvasJournalPostgres(t *testing.T) {
	dsn := os.Getenv("CANVAS_STREAM_TEST_DSN")
	if dsn == "" {
		t.Fatal("CANVAS_STREAM_TEST_DSN must point to an isolated database with the Canvas baseline")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close() })
	repo := NewRepository(db)
	journal := NewEventJournal(db, repo)
	if err = journal.Register(); err != nil {
		t.Fatal(err)
	}
	id := func() string { return uuid.Must(uuid.NewV7()).String() }
	project, canvas := id(), id()
	workspace := "sse-test"
	scope := app.Scope{TenantID: id(), WorkspaceID: &workspace, CallerID: "alice"}
	ctx := context.Background()
	now := time.Now().UTC()
	for _, entry := range []struct {
		sql  string
		args []any
	}{
		{"INSERT INTO projects(id,tenant_id,workspace_id,name,created_by,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,0)", []any{project, scope.TenantID, workspace, "test", "alice", now, now}},
		{"INSERT INTO canvases(id,tenant_id,workspace_id,project_id,name,created_by,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,0)", []any{canvas, scope.TenantID, workspace, project, "test", "alice", now, now}},
	} {
		if e := db.Exec(entry.sql, entry.args...).Error; e != nil {
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
	manager := tx.New(db)
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
	err = manager.WithinTransaction(ctx, func(ctx context.Context) error {
		for i := range rows {
			if e := tx.DB(ctx, db).Create(&rows[i]).Error; e != nil {
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
	err = manager.WithinTransaction(ctx, func(ctx context.Context) error {
		if e := tx.DB(ctx, db).Model(&rows[0]).Update("revision", 2).Error; e != nil {
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
			errs <- manager.WithinTransaction(ctx, func(ctx context.Context) error { return tx.DB(ctx, db).Model(&rows[i]).Update("revision", 3).Error })
		}(i)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	replica := NewEventJournal(db, repo)
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
	if e = db.Create(&row).Error; e != nil {
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
	// An event storage failure must roll back the business write, including the implicit GORM transaction.
	if e = db.Exec(fmt.Sprintf("ALTER TABLE canvas_events ADD CONSTRAINT test_reject_next CHECK (canvas_id <> '%s' OR sequence < 6)", canvas)).Error; e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Exec("ALTER TABLE canvas_events DROP CONSTRAINT IF EXISTS test_reject_next") })
	if e = db.Model(&rows[0]).Update("revision", 9).Error; e == nil {
		t.Fatal("expected journal failure")
	}
	var saved canvasnodeRow
	if e = db.First(&saved, "id = ?", rows[0].ID).Error; e != nil || saved.Revision != 3 {
		t.Fatalf("journal failure committed business mutation: %d %v", saved.Revision, e)
	}
	if e = db.Exec("ALTER TABLE canvas_events DROP CONSTRAINT test_reject_next").Error; e != nil {
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
	if e = db.Table("canvases").Where("id = ?", canvas).Updates(map[string]any{"name": "renamed", "revision": 2, "default_view": 2}).Error; e != nil {
		t.Fatal(e)
	}
	if metadata := expectPatch(stream.PatchCanvasUpsert).Canvas; metadata.Name != "renamed" || metadata.Revision != 2 {
		t.Fatalf("metadata: %+v", metadata)
	}
	run := task.TaskRun{ID: id(), TenantID: scope.TenantID, WorkspaceID: &workspace, CreatedBy: "alice", RunType: task.RunTypeCanvasNodeTextGeneration, SubjectType: task.SubjectTypeCanvasNode, SubjectID: rows[0].ID.String(), Status: task.StatusRunning, StateVersion: 1, CreatedAt: now, UpdatedAt: now}
	if e = taskrepo.NewRepository(db).Create(ctx, run); e != nil {
		t.Fatal(e)
	}
	if got := expectPatch(stream.PatchTaskUpsert).Task; got.TaskRunID != run.ID || got.Status != "running" {
		t.Fatalf("task: %+v", got)
	}
	protectedSnapshot, e := journal.Snapshot(ctx, scope, project, canvas)
	if e != nil || len(protectedSnapshot.ProtectedNodeIDs) != 1 || protectedSnapshot.ProtectedNodeIDs[0] != run.SubjectID {
		t.Fatalf("pending task must protect its node after the active slot clears: %+v %v", protectedSnapshot.ProtectedNodeIDs, e)
	}
	textStore := textrepo.NewRepository(db)
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
	assetUUID, _ := persistenceid.Parse(assetID)
	if e = db.Model(&rows[1]).Update("asset_id", assetUUID).Error; e != nil {
		t.Fatal(e)
	}
	expectPatch(stream.PatchNodeUpsert)
	reviews := reviewrepo.NewRepository(db)
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
	archiveStore := archiverepo.NewRepository(db)
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
	c, _ := persistenceid.Parse(canvas)
	if e = db.Where("canvas_id = ? AND sequence = ?", c, 3).Delete(&eventRow{}).Error; e != nil {
		t.Fatal(e)
	}
	if _, e = replica.Events(ctx, scope, project, canvas, 2, 10); !errors.Is(e, stream.ErrCursorExpired) {
		t.Fatalf("missing retained event: %v", e)
	}
}
