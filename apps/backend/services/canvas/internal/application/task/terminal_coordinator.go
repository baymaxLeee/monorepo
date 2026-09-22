package task

import (
	"context"
	"errors"
	"strings"
	"time"

	domain "github.com/example/monorepo/canvas/internal/domain/task"
)

var (
	ErrTerminalCoordinatorInvalidInput = errors.New("task terminal coordinator input is invalid")
	ErrParentTerminalHandlerNotFound   = errors.New("parent terminal handler was not found")
	ErrParentTerminalCASLost           = errors.New("parent terminal compare-and-swap lost")
)

type ParentTerminalStore interface {
	GetTaskRunForUpdate(context.Context, string) (domain.TaskRun, error)
	UpdateTaskRun(context.Context, domain.TaskRun, TaskRunUpdate, time.Time) (bool, error)
}

// ParentTerminalHandler owns the domain-specific decision for one parent RunType.
// The coordinator owns hierarchy traversal and persistence.
type ParentTerminalHandler interface {
	ParentRunType() domain.RunType
	DecideParentTerminal(context.Context, domain.TaskRun, domain.TaskRun, time.Time) (TaskRunUpdate, error)
	OnParentTerminal(context.Context, domain.TaskRun) error
	AfterCommit(string)
}

type TerminalParent struct {
	TaskRunID string
	RunType   domain.RunType
}

type TerminalOutcome struct {
	Parents []TerminalParent
}

type TerminalCoordinator struct {
	tasks    ParentTerminalStore
	handlers map[domain.RunType]ParentTerminalHandler
}

func NewTerminalCoordinator(tasks ParentTerminalStore, handlers ...ParentTerminalHandler) (*TerminalCoordinator, error) {
	if tasks == nil {
		return nil, ErrTerminalCoordinatorInvalidInput
	}
	coordinator := &TerminalCoordinator{tasks: tasks, handlers: make(map[domain.RunType]ParentTerminalHandler, len(handlers))}
	for _, handler := range handlers {
		if handler == nil || strings.TrimSpace(string(handler.ParentRunType())) == "" {
			return nil, ErrTerminalCoordinatorInvalidInput
		}
		runType := handler.ParentRunType()
		if _, exists := coordinator.handlers[runType]; exists {
			return nil, ErrTerminalCoordinatorInvalidInput
		}
		coordinator.handlers[runType] = handler
	}
	return coordinator, nil
}

func (coordinator *TerminalCoordinator) OnTerminal(
	ctx context.Context,
	child domain.TaskRun,
	now time.Time,
) (TerminalOutcome, error) {
	if coordinator == nil || coordinator.tasks == nil || !child.Terminal() || now.IsZero() {
		return TerminalOutcome{}, ErrTerminalCoordinatorInvalidInput
	}
	outcome := TerminalOutcome{}
	visited := map[string]struct{}{child.ID: {}}
	for child.ParentTaskID != nil {
		parentID := strings.TrimSpace(*child.ParentTaskID)
		if parentID == "" {
			return TerminalOutcome{}, ErrInvalidTaskHierarchy
		}
		if _, exists := visited[parentID]; exists {
			return TerminalOutcome{}, ErrInvalidTaskHierarchy
		}
		visited[parentID] = struct{}{}
		parent, err := coordinator.tasks.GetTaskRunForUpdate(ctx, parentID)
		if err != nil {
			return TerminalOutcome{}, err
		}
		if !validParentRelationship(parent, child) {
			return TerminalOutcome{}, ErrInvalidTaskHierarchy
		}
		handler := coordinator.handlers[parent.RunType]
		if handler == nil {
			return TerminalOutcome{}, ErrParentTerminalHandlerNotFound
		}
		update, err := handler.DecideParentTerminal(ctx, parent, child, now)
		if err != nil {
			return TerminalOutcome{}, err
		}
		applied, err := coordinator.tasks.UpdateTaskRun(ctx, parent, update, now)
		if err != nil {
			return TerminalOutcome{}, err
		}
		if !applied {
			return TerminalOutcome{}, ErrParentTerminalCASLost
		}
		updatedParent := applyTaskRunUpdate(parent, update, now)
		if !updatedParent.Terminal() {
			return outcome, nil
		}
		if err = handler.OnParentTerminal(ctx, updatedParent); err != nil {
			return TerminalOutcome{}, err
		}
		outcome.Parents = append(outcome.Parents, TerminalParent{TaskRunID: updatedParent.ID, RunType: updatedParent.RunType})
		child = updatedParent
	}
	return outcome, nil
}

func (coordinator *TerminalCoordinator) AfterCommit(outcome TerminalOutcome) {
	if coordinator == nil {
		return
	}
	for _, parent := range outcome.Parents {
		if handler := coordinator.handlers[parent.RunType]; handler != nil {
			handler.AfterCommit(parent.TaskRunID)
		}
	}
}

func validParentRelationship(parent, child domain.TaskRun) bool {
	return parent.ID != "" && child.ParentTaskID != nil && parent.ID == *child.ParentTaskID &&
		parent.TenantID == child.TenantID && sameTaskWorkspace(parent.WorkspaceID, child.WorkspaceID) &&
		parent.EffectiveRootTaskID() == child.EffectiveRootTaskID()
}

func sameTaskWorkspace(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func applyTaskRunUpdate(run domain.TaskRun, update TaskRunUpdate, now time.Time) domain.TaskRun {
	run.Status = update.Status
	run.ErrorMessage = update.ErrorMessage
	if update.ErrorCode != "" {
		run.ErrorCode = update.ErrorCode
	}
	if update.StartedAt != nil {
		run.StartedAt = update.StartedAt
	}
	if update.FinishedAt != nil {
		run.FinishedAt = update.FinishedAt
	}
	run.StateVersion++
	run.UpdatedAt = now
	return run
}
