package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/example/monorepo/observability-go"
	httpapi "github.com/example/monorepo/telemetry/internal/api/http"
	"github.com/example/monorepo/telemetry/internal/application"
	"github.com/example/monorepo/telemetry/internal/infrastructure/clickhouse"
	"github.com/example/monorepo/telemetry/internal/infrastructure/persistence"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func Run(ctx context.Context) error {
	config, err := Load()
	if err != nil {
		return err
	}
	shutdownTelemetry, err := observability.Configure(ctx, "telemetry")
	if err != nil {
		return fmt.Errorf("configure telemetry tracing: %w", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = shutdownTelemetry(shutdownCtx)
	}()

	repository, err := persistence.Open(ctx, config.DatabaseURL, config.Environment)
	if err != nil {
		return err
	}
	defer repository.Close()
	traceStore := clickhouse.New(config.ClickHouseHTTPURL, config.ClickHouseUser, config.ClickHousePassword)
	service := application.NewService(repository, traceStore, config.Environment, config.OTELExporterEndpoint, config.SampleRatePerform, config.SampleRateEvent)
	handler := otelhttp.NewHandler(httpapi.New(service), "telemetry")
	server := &http.Server{Addr: ":" + config.Port, Handler: handler, ReadHeaderTimeout: 10 * time.Second}

	errorChannel := make(chan error, 1)
	go func() {
		slog.Info("telemetry server listening", "port", config.Port)
		errorChannel <- server.ListenAndServe()
	}()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	case err := <-errorChannel:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
