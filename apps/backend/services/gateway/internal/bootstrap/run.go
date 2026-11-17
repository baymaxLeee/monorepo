package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/example/monorepo/gateway/internal/api/http/handlers"
	"github.com/example/monorepo/gateway/internal/api/http/middleware"
	"github.com/example/monorepo/gateway/internal/bootstrap/config"
	"github.com/example/monorepo/gateway/internal/infrastructure/security"
	"github.com/example/monorepo/gateway/internal/infrastructure/store"
	"github.com/example/monorepo/observability-go"
	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func Run(ctx context.Context) error {
	middleware.SetupLogging("gateway")
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	shutdownTelemetry, err := observability.Configure(ctx, "gateway")
	if err != nil {
		slog.Error("failed to configure telemetry", "error", err)
		shutdownTelemetry = func(context.Context) error { return nil }
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = shutdownTelemetry(shutdownCtx)
	}()

	connectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	st, err := store.Connect(connectCtx, cfg.RedisURL)
	cancel()
	if err != nil {
		return fmt.Errorf("connect dependencies: %w", err)
	}
	defer st.Close()

	router := buildRouter(cfg, st)
	server := &http.Server{
		Addr: ":" + cfg.Port, Handler: router, ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: cfg.ReadTimeout, WriteTimeout: cfg.WriteTimeout, IdleTimeout: cfg.IdleTimeout,
	}
	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("gateway starting", "port", cfg.Port, "environment", cfg.Environment)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		return server.Shutdown(shutdownCtx)
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func buildRouter(cfg config.Config, st *store.Store) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.TraceId)
	router.Use(otelhttp.NewMiddleware("gateway", otelhttp.WithFilter(func(request *http.Request) bool {
		switch request.URL.Path {
		case "/livez", "/readyz", "/healthz":
			return false
		default:
			return true
		}
	})))
	router.Use(middleware.RequestLogger)
	router.Use(middleware.Recoverer)
	router.Use(middleware.BodyLimit(cfg.MaxRequestBodyBytes))
	router.Use(middleware.CORS(cfg.AllowedOrigins, cfg.IsDevelopment()))
	router.Use(middleware.SessionOriginGuard(cfg.AllowedOrigins, !cfg.IsDevelopment()))
	verifyToken := func(token string, now time.Time) (middleware.Claims, error) {
		claims, err := security.VerifyAccessToken(cfg.AccessTokenSecret, token, now)
		return middleware.Claims{
			Subject: claims.Subject, TenantID: claims.TenantID, Email: claims.Email, Name: claims.Name,
			WorkspaceID: claims.WorkspaceID, WorkspaceRole: claims.WorkspaceRole, Roles: claims.Roles,
		}, err
	}
	router.Use(middleware.IdentityPropagation(verifyToken, cfg.PublicPathPrefixes, cfg.PublicExactPaths, cfg.OptionalAuthPathPrefixes))
	if cfg.RateLimitEnabled {
		router.Use(middleware.TrustedClientIP(!cfg.IsDevelopment()))
		router.Use(middleware.RateLimit(st.Redis, cfg.RateLimitRequests, cfg.RateLimitWindow))
	}
	router.Get("/livez", handlers.Livez)
	readiness := func(ctx context.Context) error { return st.Redis.Ping(ctx).Err() }
	router.Get("/readyz", handlers.Healthz(readiness))
	router.Get("/healthz", handlers.Healthz(readiness))
	router.Get("/", handlers.Index)
	for _, upstream := range []struct{ path, target, name string }{
		{"/api/iam-server", cfg.IAMServiceURL, "iam-server"},
		{"/api/admin-server", cfg.AdminServiceURL, "admin-server"},
		{"/api/storage-server", cfg.AssetServiceURL, "storage-server"},
		{"/api/canvas-server", cfg.CanvasServiceURL, "canvas-server"},
		{"/api/chat-server", cfg.ChatServiceURL, "chat-server"},
		{"/api/knowledge-server", cfg.KnowledgeServiceURL, "knowledge-server"},
		{"/api/telemetry-server", cfg.TelemetryServiceURL, "telemetry-server"},
	} {
		router.Mount(upstream.path, handlers.NewServiceProxy(upstream.target, upstream.name, upstream.path))
	}
	return router
}
