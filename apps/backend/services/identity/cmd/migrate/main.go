package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/example/monorepo/identity/internal/config"
	"github.com/example/monorepo/identity/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg := config.Load()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	st, err := store.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect database", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	if err := st.InitSchema(ctx); err != nil {
		slog.Error("failed to initialize schema", "err", err)
		os.Exit(1)
	}
	slog.Info("identity schema ready")
}
