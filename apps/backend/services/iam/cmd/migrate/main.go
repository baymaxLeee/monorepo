package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/example/monorepo/iam/internal/config"
	"github.com/example/monorepo/iam/internal/crud"
	"github.com/example/monorepo/iam/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg := config.Load()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	st, err := crud.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect database", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	if err := st.AutoMigrate(ctx); err != nil {
		slog.Error("failed to initialize schema", "err", err)
		os.Exit(1)
	}
	if err := service.SeedDemoSuperAdmin(ctx, st, cfg); err != nil {
		slog.Error("failed to seed super admin", "err", err)
		os.Exit(1)
	}
	slog.Info("iam schema ready")
}
