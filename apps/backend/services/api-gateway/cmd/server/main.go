package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/example/monorepo/api-gateway/internal/handlers"
	"github.com/example/monorepo/api-gateway/internal/middleware"
	"github.com/go-chi/chi/v5"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	botUpstream := os.Getenv("BOT_SERVICE_URL")
	if botUpstream == "" {
		botUpstream = "http://localhost:8001"
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestLogger)
	r.Use(middleware.Recoverer)

	// Meta
	r.Get("/healthz", handlers.Healthz)
	r.Get("/", handlers.Index)

	// Proxy /v1/bots/* → bot service
	r.Mount("/v1/bots", handlers.NewBotProxy(botUpstream))

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		slog.Info("api-gateway starting", "port", port, "bot_upstream", botUpstream)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()

	// Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	slog.Info("shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
