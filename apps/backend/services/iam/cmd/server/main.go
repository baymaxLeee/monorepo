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

	cfg := config.Load()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	st, err := crud.Connect(ctx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		slog.Error("failed to connect database", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	if err := st.AutoMigrate(ctx); err != nil {
		cancel()
		slog.Error("failed to initialize schema", "err", err)
		os.Exit(1)
	}
	if err := service.SeedDemoSuperAdmin(ctx, st, cfg); err != nil {
		cancel()
		slog.Error("failed to seed super admin", "err", err)
		os.Exit(1)
	}
	cancel()

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
