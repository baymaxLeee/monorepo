package main

import (
	"log/slog"
	"os"

	"github.com/example/monorepo/canvas/internal/canvasruntime"
)

func main() {
	if err := canvasruntime.RunWorker(); err != nil {
		slog.Error("canvas worker stopped", "error", err)
		os.Exit(1)
	}
}
