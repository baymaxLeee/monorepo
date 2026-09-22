package task

import (
	"testing"

	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

func TestCanvasTextGenerationUsesLocalScheduler(t *testing.T) {
	backend, ok := ExecutionBackendForRunType(domaintask.RunTypeCanvasNodeTextGeneration)
	if !ok || backend != ExecutionBackendLocalScheduled {
		t.Fatalf("text generation backend = %q, %v; want %q, true", backend, ok, ExecutionBackendLocalScheduled)
	}
}
