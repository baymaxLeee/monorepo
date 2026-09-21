package task

import (
	"context"
	"errors"
	"sync"
)

var ErrExecutionAlreadyActive = errors.New("task execution is already active")

// ActiveExecutions owns the in-process cancellation handles of work claimed by
// the shared task coordinator. Durable ownership still comes from PollSchedule
// leases; this registry only makes an explicit TaskRun cancellation immediate.
type ActiveExecutions struct {
	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

func NewActiveExecutions() *ActiveExecutions {
	return &ActiveExecutions{cancels: make(map[string]context.CancelFunc)}
}

func (e *ActiveExecutions) Run(parent context.Context, taskRunID string, execute func(context.Context) error) error {
	if e == nil || execute == nil || taskRunID == "" {
		return errors.New("task active execution dependencies are not configured")
	}
	ctx, cancel := context.WithCancel(parent)
	e.mu.Lock()
	if _, exists := e.cancels[taskRunID]; exists {
		e.mu.Unlock()
		cancel()
		return ErrExecutionAlreadyActive
	}
	e.cancels[taskRunID] = cancel
	e.mu.Unlock()
	defer func() {
		e.mu.Lock()
		delete(e.cancels, taskRunID)
		e.mu.Unlock()
		cancel()
	}()
	return execute(ctx)
}

func (e *ActiveExecutions) Cancel(taskRunID string) bool {
	if e == nil {
		return false
	}
	e.mu.Lock()
	cancel, exists := e.cancels[taskRunID]
	e.mu.Unlock()
	if exists {
		cancel()
	}
	return exists
}
