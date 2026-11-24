package bootstrap

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
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
	pool, err := Connect(ctx, cfg)
	if err != nil {
		return err
	}
	defer pool.Close()
	db := transaction.New(pool)
	redisOptions, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return err
	}
	redisClient := redis.NewClient(redisOptions)
	defer redisClient.Close()
	if err = redisClient.Ping(ctx).Err(); err != nil {
		return err
	}
	handler, err := buildModules(ctx, role, cfg, db, pool, redisClient)
	if err != nil {
		return err
	}
	return serveHTTP(ctx, cfg.Port, handler)
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
