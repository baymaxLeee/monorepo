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

	"github.com/example/monorepo/gateway/internal/config"
	"github.com/example/monorepo/gateway/internal/handlers"
	"github.com/example/monorepo/gateway/internal/middleware"
	"github.com/example/monorepo/gateway/internal/store"
	"github.com/go-chi/chi/v5"
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
	st, err := store.Connect(ctx, cfg.DatabaseURL, cfg.RedisURL)
	cancel()
	if err != nil {
		slog.Error("failed to connect dependencies", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	r := chi.NewRouter()
	r.Use(middleware.TraceId)
	r.Use(middleware.RequestLogger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.BodyLimit(cfg.MaxRequestBodyBytes))
	// dev: also accept any http://localhost:* / 127.0.0.1:* Origin so port
	// changes don't break the SPA. prod: strict allowlist only.
	r.Use(middleware.CORS(cfg.AllowedOrigins, !cfg.IsProduction()))
	r.Use(middleware.IdentityPropagation(cfg.AccessTokenSecret, cfg.PublicPathPrefixes, cfg.OptionalAuthPathPrefixes))

	r.Get("/livez", handlers.Livez)
	r.Get("/readyz", handlers.Healthz(st))
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
	r.Mount("/api/chat-server", handlers.NewServiceProxy(
		cfg.ChatServiceURL,
		"chat-server",
		"/api/chat-server",
	))
	r.Mount("/api/telemetry-server", handlers.NewServiceProxy(
		cfg.TelemetryServiceURL,
		"telemetry-server",
		"/api/telemetry-server",
	))

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
	}

	go func() {
		slog.Info("gateway starting",
			"port", cfg.Port,
			"environment", cfg.Environment,
			"admin_upstream", cfg.AdminServiceURL,
			"chat_upstream", cfg.ChatServiceURL,
			"iam_upstream", cfg.IAMServiceURL,
			"telemetry_upstream", cfg.TelemetryServiceURL,
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
