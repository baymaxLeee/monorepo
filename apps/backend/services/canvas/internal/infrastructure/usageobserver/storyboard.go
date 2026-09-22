package usageobserver

import (
	"context"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationprojectusage "github.com/example/monorepo/canvas/internal/application/projectusage"
	domainprojectusage "github.com/example/monorepo/canvas/internal/domain/projectusage"
)

type callRecorder interface {
	NextRelatedOrdinal(context.Context, string) (int32, error)
	BeginRelated(context.Context, string, int32, string, string) (domainprojectusage.CallRef, error)
	RecordProviderResult(context.Context, domainprojectusage.CallRef, string, bool) error
}

func (observer *StoryboardObserver) NextOrdinal(ctx context.Context, taskRunID string) (int, error) {
	ordinal, err := observer.recorder.NextRelatedOrdinal(ctx, taskRunID)
	return int(ordinal), err
}

// StoryboardObserver adapts the storyboard's model-round callback to the
// project usage call ledger. The caller owns the stable round ordinal.
type StoryboardObserver struct {
	recorder callRecorder
}

func NewStoryboardObserver(recorder *applicationprojectusage.CallRecorder) applicationcanvas.StoryboardModelCallLedger {
	return newStoryboardObserver(recorder)
}

func newStoryboardObserver(recorder callRecorder) *StoryboardObserver {
	return &StoryboardObserver{recorder: recorder}
}

func (observer *StoryboardObserver) Begin(ctx context.Context, call applicationcanvas.StoryboardModelCall) error {
	_, err := observer.recorder.BeginRelated(
		ctx, call.TaskRunID, int32(call.Ordinal), applicationcanvas.StoryboardModelCallType, call.ModelID,
	)
	return err
}

func (observer *StoryboardObserver) Capture(ctx context.Context, call applicationcanvas.StoryboardModelCall) error {
	return observer.recorder.RecordProviderResult(ctx, domainprojectusage.CallRef{
		TaskRunID: call.TaskRunID, CallOrdinal: int32(call.Ordinal),
	}, call.RequestID, call.RequestAttempted)
}

var _ applicationcanvas.StoryboardModelCallLedger = (*StoryboardObserver)(nil)
