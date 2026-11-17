package bootstrap

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"

	rpcapi "github.com/example/monorepo/canvas/internal/api/rpc"
	canvasv1 "github.com/example/monorepo/inner-api-go/gen/canvas/v1"
	innerruntime "github.com/example/monorepo/inner-api-go/runtime"
	"github.com/example/monorepo/observability-go"
	"github.com/redis/go-redis/v9"
)

func RunServer(ctx context.Context) error { return run(ctx, roleServer) }

func RunWorker(ctx context.Context) error { return run(ctx, roleWorker) }

func run(ctx context.Context, role processRole) error {
	cfg, err := Load()
	if err != nil {
		return err
	}
	serviceName := "canvas"
	if role == roleWorker {
		serviceName = "canvas-worker"
	}
	shutdownTelemetry, err := observability.Configure(context.Background(), serviceName)
	if err != nil {
		return err
	}
	defer func() {
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = shutdownTelemetry(shutdown)
	}()
	db, err := Connect(cfg)
	if err != nil {
		return err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	redisOptions, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return err
	}
	redisClient := redis.NewClient(redisOptions)
	defer redisClient.Close()
	if err = redisClient.Ping(ctx).Err(); err != nil {
		return err
	}
	var rpcService *rpcapi.Server
	handler, err := buildModules(ctx, role, cfg, db, sqlDB, redisClient, &rpcService)
	if err != nil {
		return err
	}
	if role == roleWorker {
		return serveHTTP(ctx, cfg.Port, handler)
	}
	return serveServer(ctx, cfg, handler, rpcService)
}

func serveServer(ctx context.Context, cfg Config, handler http.Handler, service *rpcapi.Server) error {
	if service == nil {
		return errors.New("canvas RPC service is not configured")
	}
	listener, err := net.Listen("tcp", ":"+cfg.RPCPort)
	if err != nil {
		return err
	}
	defer listener.Close()
	server := innerruntime.NewServer(innerruntime.ServerOptions{Authorizer: rpcapi.Authorizer()})
	canvasv1.RegisterCanvasServiceServer(server, service)
	done := make(chan error, 2)
	go func() { done <- serveHTTP(ctx, cfg.Port, handler) }()
	go func() { done <- server.Serve(listener) }()
	select {
	case err = <-done:
		if errors.Is(err, net.ErrClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		stopped := make(chan struct{})
		go func() { server.GracefulStop(); close(stopped) }()
		select {
		case <-stopped:
		case <-time.After(25 * time.Second):
			server.Stop()
		}
		return nil
	}
}

func serveHTTP(ctx context.Context, port string, handler http.Handler) error {
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		BaseContext:       func(net.Listener) context.Context { return ctx },
		ReadHeaderTimeout: 10 * time.Second,
	}
	done := make(chan error, 1)
	go func() { done <- server.ListenAndServe() }()
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
	return nil
}
