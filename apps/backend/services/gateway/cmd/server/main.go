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

	"github.com/example/monorepo/gateway/internal/api/http/handlers"
	"github.com/example/monorepo/gateway/internal/api/http/middleware"
	"github.com/example/monorepo/gateway/internal/bootstrap/config"
	"github.com/example/monorepo/gateway/internal/infrastructure/observability"
	"github.com/example/monorepo/gateway/internal/infrastructure/store"
	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func main() {
	middleware.SetupLogging("gateway")

	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load configuration", "err", err)
		os.Exit(1)
	}
	shutdownTelemetry, err := observability.Configure(context.Background(), "gateway")
	if err != nil {
		slog.Error("failed to configure telemetry", "err", err)
		shutdownTelemetry = func(context.Context) error { return nil }
	}
	defer func() {
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		_ = shutdownTelemetry(shutdownCtx)
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	st, err := store.Connect(ctx, cfg.RedisURL)
	cancel()
	if err != nil {
		slog.Error("failed to connect dependencies", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	r := chi.NewRouter()
	r.Use(middleware.TraceId)
	r.Use(otelhttp.NewMiddleware("gateway", otelhttp.WithFilter(func(r *http.Request) bool {
		switch r.URL.Path {
		case "/livez", "/readyz", "/healthz":
			return false
		default:
			return true
		}
	})))
	r.Use(middleware.RequestLogger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.BodyLimit(cfg.MaxRequestBodyBytes))
	r.Use(middleware.CORS(cfg.AllowedOrigins, !cfg.IsProduction()))
	r.Use(middleware.IdentityPropagation(cfg.AccessTokenSecret, cfg.PublicPathPrefixes, cfg.PublicExactPaths, cfg.OptionalAuthPathPrefixes))
	if cfg.RateLimitEnabled {
		r.Use(middleware.RateLimit(cfg.RateLimitRequests, cfg.RateLimitWindow))
	}

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
	r.Mount("/api/knowledge-server", handlers.NewServiceProxy(
		cfg.KnowledgeServiceURL,
		"knowledge-server",
		"/api/knowledge-server",
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
			"knowledge_upstream", cfg.KnowledgeServiceURL,
			"telemetry_upstream", cfg.TelemetryServiceURL,
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
