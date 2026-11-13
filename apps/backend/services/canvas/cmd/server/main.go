package main

import (
	"log/slog"
	"os"

	"github.com/example/monorepo/canvas/internal/canvasruntime"
)

func main() {
	if err := canvasruntime.RunServer(); err != nil {
		slog.Error("canvas server stopped", "error", err)
		os.Exit(1)
	}
}
