package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	httpapi "github.com/example/monorepo/chat/internal/api/http"
	"github.com/example/monorepo/chat/internal/application"
	adminclient "github.com/example/monorepo/chat/internal/infrastructure/admin"
	"github.com/example/monorepo/chat/internal/infrastructure/persistence"
	runtimeclient "github.com/example/monorepo/chat/internal/infrastructure/runtime"
	innerruntime "github.com/example/monorepo/inner-api-go/runtime"
	"github.com/example/monorepo/observability-go"
	"github.com/joho/godotenv"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func Run(ctx context.Context) error {
	_ = godotenv.Load()
	config, err := LoadConfig()
	if err != nil {
		return err
	}
	shutdownTelemetry, err := observability.Configure(ctx, "chat")
	if err != nil {
		return fmt.Errorf("configure telemetry tracing: %w", err)
	}
	defer func() {
		shutdownContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = shutdownTelemetry(shutdownContext)
	}()
	repository, err := persistence.Open(ctx, config.DatabaseURL)
	if err != nil {
		return err
	}
	adminConnection, err := innerruntime.DialContext(ctx, config.AdminRPCTarget, innerruntime.ClientOptions{
		Caller: "chat", DefaultTimeout: 30 * time.Second,
	})
	if err != nil {
		return err
	}
	defer adminConnection.Close()
	service := application.NewService(
		repository,
		runtimeclient.New(config.RuntimeURL, config.InternalAPIToken),
		adminclient.NewCapabilityResolver(adminConnection),
	)
	defer service.Close()

	server := &http.Server{
		Addr:              fmt.Sprintf(":%d", config.Port),
		Handler:           otelhttp.NewHandler(httpapi.New(service), "chat"),
		ReadHeaderTimeout: 10 * time.Second,
	}
	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("chat listening", "port", config.Port)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), config.ShutdownTimeout)
		defer cancel()
		return server.Shutdown(shutdownContext)
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
