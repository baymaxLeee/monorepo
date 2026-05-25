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

	"github.com/example/monorepo/iam/internal/config"
	"github.com/example/monorepo/iam/internal/crud"
	"github.com/example/monorepo/iam/internal/router"
	"github.com/example/monorepo/iam/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load configuration", "err", err)
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	st, err := crud.Connect(ctx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		slog.Error("failed to connect database", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	// Demo super-admin is a dev convenience. In production, the bootstrap
	// admin is created via explicit migrations / admin tooling.
	if !cfg.IsProduction() {
		ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
		if err := service.SeedDemoSuperAdmin(ctx, st, cfg); err != nil {
			cancel()
			slog.Error("failed to seed super admin", "err", err)
			os.Exit(1)
		}
		cancel()
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router.New(st, cfg),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		slog.Info("iam starting", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	slog.Info("shutting down")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(shutdownCtx)
}
