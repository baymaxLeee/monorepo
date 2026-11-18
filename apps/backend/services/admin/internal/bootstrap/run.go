package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	httpapi "github.com/example/monorepo/admin/internal/api/http"
	rpcapi "github.com/example/monorepo/admin/internal/api/rpc"
	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/infrastructure/assetgroup"
	admincrypto "github.com/example/monorepo/admin/internal/infrastructure/crypto"
	"github.com/example/monorepo/admin/internal/infrastructure/health"
	"github.com/example/monorepo/admin/internal/infrastructure/persistence"
	"github.com/example/monorepo/admin/internal/infrastructure/providerprobe"
	"github.com/example/monorepo/admin/internal/infrastructure/storage"
	storagev1 "github.com/example/monorepo/inner-api-go/gen/storage/v1"
	innerruntime "github.com/example/monorepo/inner-api-go/runtime"
	"github.com/example/monorepo/observability-go"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func Run(ctx context.Context) error {
	config, err := Load()
	if err != nil {
		return err
	}
	shutdownTelemetry, err := observability.Configure(ctx, "admin")
	if err != nil {
		return fmt.Errorf("configure telemetry tracing: %w", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = shutdownTelemetry(shutdownCtx)
	}()
	pool, err := persistence.Open(ctx, config.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	redisClient := redis.NewClient(&redis.Options{Addr: config.RedisAddress, DB: config.RedisDB})
	defer redisClient.Close()
	if err = redisClient.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("ping redis: %w", err)
	}
	keys, err := admincrypto.NewSecretBox(config.AdminSecretKey)
	if err != nil {
		return err
	}
	errorClassifier := persistence.ErrorClassifier{}
	providerRepository := persistence.ProviderRepository{Pool: pool}
	providers := application.ProviderService{Repository: providerRepository, Keys: keys, Errors: errorClassifier, Probe: providerprobe.New()}
	apps := application.AppService{Repository: persistence.AppRepository{Pool: pool}, Errors: errorClassifier}
	canvas := application.CanvasSettingsService{Store: persistence.CanvasSettingsRepository{Pool: pool}, Providers: providerRepository}
	storageConnection, err := innerruntime.DialContext(ctx, config.StorageRPCTarget, innerruntime.ClientOptions{Caller: "admin", DefaultTimeout: config.ShutdownTimeout})
	if err != nil {
		return err
	}
	defer storageConnection.Close()
	skills := application.SkillService{
		Repository: persistence.SkillRepository{Pool: pool}, Assets: storage.New(storagev1.NewUploadSessionServiceClient(storageConnection), storagev1.NewAssetServiceClient(storageConnection), storagev1.NewDeliveryServiceClient(storageConnection)), Errors: errorClassifier,
		ArchiveMaxBytes: 256 * 1024 * 1024, ArchiveExpandedBytes: 512 * 1024 * 1024, AttachmentMaxBytes: 32 * 1024 * 1024,
	}
	benefitPackages := application.BenefitPackageService{
		Repository: persistence.BenefitPackageRepository{Pool: pool},
		Providers:  providerRepository,
		Groups:     assetgroup.New(),
		Keys:       keys,
		Errors:     errorClassifier,
	}
	readiness := health.Readiness{Postgres: pool, Redis: redisClient}
	handler := httpapi.New(readiness, providers, apps, canvas, skills, benefitPackages)
	server := &http.Server{Addr: fmt.Sprintf(":%d", config.Port), Handler: otelhttp.NewHandler(handler, "admin"), ReadHeaderTimeout: config.ShutdownTimeout}
	rpcListener, err := net.Listen("tcp", fmt.Sprintf(":%d", config.RPCPort))
	if err != nil {
		return fmt.Errorf("listen on admin RPC port: %w", err)
	}
	rpcServer := innerruntime.NewServer(innerruntime.ServerOptions{Authorizer: rpcapi.Authorizer()})
	rpcapi.Register(rpcServer, providers, canvas, &skills, benefitPackages)
	errCh := make(chan error, 2)
	go func() { errCh <- server.ListenAndServe() }()
	go func() { errCh <- rpcServer.Serve(rpcListener) }()
	defer rpcServer.Stop()
	select {
	case err = <-errCh:
		if errors.Is(err, http.ErrServerClosed) || errors.Is(err, net.ErrClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), config.ShutdownTimeout)
		defer cancel()
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
