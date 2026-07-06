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

	// `server seed` is the one-shot identity bootstrap, run as an explicit
	// deploy-time step (compose one-shot container / k8s Job) after migrations.
	// The server path deliberately does NOT seed, so N replicas never race the
	// bootstrap on every start. Any other subcommand exits non-zero rather than
	// silently starting the HTTP server — a stale `migrate` arg (removed in
	// ADR-0029) would otherwise spawn a phantom server that never completes.
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "seed":
			runSeed(cfg)
			return
		default:
			slog.Error("unknown subcommand; supported: seed", "arg", os.Args[1])
			os.Exit(2)
		}
	}

	runServer(cfg)
}

func runSeed(cfg config.Config) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	st, err := crud.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect database", "err", err)
		os.Exit(1)
	}
	defer st.Close()
	if err := service.EnsureSystemBootstrap(ctx, st, cfg); err != nil {
		slog.Error("failed to bootstrap system identity", "err", err)
		os.Exit(1)
	}
	slog.Info("iam system bootstrap complete")
}

func runServer(cfg config.Config) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	st, err := crud.Connect(ctx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		slog.Error("failed to connect database", "err", err)
		os.Exit(1)
	}
	defer st.Close()

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
