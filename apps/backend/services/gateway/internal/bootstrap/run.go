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
	"github.com/example/monorepo/httpserver-go"
	"github.com/example/monorepo/observability-go"
	"github.com/gin-gonic/gin"
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
		ReadTimeout: cfg.DefaultTimeout, WriteTimeout: cfg.DefaultTimeout, IdleTimeout: cfg.IdleTimeout,
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
	router := httpserver.New("gateway")
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
	router.GET("/livez", handlers.Livez)
	readiness := func(ctx context.Context) error { return st.Redis.Ping(ctx).Err() }
	router.GET("/readyz", handlers.Healthz(readiness))
	router.GET("/healthz", handlers.Healthz(readiness))
	router.GET("/", handlers.Index)
	for _, upstream := range []struct{ path, target, name string }{
		{"/api/iam-server", cfg.IAMServiceURL, "iam-server"},
		{"/api/admin-server", cfg.AdminServiceURL, "admin-server"},
		{"/api/storage-server", cfg.AssetServiceURL, "storage-server"},
		{"/api/canvas-server", cfg.CanvasServiceURL, "canvas-server"},
		{"/api/chat-server", cfg.ChatServiceURL, "chat-server"},
		{"/api/knowledge-server", cfg.KnowledgeServiceURL, "knowledge-server"},
		{"/api/telemetry-server", cfg.TelemetryServiceURL, "telemetry-server"},
	} {
		proxy := handlers.NewServiceProxy(upstream.target, upstream.name, upstream.path, cfg.DefaultTimeout)
		serveProxy := func(c *gin.Context) { proxy.ServeHTTP(c.Writer, c.Request) }
		router.Any(upstream.path, serveProxy)
		router.Any(upstream.path+"/*path", serveProxy)
	}
	return router
}
