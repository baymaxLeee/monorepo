package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	httpapi "github.com/example/monorepo/asset/internal/api/http"
	"github.com/example/monorepo/asset/internal/application"
	"github.com/example/monorepo/asset/internal/bootstrap"
	"github.com/example/monorepo/asset/internal/infrastructure/persistence"
	"github.com/example/monorepo/asset/internal/infrastructure/storage"
)

type utcClock struct{}

func (utcClock) Now() time.Time { return time.Now().UTC() }

func main() {
	cfg, err := bootstrap.Load()
	if err != nil {
		slog.Error("load asset configuration", "error", err)
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	repository, err := persistence.Connect(ctx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		slog.Error("connect asset database", "error", err)
		os.Exit(1)
	}
	defer repository.Close()
	filesystem, err := storage.NewFilesystem(cfg.DataDir)
	if err != nil {
		slog.Error("open asset storage", "error", err)
		os.Exit(1)
	}
	clock := utcClock{}
	service := application.NewService(repository, filesystem, clock, cfg.MaxUploadBytes)
	collector := application.NewCollector(repository, filesystem, clock, cfg.CandidateAge, cfg.Retention)
	readiness := func(ctx context.Context) error {
		return errors.Join(repository.Ping(ctx), filesystem.Healthy(ctx, cfg.MinFreeBytes))
	}
	server := &http.Server{
		Addr: ":" + cfg.Port,
		Handler: httpapi.NewRouter(service, readiness, cfg.InternalServiceTokens, cfg.MaxUploadBytes, httpapi.RouterOptions{
			DeliverySigningKey: cfg.SigningKey,
			DeliveryURLTTL:     cfg.DeliveryURLTTL,
		}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       0,
		WriteTimeout:      0,
		IdleTimeout:       120 * time.Second,
	}

	workerCtx, stopWorker := context.WithCancel(context.Background())
	defer stopWorker()
	go runCollector(workerCtx, collector, cfg.GCInterval)
	go func() {
		slog.Info("asset service starting", "port", cfg.Port, "environment", cfg.Environment, "data_dir", cfg.DataDir)
		if listenErr := server.ListenAndServe(); listenErr != nil && !errors.Is(listenErr, http.ErrServerClosed) {
			slog.Error("asset server failed", "error", listenErr)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	stopWorker()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	_ = server.Shutdown(shutdownCtx)
}

func runCollector(ctx context.Context, collector *application.Collector, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if err := collector.Run(ctx, 100); err != nil && ctx.Err() == nil {
			slog.Error("asset lifecycle collection failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
