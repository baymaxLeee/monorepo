package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/example/monorepo/iam/internal/api/http/middleware"
	"github.com/example/monorepo/iam/internal/api/http/router"
	"github.com/example/monorepo/iam/internal/application"
	"github.com/example/monorepo/iam/internal/bootstrap/config"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/repositories"
	"github.com/example/monorepo/iam/internal/infrastructure/security"
	"github.com/example/monorepo/iam/internal/infrastructure/securityadapter"
	"github.com/example/monorepo/observability-go"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func RunSeed(ctx context.Context) error {
	middleware.SetupLogging("iam-seed")
	cfg, err := config.LoadSeed()
	if err != nil {
		return fmt.Errorf("load seed configuration: %w", err)
	}
	connectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	store, err := repositories.Connect(connectCtx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer store.Close()
	if err := application.EnsureSystemBootstrap(connectCtx, store, securityadapter.Service{}, application.SeedConfig{
		SuperAdminID: cfg.SuperAdminID, SuperAdminAccount: cfg.SuperAdminAccount,
		SuperAdminEmail: cfg.SuperAdminEmail, SuperAdminPassword: cfg.SuperAdminPassword,
		SuperAdminDisplayName: cfg.SuperAdminDisplayName, GuestWorkspaceID: cfg.GuestWorkspaceID,
		GuestWorkspaceName: cfg.GuestWorkspaceName, GuestWorkspaceSlug: cfg.GuestWorkspaceSlug,
	}); err != nil {
		return fmt.Errorf("bootstrap system identity: %w", err)
	}
	slog.Info("iam system bootstrap complete")
	return nil
}

func RunServer(ctx context.Context) error {
	middleware.SetupLogging("iam")
	cfg, err := config.LoadServer()
	if err != nil {
		return fmt.Errorf("load server configuration: %w", err)
	}
	shutdownTelemetry, err := observability.Configure(ctx, "iam")
	if err != nil {
		return fmt.Errorf("configure telemetry: %w", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = shutdownTelemetry(shutdownCtx)
	}()
	connectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	store, err := repositories.Connect(connectCtx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer store.Close()

	securityService := securityadapter.Service{}
	auth := application.NewAuthService(store, application.AuthConfig{
		AccessTokenSecret: cfg.AccessTokenSecret, AccessTokenTTL: cfg.AccessTokenTTL,
		RefreshTokenTTL: cfg.RefreshTokenTTL, GuestWorkspaceID: cfg.GuestWorkspaceID,
	}, securityService)
	roles := application.NewRoleService(store)
	workspace := application.NewWorkspaceService(store, application.WorkspaceConfig{GuestWorkspaceID: cfg.GuestWorkspaceID}, securityService)
	verify := func(token string, now time.Time) (router.Claims, error) {
		claims, verifyErr := security.VerifyAccessToken(cfg.AccessTokenSecret, token, now)
		return router.Claims{
			TenantID: claims.TenantID, Subject: claims.Subject, Email: claims.Email, Name: claims.Name,
			WorkspaceID: claims.WorkspaceID, WorkspaceRole: claims.WorkspaceRole, Roles: claims.Roles,
		}, verifyErr
	}
	handler := router.New(router.Dependencies{
		Store: store,
		Config: router.Config{
			RefreshCookieName: cfg.RefreshCookieName, RefreshCookieDomain: cfg.RefreshCookieDomain,
			RefreshCookieSecure: cfg.RefreshCookieSecure, RefreshCookieSameSite: cfg.RefreshCookieSameSite,
		},
		Auth: auth, Roles: roles, Workspace: workspace, Verify: verify,
		IsNotFound: func(err error) bool { return errors.Is(err, repositories.ErrNotFound) },
	})
	server := &http.Server{Addr: ":" + cfg.Port, Handler: otelhttp.NewHandler(handler, "iam"), ReadHeaderTimeout: 5 * time.Second}
	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("iam starting", "port", cfg.Port)
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
