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
	r.Use(middleware.CORS(cfg.AllowedOrigins))
	r.Use(middleware.IdentityPropagation(cfg.AccessTokenSecret, cfg.PublicPathPrefixes))

	r.Get("/healthz", handlers.Healthz(st))
	r.Get("/", handlers.Index)
	r.Mount("/api/iam-server", handlers.NewServiceProxy(
		cfg.IAMServiceURL,
		"iam-server",
		"/api/iam-server",
	))
	r.Mount("/api/admin-server", handlers.NewServiceProxy(
		cfg.AdminServiceURL,
		"admin-server",
		"/api/admin-server",
	))

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		slog.Info("api-gateway starting",
			"port", cfg.Port,
			"admin_upstream", cfg.AdminServiceURL,
			"iam_upstream", cfg.IAMServiceURL,
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
