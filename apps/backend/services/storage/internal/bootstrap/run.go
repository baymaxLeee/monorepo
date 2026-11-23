package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	innerruntime "github.com/example/monorepo/inner-api-go/runtime"
	"github.com/example/monorepo/observability-go"
	httpapi "github.com/example/monorepo/storage/internal/api/http"
	rpcapi "github.com/example/monorepo/storage/internal/api/rpc"
	"github.com/example/monorepo/storage/internal/application"
	"github.com/example/monorepo/storage/internal/infrastructure/deliverycache"
	"github.com/example/monorepo/storage/internal/infrastructure/persistence"
	"github.com/example/monorepo/storage/internal/infrastructure/storage"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

type utcClock struct{}

func (utcClock) Now() time.Time { return time.Now().UTC() }

func Run(ctx context.Context) error {
	cfg, err := Load()
	if err != nil {
		return err
	}
	shutdownTelemetry, err := observability.Configure(ctx, "storage")
	if err != nil {
		return fmt.Errorf("configure telemetry: %w", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = shutdownTelemetry(shutdownCtx)
	}()
	connectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	repository, err := persistence.Connect(connectCtx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		return err
	}
	defer repository.Close()
	filesystem, err := storage.NewFilesystem(cfg.DataDir)
	if err != nil {
		return err
	}
	cache, err := deliverycache.New(cfg.RedisURL)
	if err != nil {
		return err
	}
	defer cache.Close()
	clock := utcClock{}
	service := application.NewService(repository, filesystem, clock, cfg.MaxUploadBytes)
	delivery := application.NewDeliveryService(service, cfg.SigningKey, cfg.DeliveryURLTTL, cache)
	collector := application.NewCollector(repository, filesystem, clock, cfg.CandidateAge, cfg.Retention)
	readiness := func(ctx context.Context) error {
		return errors.Join(repository.Ping(ctx), filesystem.Healthy(ctx, cfg.MinFreeBytes))
	}
	server := &http.Server{
		Addr: ":" + cfg.Port,
		Handler: otelhttp.NewHandler(httpapi.NewRouter(service, readiness, cfg.MaxUploadBytes, httpapi.RouterOptions{
			DeliverySigningKey: cfg.SigningKey,
		}), "storage"),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       0,
		WriteTimeout:      0,
		IdleTimeout:       120 * time.Second,
	}
	rpcListener, err := net.Listen("tcp", ":"+cfg.RPCPort)
	if err != nil {
		return fmt.Errorf("listen on storage RPC port: %w", err)
	}
	rpcServer := innerruntime.NewServer(innerruntime.ServerOptions{Authorizer: rpcapi.Authorizer(cfg.RPCAllowedCallers)})
	rpcapi.Register(rpcServer, service, delivery, func(session application.UploadSession) string {
		return httpapi.UploadSessionURL(cfg.SigningKey, session)
	})

	workerCtx, stopWorker := context.WithCancel(ctx)
	defer stopWorker()
	go runCollector(workerCtx, collector, cfg.GCInterval)
	serverErrors := make(chan error, 2)
	go func() {
		slog.Info("storage service starting", "port", cfg.Port, "environment", cfg.Environment, "data_dir", cfg.DataDir)
		serverErrors <- server.ListenAndServe()
	}()
	go func() {
		slog.Info("storage RPC service starting", "port", cfg.RPCPort)
		serverErrors <- rpcServer.Serve(rpcListener)
	}()
	defer rpcServer.Stop()
	select {
	case err = <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) || errors.Is(err, net.ErrClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		stopWorker()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()
		httpErr := server.Shutdown(shutdownCtx)
		stopped := make(chan struct{})
		go func() { rpcServer.GracefulStop(); close(stopped) }()
		select {
		case <-stopped:
		case <-shutdownCtx.Done():
			rpcServer.Stop()
		}
		return httpErr
	}
}

func runCollector(ctx context.Context, collector *application.Collector, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if err := collector.Run(ctx, 100); err != nil && ctx.Err() == nil {
			slog.Error("storage lifecycle collection failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
