package task

import (
	"errors"
	"fmt"

	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

var ErrExecutionBackendMismatch = errors.New("task run execution backend mismatch")

type ExecutionBackend string

const (
	ExecutionBackendLocalScheduled ExecutionBackend = "LOCAL_SCHEDULED"
	ExecutionBackendWorkerMQ       ExecutionBackend = "WORKER_MQ"
)

type ExecutionRegistration struct {
	RunType       domaintask.RunType
	Backend       ExecutionBackend
	PollProcessor PollProcessor
	AsyncStarter  AsyncExecutionStarter
}

type ExecutionRegistry struct {
	entries map[domaintask.RunType]ExecutionRegistration
}

var executionBackends = []struct {
	runType domaintask.RunType
	backend ExecutionBackend
}{
	{domaintask.RunTypeCanvasNodeVideoGeneration, ExecutionBackendLocalScheduled},
	{domaintask.RunTypeCanvasNodeTextGeneration, ExecutionBackendLocalScheduled},
	{domaintask.RunTypeCanvasStoryboardGeneration, ExecutionBackendLocalScheduled},
	{domaintask.RunTypeImageGeneration, ExecutionBackendLocalScheduled},
	{domaintask.RunTypeCanvasNodeAssetsMatch, ExecutionBackendLocalScheduled},
	{domaintask.RunTypeAssetReview, ExecutionBackendLocalScheduled},
	{domaintask.RunTypeCanvasVideoArchiveExport, ExecutionBackendWorkerMQ},
	{domaintask.RunTypeCanvasNodeVideoFirstLastFrameExtraction, ExecutionBackendWorkerMQ},
}

func ExecutionBackendForRunType(runType domaintask.RunType) (ExecutionBackend, bool) {
	for _, definition := range executionBackends {
		if definition.runType == runType {
			return definition.backend, true
		}
	}
	return "", false
}

func NewExecutionRegistry(processors []PollProcessor, starters []AsyncExecutionStarter) (*ExecutionRegistry, error) {
	entries := make(map[domaintask.RunType]ExecutionRegistration, len(executionBackends))
	for _, definition := range executionBackends {
		entries[definition.runType] = ExecutionRegistration{RunType: definition.runType, Backend: definition.backend}
	}
	for _, processor := range processors {
		if processor == nil {
			continue
		}
		runType := processor.RunType()
		entry, ok := entries[runType]
		if !ok || entry.Backend != ExecutionBackendLocalScheduled {
			return nil, fmt.Errorf("poll processor has unsupported execution backend for %s", runType)
		}
		if entry.PollProcessor != nil {
			return nil, fmt.Errorf("poll processor is registered more than once for %s", runType)
		}
		entry.PollProcessor = processor
		entries[runType] = entry
	}
	for _, starter := range starters {
		if starter == nil {
			continue
		}
		runType := starter.RunType()
		entry, ok := entries[runType]
		if !ok || entry.Backend != ExecutionBackendWorkerMQ {
			return nil, fmt.Errorf("async execution starter has unsupported execution backend for %s", runType)
		}
		if entry.AsyncStarter != nil {
			return nil, fmt.Errorf("async execution starter is registered more than once for %s", runType)
		}
		entry.AsyncStarter = starter
		entries[runType] = entry
	}
	for _, definition := range executionBackends {
		entry := entries[definition.runType]
		if entry.Backend == ExecutionBackendLocalScheduled && entry.PollProcessor == nil {
			return nil, fmt.Errorf("poll processor is not configured for %s", entry.RunType)
		}
		if entry.Backend == ExecutionBackendWorkerMQ && entry.AsyncStarter == nil {
			return nil, fmt.Errorf("async execution starter is not configured for %s", entry.RunType)
		}
	}
	return &ExecutionRegistry{entries: entries}, nil
}

func (r *ExecutionRegistry) Get(runType domaintask.RunType) (ExecutionRegistration, bool) {
	if r == nil {
		return ExecutionRegistration{}, false
	}
	entry, ok := r.entries[runType]
	return entry, ok
}

func (r *ExecutionRegistry) LocalScheduled() []ExecutionRegistration {
	if r == nil {
		return nil
	}
	entries := make([]ExecutionRegistration, 0, len(executionBackends))
	for _, definition := range executionBackends {
		if definition.backend == ExecutionBackendLocalScheduled {
			entries = append(entries, r.entries[definition.runType])
		}
	}
	return entries
}
