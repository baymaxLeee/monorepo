package main

import (
	"context"
	"errors"
	api "github.com/example/monorepo/canvas/internal/api/http"
	"github.com/example/monorepo/canvas/internal/application"
	"github.com/example/monorepo/canvas/internal/bootstrap"
	"github.com/example/monorepo/canvas/internal/infrastructure/executor"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("canvas stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	cfg, err := bootstrap.Load()
	if err != nil {
		return err
	}
	db, err := bootstrap.Connect(cfg)
	if err != nil {
		return err
	}
	sql, err := db.DB()
	if err != nil {
		return err
	}
	defer sql.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	service := &application.Service{Storage: &storage.Client{URL: bootstrap.Env("KNOWLEDGE_SERVICE_URL", "http://localhost:8010"), Token: cfg.InternalToken}, DB: db, Executor: &executor.Client{URL: bootstrap.Env("EXECUTOR_SERVICE_URL", "http://localhost:8011"), Token: cfg.InternalToken}}
	go service.RunGenerations(ctx)
	go service.RunArchives(ctx)
	go service.RunVideoFrames(ctx)
	server := &http.Server{Addr: ":" + cfg.Port, Handler: api.Router(service, cfg.InternalToken), ReadHeaderTimeout: 10 * time.Second}
	done := make(chan error, 1)
	go func() { done <- server.ListenAndServe() }()
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
	return nil
}
