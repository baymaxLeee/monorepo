// seed-plugins publishes the shipped releases using Admin's database role and standard libpq environment.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/infrastructure/persistence"
	"github.com/example/monorepo/admin/seed"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	pool, err := pgxpool.New(ctx, "")
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	service := application.NewAgentPluginService(persistence.AgentPluginRepository{Pool: pool}, nil, persistence.ErrorClassifier{})
	if err := seed.PublishPlugins(ctx, service, os.Getenv("KNOWLEDGE_SERVICE_URL"), os.Getenv("CANVAS_SERVICE_URL")); err != nil {
		log.Fatal(err)
	}
}
