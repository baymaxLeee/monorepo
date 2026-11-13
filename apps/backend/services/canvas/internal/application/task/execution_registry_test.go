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

func TestCanvasMediaUtilitiesUseLocalAsyncWorker(t *testing.T) {
	for _, runType := range []domaintask.RunType{
		domaintask.RunTypeCanvasVideoArchiveExport,
		domaintask.RunTypeCanvasNodeVideoFirstLastFrameExtraction,
	} {
		backend, ok := ExecutionBackendForRunType(runType)
		if !ok || backend != ExecutionBackendLocalAsync {
			t.Fatalf("%s backend = %q, %v; want %q, true", runType, backend, ok, ExecutionBackendLocalAsync)
		}
	}
}
