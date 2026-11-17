package bootstrap

import (
	"context"
	"log/slog"
	"time"

	applicationassetclaim "github.com/example/monorepo/canvas/internal/application/assetclaim"
	applicationcanvasarchive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	applicationdeletion "github.com/example/monorepo/canvas/internal/application/deletion"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

func runPollScheduler(ctx context.Context, scheduler *applicationtask.PollScheduler) {
	config := scheduler.Config()
	slots := make(chan struct{}, config.Concurrency)
	ticker := time.NewTicker(config.ClaimInterval)
	defer ticker.Stop()
	for {
		available := cap(slots) - len(slots)
		if available > 0 {
			claims, err := scheduler.Claim(ctx, available)
			if err != nil && ctx.Err() == nil {
				slog.Error("claim generation tasks", "run_type", config.RunType, "error", err)
			}
			for _, claim := range claims {
				slots <- struct{}{}
				go func(claim domaintask.PollSchedule) {
					defer func() { <-slots }()
					if err := scheduler.ProcessClaim(ctx, claim); err != nil && ctx.Err() == nil {
						slog.Error("process generation task", "run_type", config.RunType, "task_run_id", claim.TaskRunID, "error", err)
					}
				}(claim)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runLocalAsyncWorker(ctx context.Context, worker *applicationtask.LocalAsyncWorker) {
	const concurrency = 2
	slots := make(chan struct{}, concurrency)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		available := cap(slots) - len(slots)
		if available > 0 {
			claims, err := worker.Claim(ctx, available)
			if err != nil && ctx.Err() == nil {
				slog.Error("claim local async tasks", "error", err)
			}
			for _, claim := range claims {
				slots <- struct{}{}
				go func(claim domaintask.AsyncDispatch) {
					defer func() { <-slots }()
					if err := worker.ProcessClaim(ctx, claim); err != nil && ctx.Err() == nil {
						slog.Error("process local async task", "run_type", claim.RunType, "task_run_id", claim.TaskRunID, "error", err)
					}
				}(claim)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runDeletionProcessor(ctx context.Context, processor *applicationdeletion.Processor) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := processor.Process(ctx); err != nil && ctx.Err() == nil {
			slog.Error("process deletion cleanup", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runArchiveCleaner(ctx context.Context, cleaner *applicationcanvasarchive.Cleaner) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		if _, err := cleaner.CleanupDue(ctx, 5*time.Second); err != nil && ctx.Err() == nil {
			slog.Error("clean up expired Canvas archives", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runAssetClaimRelay(ctx context.Context, relay *applicationassetclaim.Relay) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if _, err := relay.RunOnce(ctx, 100); err != nil && ctx.Err() == nil {
			slog.Error("relay Canvas asset claims", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runQuotaReconciler(ctx context.Context, reconciler *applicationquota.Reconciler) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		runCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		err := reconciler.RunOnce(runCtx, false)
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.Error("reconcile Canvas quota ledger", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
