package projectusage

import (
	"context"
	"errors"
	"strings"

	domain "github.com/example/monorepo/canvas/internal/server/domain/projectusage"
)

const maxCallCASAttempts = 4

const maxRelatedCallOrdinal = 10000

type CallRecorder struct {
	store CallStore
	clock Clock
}

func NewCallRecorder(store CallStore, clock Clock) *CallRecorder {
	return &CallRecorder{store: store, clock: clock}
}

func (recorder *CallRecorder) Plan(ctx context.Context, input BeginCallInput) (domain.CallRef, error) {
	if recorder == nil || recorder.store == nil || recorder.clock == nil {
		return domain.CallRef{}, domain.ErrInvalidCall
	}
	call, err := domain.NewAIGWCall(domain.NewAIGWCallInput{
		TaskRunID: input.TaskRunID, CallOrdinal: input.CallOrdinal, CallType: input.CallType,
		ProjectID: input.ProjectID, ModelID: input.ModelID, ModelName: input.ModelName,
		ModelSource: input.ModelSource, Now: recorder.clock.Now(),
	})
	if err != nil {
		return domain.CallRef{}, err
	}
	if err = recorder.store.CreateCall(ctx, call); err != nil {
		return domain.CallRef{}, err
	}
	return call.Ref(), nil
}

func (recorder *CallRecorder) Begin(ctx context.Context, input BeginCallInput) (domain.CallRef, error) {
	ref, err := recorder.Plan(ctx, input)
	if err != nil {
		return domain.CallRef{}, err
	}
	err = recorder.mutate(ctx, ref, func(call *domain.AIGWCall) error {
		return call.StartRequest(recorder.clock.Now())
	})
	return ref, err
}

// BeginRelated creates a later logical call using the immutable attribution
// frozen by the first call of the same TaskRun. Storyboard correction rounds
// use this path so business detail rows do not need to duplicate usage fields.
func (recorder *CallRecorder) BeginRelated(
	ctx context.Context,
	taskRunID string,
	callOrdinal int32,
	callType string,
	modelID string,
) (domain.CallRef, error) {
	if recorder == nil || recorder.store == nil || callOrdinal <= 0 {
		return domain.CallRef{}, domain.ErrInvalidCall
	}
	first, err := recorder.store.GetCall(ctx, domain.CallRef{TaskRunID: taskRunID, CallOrdinal: 1})
	if err != nil {
		return domain.CallRef{}, err
	}
	if first.CallType != callType || first.ModelID != modelID {
		return domain.CallRef{}, ErrCallConflict
	}
	return recorder.Begin(ctx, BeginCallInput{
		TaskRunID: taskRunID, CallOrdinal: callOrdinal, CallType: callType,
		ProjectID: first.ProjectID, ModelID: first.ModelID, ModelName: first.ModelName,
		ModelSource: first.ModelSource,
	})
}

// NextRelatedOrdinal returns the first call ordinal that has not started a
// provider request. Ordinal 1 may already exist as a planned placeholder from
// TaskRun creation, so absence alone is not the allocation contract.
func (recorder *CallRecorder) NextRelatedOrdinal(ctx context.Context, taskRunID string) (int32, error) {
	if recorder == nil || recorder.store == nil || strings.TrimSpace(taskRunID) == "" {
		return 0, domain.ErrInvalidCall
	}
	for ordinal := int32(1); ordinal <= maxRelatedCallOrdinal; ordinal++ {
		call, err := recorder.store.GetCall(ctx, domain.CallRef{TaskRunID: taskRunID, CallOrdinal: ordinal})
		if errors.Is(err, ErrCallNotFound) {
			return ordinal, nil
		}
		if err != nil {
			return 0, err
		}
		if call.RequestStartedAt == nil {
			return ordinal, nil
		}
	}
	return 0, domain.ErrInvalidCall
}

func (recorder *CallRecorder) Capture(ctx context.Context, ref domain.CallRef, requestID string) error {
	return recorder.mutate(ctx, ref, func(call *domain.AIGWCall) error {
		return call.Capture(requestID, recorder.clock.Now())
	})
}

// RecordProviderResult turns the transport outcome into one durable capture
// fact. A request that entered the SDK but returned no AIGW RequestID is never
// treated as free because the downstream inference may already have executed.
func (recorder *CallRecorder) RecordProviderResult(
	ctx context.Context,
	ref domain.CallRef,
	requestID string,
	attempted bool,
) error {
	requestID = strings.TrimSpace(requestID)
	// AIGW's response header is stronger evidence than the caller's advisory
	// attempted flag. Never erase a real billing key as NOT_SENT when the two
	// pieces of transport metadata disagree.
	if requestID != "" {
		err := recorder.Capture(ctx, ref, requestID)
		if !errors.Is(err, ErrCallConflict) {
			return err
		}
		// RequestID is globally unique in the ledger. If another call already owns
		// it, persisting this call as uncaptured would leave the parent PENDING until
		// the retry ceiling. Record the ambiguity immediately without storing the
		// duplicate identifier, then surface the original conflict to the caller.
		reviewErr := recorder.RequestIDUnknown(ctx, ref, "AIGW request ID conflicts with an existing billing call")
		return errors.Join(err, reviewErr)
	}
	if !attempted {
		return recorder.NotSent(ctx, ref)
	}
	return recorder.RequestIDUnknown(ctx, ref, "AIGW inference response omitted X-Aigw-Request-Id")
}

// MarkInterruptedIfPresent fences a durable caller retry after an earlier
// inference attempt began. An uncaptured call is ambiguous across a process
// crash: the request may have reached AIGW, so it must never be retried as the
// same ordinal or treated as free. Captured and already-final calls are kept.
func (recorder *CallRecorder) MarkInterruptedIfPresent(
	ctx context.Context,
	ref domain.CallRef,
	reason string,
) (bool, error) {
	if recorder == nil || recorder.store == nil {
		return false, domain.ErrInvalidCall
	}
	current, err := recorder.store.GetCall(ctx, ref)
	if errors.Is(err, ErrCallNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if current.RequestStartedAt == nil {
		return false, nil
	}
	if current.BillingStatus == domain.CallBillingPending && current.CaptureResult == nil {
		if err = recorder.RequestIDUnknown(ctx, ref, reason); err != nil {
			return true, err
		}
	}
	return true, nil
}

func (recorder *CallRecorder) NotSent(ctx context.Context, ref domain.CallRef) error {
	return recorder.mutate(ctx, ref, func(call *domain.AIGWCall) error {
		return call.FinalizeNotSent(recorder.clock.Now())
	})
}

func (recorder *CallRecorder) RequestIDUnknown(ctx context.Context, ref domain.CallRef, reason string) error {
	return recorder.mutate(ctx, ref, func(call *domain.AIGWCall) error {
		return call.MarkRequestIDUnknown(reason, recorder.clock.Now())
	})
}

func (recorder *CallRecorder) CancelConfirmed(ctx context.Context, ref domain.CallRef) error {
	return recorder.mutate(ctx, ref, func(call *domain.AIGWCall) error {
		return call.ConfirmCancellation(recorder.clock.Now())
	})
}

func (recorder *CallRecorder) mutate(ctx context.Context, ref domain.CallRef, mutate func(*domain.AIGWCall) error) error {
	if recorder == nil || recorder.store == nil || recorder.clock == nil || strings.TrimSpace(ref.TaskRunID) == "" || ref.CallOrdinal <= 0 {
		return domain.ErrInvalidCall
	}
	for attempt := 0; attempt < maxCallCASAttempts; attempt++ {
		current, err := recorder.store.GetCall(ctx, ref)
		if err != nil {
			return err
		}
		updated := current
		if err = mutate(&updated); err != nil {
			return err
		}
		if updated.StateVersion == current.StateVersion {
			return nil
		}
		ok, err := recorder.store.UpdateCall(ctx, current, updated)
		if err != nil {
			return err
		}
		if ok {
			return nil
		}
	}
	return ErrConcurrentCallUpdate
}

type Finalizer struct {
	store   FinalizationStore
	clock   Clock
	trigger ReconciliationTrigger
}

// FinalizerOption configures optional post-commit behavior for a Finalizer.
type FinalizerOption func(*Finalizer)

// WithReconciliationTrigger schedules a low-latency reconciliation attempt
// only when the caller explicitly reports that its terminal transaction committed.
func WithReconciliationTrigger(trigger ReconciliationTrigger) FinalizerOption {
	return func(finalizer *Finalizer) {
		if trigger != nil {
			finalizer.trigger = trigger
		}
	}
}

func NewFinalizer(store FinalizationStore, clock Clock, options ...FinalizerOption) *Finalizer {
	finalizer := &Finalizer{store: store, clock: clock}
	for _, option := range options {
		if option != nil {
			option(finalizer)
		}
	}
	return finalizer
}

func (finalizer *Finalizer) Close(ctx context.Context, input CloseInput) error {
	if finalizer == nil || finalizer.store == nil || finalizer.clock == nil ||
		strings.TrimSpace(input.TaskRunID) == "" {
		return domain.ErrInvalidRecord
	}
	if err := finalizer.store.CloseTaskRun(ctx, input, finalizer.clock.Now()); err != nil {
		return errors.Join(err)
	}
	return nil
}

// TriggerAfterCommit is deliberately separate from Close. Close is called
// while the TaskRun terminal transaction is still open; querying AIGW there
// would hold database locks and could race an uncommitted usage projection.
func (finalizer *Finalizer) TriggerAfterCommit(taskRunID string) bool {
	if finalizer == nil || finalizer.trigger == nil || strings.TrimSpace(taskRunID) == "" {
		return false
	}
	return finalizer.trigger.TriggerTask(taskRunID)
}
