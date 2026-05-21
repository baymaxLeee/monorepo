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

	"github.com/example/monorepo/api-gateway/internal/config"
	"github.com/example/monorepo/api-gateway/internal/handlers"
	"github.com/example/monorepo/api-gateway/internal/middleware"
	"github.com/example/monorepo/api-gateway/internal/store"
	"github.com/go-chi/chi/v5"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	st, err := store.Connect(ctx, cfg.DatabaseURL, cfg.RedisURL)
	cancel()
	if err != nil {
		slog.Error("failed to connect dependencies", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	r := chi.NewRouter()
	r.Use(middleware.RequestLogger)
	r.Use(middleware.Recoverer)

	r.Get("/healthz", handlers.Healthz(st))
	r.Get("/", handlers.Index)
	r.Mount("/v1/auth", handlers.NewIdentityProxy(cfg.IdentityServiceURL))
	r.Mount("/v1/bots", handlers.NewAdminProxy(cfg.AdminServiceURL))

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		slog.Info("api-gateway starting",
			"port", cfg.Port,
			"admin_upstream", cfg.AdminServiceURL,
			"identity_upstream", cfg.IdentityServiceURL,
			"mysql", "connected",
			"redis", "connected",
		)
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
