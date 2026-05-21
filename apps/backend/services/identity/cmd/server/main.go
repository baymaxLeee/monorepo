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

	"github.com/example/monorepo/identity/internal/config"
	"github.com/example/monorepo/identity/internal/handlers"
	"github.com/example/monorepo/identity/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg := config.Load()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	st, err := store.Connect(ctx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		slog.Error("failed to connect database", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	if err := st.InitSchema(ctx); err != nil {
		cancel()
		slog.Error("failed to initialize schema", "err", err)
		os.Exit(1)
	}
	cancel()

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handlers.NewRouter(st, cfg),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		slog.Info("identity starting", "port", cfg.Port)
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
