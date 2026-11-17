package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/example/monorepo/canvas/internal/bootstrap"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := bootstrap.RunServer(ctx); err != nil {
		slog.Error("canvas server stopped", "error", err)
		os.Exit(1)
	}
}
