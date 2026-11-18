//go:build integration

package projectusage

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	app "github.com/example/monorepo/canvas/internal/application/projectusage"
	apptask "github.com/example/monorepo/canvas/internal/application/task"
	domain "github.com/example/monorepo/canvas/internal/domain/projectusage"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	taskrepo "github.com/example/monorepo/canvas/internal/infrastructure/persistence/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

func TestTaskSettlementExportUsesRepeatableSnapshot(t *testing.T) {
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
	tasks := taskrepo.NewRepository(store)
	usage := NewRepository(store)
	now := time.Now().UTC().Truncate(time.Millisecond)
	id := uuid.Must(uuid.NewV7()).String()
	projectID := uuid.Must(uuid.NewV7()).String()
	run := domaintask.TaskRun{ID: id, TenantID: id, CreatedBy: "creator", RunType: domaintask.RunTypeCanvasNodeTextGeneration,
		SubjectType: domaintask.SubjectTypeCanvasNode, SubjectID: uuid.Must(uuid.NewV7()).String(), Status: domaintask.StatusQueued, StateVersion: 1, CreatedAt: now, UpdatedAt: now}
	defer func() {
		_, _ = pool.Exec(ctx, "DELETE FROM project_usage_records WHERE task_run_id=$1", id)
		_, _ = pool.Exec(ctx, "DELETE FROM task_run_provider_calls WHERE task_run_id=$1", id)
		_, _ = pool.Exec(ctx, "DELETE FROM task_runs WHERE id=$1", id)
	}()
	if err := tasks.Create(ctx, run); err != nil {
		t.Fatal(err)
	}
	call, err := domain.NewProviderCall(domain.NewProviderCallInput{TaskRunID: id, CallOrdinal: 1, CallType: app.CallTypeCanvasTextGeneration, ProjectID: projectID, ModelID: "model", ModelName: "model", ModelSource: "provider", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if err := usage.CreateCall(ctx, call); err != nil {
		t.Fatal(err)
	}
	const amount = "12345678901234567890.123456789012345678"
	transitions := []func(*domain.ProviderCall) error{
		func(c *domain.ProviderCall) error { return c.StartRequest(now) },
		func(c *domain.ProviderCall) error { return c.Capture(id, now) },
		func(c *domain.ProviderCall) error {
			return c.Settle(amount, "USD", domain.SettlementProviderSettled, now)
		},
	}
	for _, apply := range transitions {
		next := call
		if err := apply(&next); err != nil {
			t.Fatal(err)
		}
		if ok, err := usage.UpdateCall(ctx, call, next); err != nil || !ok {
			t.Fatalf("call version %d: updated=%v err=%v", call.StateVersion, ok, err)
		}
		call = next
	}
	update := apptask.TaskRunUpdate{Status: domaintask.StatusSucceeded, FinishedAt: &now}
	for i := 0; i < 2; i++ {
		ok, err := tasks.UpdateTaskRun(ctx, run, update, now)
		if err != nil || ok != (i == 0) {
			t.Fatalf("task update %d: updated=%v err=%v", i, ok, err)
		}
	}
	query := app.ExportPageQuery{ExportScope: app.ExportScope{TenantID: run.TenantID}, ProjectID: projectID, Limit: 1}
	err = usage.WithReadOnlySnapshot(ctx, func(snapshot context.Context) error {
		rows, err := usage.ListExportPage(snapshot, query)
		if err != nil {
			return err
		}
		if len(rows) != 0 {
			t.Fatalf("initial export rows=%+v", rows)
		}
		if err := usage.CloseTaskRun(ctx, app.CloseInput{TaskRunID: id}, now); err != nil {
			return err
		}
		rows, err = usage.ListExportPage(snapshot, query)
		if err != nil {
			return err
		}
		if len(rows) != 0 {
			t.Fatalf("snapshot saw a later close: %+v", rows)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := usage.ListExportPage(ctx, query)
	if err != nil || len(rows) != 1 || rows[0].TotalAmount == nil || *rows[0].TotalAmount != amount {
		t.Fatalf("export rows=%+v err=%v", rows, err)
	}
	query.AfterConsumedAt = &rows[0].ConsumedAt
	query.AfterTaskRunID = id
	rows, err = usage.ListExportPage(ctx, query)
	if err != nil || len(rows) != 0 {
		t.Fatalf("cursor returned %+v err=%v", rows, err)
	}
}
