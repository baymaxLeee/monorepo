package videogeneration

import (
	"context"
	"time"

	applicationprojectusage "github.com/example/monorepo/canvas/internal/application/projectusage"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

type ParentUsageFinalizer interface {
	Close(context.Context, applicationprojectusage.CloseInput) error
	TriggerAfterCommit(string) bool
}

// FirstLastFrameParentAggregator owns the video-generation rule for completing
// a parent after its first/last-frame child reaches a supported terminal state.
type FirstLastFrameParentAggregator struct {
	usage ParentUsageFinalizer
}

func NewFirstLastFrameParentAggregator(usage ParentUsageFinalizer) *FirstLastFrameParentAggregator {
	return &FirstLastFrameParentAggregator{usage: usage}
}

func (*FirstLastFrameParentAggregator) ParentRunType() domaintask.RunType {
	return domaintask.RunTypeCanvasNodeVideoGeneration
}

func (aggregator *FirstLastFrameParentAggregator) DecideParentTerminal(
	ctx context.Context,
	parent domaintask.TaskRun,
	child domaintask.TaskRun,
	now time.Time,
) (applicationtask.TaskRunUpdate, error) {
	_ = ctx
	if aggregator == nil || aggregator.usage == nil ||
		child.RunType != domaintask.RunTypeCanvasNodeVideoFirstLastFrameExtraction ||
		child.SubjectType != domaintask.SubjectTypeCanvasNode || !child.IsInternal ||
		(child.Status != domaintask.StatusSucceeded && child.Status != domaintask.StatusFailed) ||
		child.ParentTaskID == nil || parent.ID != *child.ParentTaskID ||
		parent.RunType != domaintask.RunTypeCanvasNodeVideoGeneration ||
		parent.SubjectType != domaintask.SubjectTypeCanvasNode || parent.SubjectID != child.SubjectID ||
		parent.Status != domaintask.StatusWaitingSubtasks {
		return applicationtask.TaskRunUpdate{}, applicationtask.ErrInvalidTaskHierarchy
	}
	parentStatus := domaintask.Status(domaintask.StatusSucceeded)
	if child.Status == domaintask.StatusFailed {
		parentStatus = domaintask.StatusPartialSuccess
	}
	return applicationtask.TaskRunUpdate{
		Status: parentStatus, FinishedAt: &now,
	}, nil
}

func (aggregator *FirstLastFrameParentAggregator) OnParentTerminal(ctx context.Context, parent domaintask.TaskRun) error {
	return aggregator.usage.Close(ctx, applicationprojectusage.CloseInput{TaskRunID: parent.ID})
}

func (aggregator *FirstLastFrameParentAggregator) AfterCommit(parentID string) {
	aggregator.usage.TriggerAfterCommit(parentID)
}
