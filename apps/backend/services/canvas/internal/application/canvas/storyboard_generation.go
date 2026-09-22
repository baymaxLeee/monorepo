package canvas

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	applicationprojectusage "github.com/example/monorepo/canvas/internal/application/projectusage"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domaincanvasnode "github.com/example/monorepo/canvas/internal/domain/canvas"
	domainprojectusage "github.com/example/monorepo/canvas/internal/domain/projectusage"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
	"github.com/example/monorepo/canvas/internal/infrastructure/observability/logcontext"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

// The product contract allows a 30,000-character storyboard to spend up to 50
// minutes in model planning and detail expansion. Five minutes of headroom
// covers queueing, checkpoints and terminal persistence. Shared scheduler
// execution slices are shorter and resume this durable task until this limit.
const storyboardGenerationLifetime = 55 * time.Minute
const storyboardExecutionSliceRetryDelay = time.Second

const storyboardPlotHardLimitCharacters = 30000

const storyboardInterruptedCallReason = "storyboard execution was interrupted after a provider call began"

var ErrStoryboardNotFound = errors.New("storyboard draft session not found")

// StoryboardStatus uses the shared TaskRun lifecycle while keeping storyboard
// vocabulary explicit at the Canvas application boundary.
type StoryboardStatus = domaintask.Status

const (
	StoryboardStatusQueued    = domaintask.StatusQueued
	StoryboardStatusRunning   = domaintask.StatusRunning
	StoryboardStatusCompleted = domaintask.StatusSucceeded
	StoryboardStatusFailed    = domaintask.StatusFailed
	StoryboardStatusCancelled = domaintask.StatusCancelled
)

type StoryboardFailure struct {
	Code        string                      `json:"code"`
	Message     string                      `json:"message"`
	Diagnostics []StoryboardRoundDiagnostic `json:"-"`
}

type StoryboardRejectionDiagnostic struct {
	CanvasNodeNo *int   `json:"canvasnode_no,omitempty"`
	InputIndex   *int   `json:"input_index,omitempty"`
	Rule         string `json:"rule"`
	Message      string `json:"message"`
}

type StoryboardRoundDiagnostic struct {
	Round                    int                             `json:"round"`
	ResponseID               string                          `json:"response_id,omitempty"`
	AcceptedCanvasNodeNumber []int                           `json:"accepted_canvasnode_no"`
	MissingCanvasNodeNumber  []int                           `json:"missing_canvasnode_no"`
	Rejections               []StoryboardRejectionDiagnostic `json:"rejections"`
}

// StoryboardDiagnosticProvider exposes bounded, prompt-free validation metadata
// across adapter error wrapping so the application can persist failure evidence.
type StoryboardDiagnosticProvider interface {
	StoryboardDiagnostics() []StoryboardRoundDiagnostic
}

// StoryboardSession is the durable target detail of CANVAS_STORYBOARD_GENERATION.
// TaskRun owns lifecycle and visibility; PollSchedule owns execution leases.
// The repository is the recovery source read by the unified canvas polling API;
// Redis is only a short-lived worker projection and is never a client transport.
type StoryboardSession struct {
	ID             string                    `json:"id"`
	ProjectID      string                    `json:"project_id"`
	CanvasID       string                    `json:"canvas_id"`
	Plot           string                    `json:"plot"`
	ModelConfig    StoryboardModelConfig     `json:"model_config"`
	PlanningConfig StoryboardPlanningConfig  `json:"planning_config"`
	Limit          int                       `json:"limit"`
	Status         domaintask.Status         `json:"status"`
	Drafts         []Draft                   `json:"drafts"`
	Generation     StoryboardGenerationState `json:"-"`
	Failure        *StoryboardFailure        `json:"failure,omitempty"`
	CreatedAt      time.Time                 `json:"created_at"`
}

type StoryboardModelConfig struct {
	InferenceModelServiceID string                    `json:"inference_model_service_id,omitempty"`
	VideoModelServiceID     string                    `json:"video_model_service_id,omitempty"`
	VideoParameters         StoryboardVideoParameters `json:"video_parameters"`
}

type StoryboardVideoParameters struct {
	Resolution    domainvideo.Resolution  `json:"resolution"`
	AspectRatio   domainvideo.AspectRatio `json:"aspect_ratio"`
	GenerateAudio bool                    `json:"generate_audio"`
	Watermark     bool                    `json:"watermark"`
}

func (value StoryboardVideoParameters) Valid() bool {
	return value.Resolution.Valid() && value.AspectRatio.Valid()
}

// StoryboardInferenceModelSnapshot is immutable usage attribution resolved
// during task creation. It belongs to the provider call ledger, not the storyboard
// business detail persisted for later execution.
type StoryboardInferenceModelSnapshot struct {
	ModelID     string
	ModelName   string
	ModelSource string
}

type StoryboardOverride struct {
	DraftID          string
	GenerationConfig domainvideo.Config
}

type StoryboardCache interface {
	Create(context.Context, Scope, string, string, string, StoryboardSession) (bool, error)
	Get(context.Context, Scope, string, string, string) (StoryboardSession, error)
	Append(context.Context, Scope, string, string, string, Draft) error
	Delete(context.Context, Scope, string, string, string) error
}

type StoryboardRepository interface {
	Create(context.Context, Scope, string, string, StoryboardSession, time.Time) error
	ListUnresolved(context.Context, Scope, string, string) ([]StoryboardSession, error)
	GetByTaskRunID(context.Context, Scope, string) (StoryboardSession, error)
	MarkRunning(context.Context, Scope, string, time.Time) error
	Append(context.Context, Scope, string, string, string, Draft, time.Time) (bool, error)
	SaveGenerationState(context.Context, Scope, string, string, string, StoryboardGenerationState, time.Time) error
	Finish(context.Context, Scope, string, string, string, domaintask.Status, *StoryboardFailure, time.Time) error
	Resolve(context.Context, Scope, string, string, string, domaintask.Status, time.Time) error
}

// StoryboardProvider is the custom provider plugged into the existing TaskRun processor.
// It owns only model interaction and progressive schema parsing.
type StoryboardProvider interface {
	PrepareStoryboardPlanning(context.Context, Scope, StoryboardModelConfig, StoryboardPlanningConfig, int) (StoryboardModelConfig, StoryboardPlanningConfig, StoryboardInferenceModelSnapshot, error)
	GenerateDraftsWithState(context.Context, Scope, string, string, string, string, StoryboardModelConfig, StoryboardPlanningConfig, StoryboardGenerationState, StoryboardModelCallLedger, func(StoryboardGenerationState) error, func(Draft) error) error
}

type StoryboardConfirmer interface {
	CreateStoryboardDraftNode(context.Context, Scope, string, string, string, string) error
	FinishStoryboardDraftNode(context.Context, Scope, string, string, string) error
	DeleteStoryboardDraftNode(context.Context, Scope, string, string, string) error
	ConfirmStoryboardDrafts(context.Context, Scope, string, string, string, []CanvasNodeDraftConfirmInput) ([]domaincanvasnode.CanvasNode, int64, error)
}

type StoryboardCanvasNodes interface {
	StoryboardProvider
	StoryboardConfirmer
}

type StoryboardCanvasAccess interface {
	Validate(context.Context, Scope, string, string) error
}

// StoryboardCacheCleanupFailureReporter makes post-commit Redis projection
// cleanup failures observable without changing an already committed result.
type StoryboardCacheCleanupFailureReporter interface {
	ReportStoryboardCacheCleanupFailure(context.Context, string, error)
}

type StoryboardUsageFinalizer interface {
	Close(context.Context, applicationprojectusage.CloseInput) error
	TriggerAfterCommit(string) bool
}

type storyboardTaskRunStore interface {
	applicationtask.TaskRunStore
	GetTaskRunForUpdate(context.Context, string) (domaintask.TaskRun, error)
}

type StoryboardService struct {
	canvas_nodes         StoryboardCanvasNodes
	cache                StoryboardCache
	repository           StoryboardRepository
	runs                 storyboardTaskRunStore
	schedules            applicationtask.PollScheduleStore
	executions           *applicationtask.ActiveExecutions
	transactions         applicationtask.TransactionManager
	ids                  IDGenerator
	clock                Clock
	modelCalls           StoryboardModelCallLedger
	usageCalls           *applicationprojectusage.CallRecorder
	usageFinalizer       StoryboardUsageFinalizer
	cacheCleanupFailures StoryboardCacheCleanupFailureReporter
	canvasAccess         StoryboardCanvasAccess
}

type StoryboardOption func(*StoryboardService)

func WithStoryboardCacheCleanupFailureReporter(reporter StoryboardCacheCleanupFailureReporter) StoryboardOption {
	return func(service *StoryboardService) {
		if reporter != nil {
			service.cacheCleanupFailures = reporter
		}
	}
}

func WithStoryboardCanvasAccess(access StoryboardCanvasAccess) StoryboardOption {
	return func(service *StoryboardService) { service.canvasAccess = access }
}

func WithStoryboardModelCallLedger(ledger StoryboardModelCallLedger) StoryboardOption {
	return func(service *StoryboardService) {
		if ledger != nil {
			service.modelCalls = ledger
		}
	}
}

func WithStoryboardUsageFinalizer(finalizer StoryboardUsageFinalizer) StoryboardOption {
	return func(service *StoryboardService) {
		service.usageFinalizer = finalizer
	}
}

func WithStoryboardProjectUsage(calls *applicationprojectusage.CallRecorder, finalizer StoryboardUsageFinalizer) StoryboardOption {
	return func(service *StoryboardService) {
		service.usageCalls = calls
		service.usageFinalizer = finalizer
	}
}

func NewStoryboardService(
	canvas_nodes StoryboardCanvasNodes,
	cache StoryboardCache,
	repository StoryboardRepository,
	runs storyboardTaskRunStore,
	schedules applicationtask.PollScheduleStore,
	executions *applicationtask.ActiveExecutions,
	transactions applicationtask.TransactionManager,
	ids IDGenerator,
	clock Clock,
	options ...StoryboardOption,
) *StoryboardService {
	service := &StoryboardService{
		canvas_nodes: canvas_nodes, cache: cache, repository: repository,
		runs: runs, schedules: schedules, executions: executions,
		transactions: transactions, ids: ids, clock: clock,
		cacheCleanupFailures: noopStoryboardCacheCleanupFailureReporter{},
	}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *StoryboardService) Start(
	ctx context.Context,
	scope Scope,
	projectID, canvasID, plot string,
	modelConfig StoryboardModelConfig,
	planningConfig StoryboardPlanningConfig,
	limit int,
) (StoryboardSession, error) {
	if !s.configured() {
		return StoryboardSession{}, errno.New(errno.ErrConfigurationError)
	}
	if !validStoryboardInput(scope, projectID, canvasID, plot, limit) {
		return StoryboardSession{}, errno.New(errno.ErrInvalidArgument)
	}
	modelConfig, planningConfig, inferenceSnapshot, err := s.canvas_nodes.PrepareStoryboardPlanning(
		ctx, scope, modelConfig, planningConfig, 0,
	)
	if err != nil {
		return StoryboardSession{}, err
	}
	id, err := s.ids.NewID()
	if err != nil {
		return StoryboardSession{}, errno.Wrap(errno.ErrInternalError, err)
	}
	now := s.clock.Now()
	session := StoryboardSession{
		ID: id, ProjectID: strings.TrimSpace(projectID), CanvasID: strings.TrimSpace(canvasID),
		Plot: strings.TrimSpace(plot), ModelConfig: normalizeStoryboardModelConfig(modelConfig), PlanningConfig: planningConfig, Limit: 0,
		Status: StoryboardStatusQueued, Drafts: []Draft{},
		Generation: StoryboardGenerationState{ProtocolVersion: StoryboardGenerationProtocolVersion}, CreatedAt: now,
	}
	run := domaintask.TaskRun{
		ID: id, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CreatedBy: scope.CallerID,
		RunType: s.RunType(), SubjectType: domaintask.SubjectTypeCanvasNode,
		SubjectID: id, Status: domaintask.StatusQueued, StateVersion: 1,
		CreatedAt: now, UpdatedAt: now,
	}
	schedule := domaintask.PollSchedule{
		TaskRunID: id, NextPollAt: now, StateVersion: 1,
		DeadlineAt: now.Add(storyboardGenerationLifetime), CreatedAt: now, UpdatedAt: now,
	}
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if createErr := s.runs.Create(txCtx, run); createErr != nil {
			return createErr
		}
		if s.usageCalls != nil {
			if _, planErr := s.usageCalls.Plan(txCtx, applicationprojectusage.BeginCallInput{
				TaskRunID: id, CallOrdinal: 1, CallType: StoryboardModelCallType,
				ProjectID: session.ProjectID, ModelID: inferenceSnapshot.ModelID,
				ModelName: inferenceSnapshot.ModelName, ModelSource: inferenceSnapshot.ModelSource,
			}); planErr != nil {
				return planErr
			}
		}
		if createErr := s.canvas_nodes.CreateStoryboardDraftNode(txCtx, scope, projectID, canvasID, id, session.Plot); createErr != nil {
			return createErr
		}
		if createErr := s.repository.Create(txCtx, scope, projectID, canvasID, session, now); createErr != nil {
			return createErr
		}
		return s.schedules.CreatePollSchedule(txCtx, schedule)
	})
	if err != nil {
		return StoryboardSession{}, errno.Wrap(errno.ErrInternalError, err)
	}
	return session, nil
}

func (s *StoryboardService) confirmationConfigured() bool {
	return s != nil && s.canvas_nodes != nil && s.repository != nil && s.runs != nil &&
		s.transactions != nil && s.ids != nil && s.clock != nil && s.cache != nil
}

func (s *StoryboardService) configured() bool {
	return s != nil && s.canvas_nodes != nil && s.cache != nil &&
		s.repository != nil && s.runs != nil && s.schedules != nil && s.executions != nil &&
		s.transactions != nil && s.ids != nil && s.clock != nil && s.modelCalls != nil
}

func validStoryboardInput(scope Scope, projectID, canvasID, plot string, _ int) bool {
	return strings.TrimSpace(scope.TenantID) != "" && strings.TrimSpace(scope.CallerID) != "" &&
		strings.TrimSpace(projectID) != "" && strings.TrimSpace(canvasID) != "" &&
		utf8.ValidString(plot) && strings.TrimSpace(plot) != "" &&
		utf8.RuneCountInString(plot) <= storyboardPlotHardLimitCharacters
}

func normalizeStoryboardModelConfig(value StoryboardModelConfig) StoryboardModelConfig {
	value.InferenceModelServiceID = strings.TrimSpace(value.InferenceModelServiceID)
	value.VideoModelServiceID = strings.TrimSpace(value.VideoModelServiceID)
	return value
}

func (*StoryboardService) RunType() domaintask.RunType {
	return domaintask.RunTypeCanvasStoryboardGeneration
}

// ProcessPollClaim is the only entry point that can invoke the provider. It is
// called by the shared PollScheduler after durable lease acquisition.
func (s *StoryboardService) ProcessPollClaim(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule) error {
	if !s.configured() || run.RunType != s.RunType() || schedule.TaskRunID != run.ID {
		return errors.New("storyboard task processor dependencies or claim are invalid")
	}
	scope := Scope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy}
	state, err := s.repository.GetByTaskRunID(ctx, scope, run.ID)
	if err != nil {
		return err
	}
	reclaimedRunning := state.Status == StoryboardStatusRunning
	if state.Status == StoryboardStatusQueued {
		if err = s.markRunning(ctx, scope, &run, state, s.clock.Now()); err != nil {
			return err
		}
		state.Status = StoryboardStatusRunning
	}
	if state.Status != StoryboardStatusRunning {
		return nil
	}
	if reclaimedRunning {
		_, interruptErr := s.markInterruptedUsageCall(context.WithoutCancel(ctx), run)
		if interruptErr != nil {
			return interruptErr
		}
	}
	if err = s.ensureLiveCache(ctx, scope, state); err != nil {
		return s.finishClaim(context.WithoutCancel(ctx), scope, run.ID, schedule, StoryboardStatusFailed, storyboardInternalFailure(err))
	}
	providerCtx := ctx
	cancelProvider := func() {}
	if !schedule.DeadlineAt.IsZero() {
		providerCtx, cancelProvider = context.WithDeadline(ctx, schedule.DeadlineAt)
	}
	defer cancelProvider()
	checkpoint := func(generation StoryboardGenerationState) error {
		return s.repository.SaveGenerationState(
			providerCtx, scope, state.ProjectID, state.CanvasID, state.ID, generation, s.clock.Now(),
		)
	}
	emitDraft := func(draft Draft) error {
		if appendErr := s.cache.Append(providerCtx, scope, state.ProjectID, state.CanvasID, state.ID, draft); appendErr != nil {
			return appendErr
		}
		_, appendErr := s.repository.Append(providerCtx, scope, state.ProjectID, state.CanvasID, state.ID, draft, s.clock.Now())
		return appendErr
	}
	// Restore plain drafts for enrichment after a lease recovery without
	// regenerating their text or replacing their durable IDs.
	state.Generation.Drafts = make([]StoryboardDraft, 0, len(state.Drafts))
	for _, draft := range state.Drafts {
		state.Generation.Drafts = append(state.Generation.Drafts, StoryboardDraft{ID: draft.ID, CanvasNodeNo: draft.CanvasNodeNo, Prompt: draft.Prompt, DurationSeconds: draft.DurationSeconds, AssetReferences: draft.AssetReferences})
	}
	err = s.canvas_nodes.GenerateDraftsWithState(
		providerCtx, scope, run.ID, state.ProjectID, state.CanvasID, state.Plot, state.ModelConfig, state.PlanningConfig,
		state.Generation, s.modelCalls, checkpoint, emitDraft,
	)
	if err == nil {
		return s.finishClaim(context.WithoutCancel(ctx), scope, run.ID, schedule, StoryboardStatusCompleted, nil)
	}
	if errors.Is(err, context.Canceled) {
		// Explicit cancellation has already converged DB state; coordinator
		// shutdown leaves the lease for another pod to reclaim.
		return nil
	}
	if errors.Is(err, context.DeadlineExceeded) && s.clock.Now().Before(schedule.DeadlineAt) {
		// The shared scheduler deliberately caps one execution slice at ten
		// minutes. Release this lease instead of failing the durable run so a
		// later claim can continue from the persisted plan and drafts.
		return s.rescheduleClaimAfterExecutionSlice(context.WithoutCancel(ctx), run.ID, schedule)
	}
	return s.finishClaim(context.WithoutCancel(ctx), scope, run.ID, schedule, StoryboardStatusFailed, storyboardInternalFailure(err))
}

func (s *StoryboardService) rescheduleClaimAfterExecutionSlice(
	ctx context.Context,
	taskRunID string,
	schedule domaintask.PollSchedule,
) error {
	now := s.clock.Now()
	rescheduled, err := s.schedules.ReschedulePoll(ctx, schedule, domaintask.PollScheduleUpdate{
		NextPollAt:   now.Add(storyboardExecutionSliceRetryDelay),
		PollAttempts: schedule.PollAttempts + 1,
	}, now)
	if err != nil {
		return err
	}
	if rescheduled {
		return nil
	}
	current, err := s.runs.GetTaskRun(ctx, taskRunID)
	if err != nil {
		return err
	}
	if current.Terminal() {
		return nil
	}
	return errors.New("storyboard poll schedule lease changed before execution slice reschedule")
}

func (s *StoryboardService) markRunning(ctx context.Context, scope Scope, run *domaintask.TaskRun, state StoryboardSession, now time.Time) error {
	startedAt := now
	return s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if err := s.repository.MarkRunning(txCtx, scope, state.ID, now); err != nil {
			return err
		}
		updated, err := s.runs.UpdateTaskRun(txCtx, *run, applicationtask.TaskRunUpdate{Status: domaintask.StatusRunning, StartedAt: &startedAt}, now)
		if err != nil {
			return err
		}
		if !updated {
			return errors.New("storyboard task run state changed before start")
		}
		run.Status, run.StartedAt, run.UpdatedAt = domaintask.StatusRunning, &startedAt, now
		run.StateVersion++
		return nil
	})
}

func (s *StoryboardService) ensureLiveCache(ctx context.Context, scope Scope, state StoryboardSession) error {
	created, err := s.cache.Create(ctx, scope, state.ProjectID, state.CanvasID, state.ID, state)
	if err != nil || created {
		return err
	}
	live, err := s.cache.Get(ctx, scope, state.ProjectID, state.CanvasID, state.ID)
	if err != nil {
		return err
	}
	if live.ID != state.ID {
		return errors.New("storyboard replay cache belongs to another task run")
	}
	return nil
}

func (s *StoryboardService) finishClaim(ctx context.Context, scope Scope, taskRunID string, schedule domaintask.PollSchedule, status domaintask.Status, failure *StoryboardFailure) error {
	run, err := s.runs.GetTaskRun(ctx, taskRunID)
	if err != nil {
		return err
	}
	if run.Terminal() {
		return nil
	}
	state, err := s.repository.GetByTaskRunID(ctx, scope, taskRunID)
	if err != nil {
		return err
	}
	now := s.clock.Now()
	update := applicationtask.TaskRunUpdate{Status: status, FinishedAt: &now}
	if failure != nil {
		update.ErrorCode, update.ErrorMessage = failure.Code, failure.Message
	}
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		current, lockErr := s.runs.GetTaskRunForUpdate(txCtx, taskRunID)
		if lockErr != nil {
			return lockErr
		}
		if current.Terminal() {
			return nil
		}
		if finishErr := s.repository.Finish(txCtx, scope, state.ProjectID, state.CanvasID, taskRunID, status, failure, now); finishErr != nil {
			return finishErr
		}
		updated, updateErr := s.runs.UpdateTaskRun(txCtx, current, update, now)
		if updateErr != nil {
			return updateErr
		}
		if !updated {
			return errors.New("storyboard task run state changed before finish")
		}
		if closeErr := s.closeUsage(txCtx, current.ID); closeErr != nil {
			return closeErr
		}
		completed, completeErr := s.schedules.CompletePollSchedule(txCtx, schedule)
		if completeErr != nil {
			return completeErr
		}
		if !completed {
			return errors.New("storyboard poll schedule lease changed before finish")
		}
		return s.canvas_nodes.FinishStoryboardDraftNode(txCtx, scope, state.ProjectID, state.CanvasID, taskRunID)
	})
	if err != nil {
		return err
	}
	s.triggerUsageAfterCommit(taskRunID)
	s.cleanupCache(ctx, scope, state.ProjectID, state.CanvasID, state.ID, "finish")
	return nil
}

func storyboardInternalFailure(err error) *StoryboardFailure {
	failure := &StoryboardFailure{Code: string(errno.CodeOf(err)), Message: errno.MessageOf(err)}
	var provider StoryboardDiagnosticProvider
	if errors.As(err, &provider) {
		failure.Diagnostics = cloneStoryboardDiagnostics(provider.StoryboardDiagnostics())
	}
	return failure
}

func cloneStoryboardDiagnostics(values []StoryboardRoundDiagnostic) []StoryboardRoundDiagnostic {
	cloned := make([]StoryboardRoundDiagnostic, len(values))
	for index := range values {
		cloned[index] = values[index]
		cloned[index].AcceptedCanvasNodeNumber = append([]int(nil), values[index].AcceptedCanvasNodeNumber...)
		cloned[index].MissingCanvasNodeNumber = append([]int(nil), values[index].MissingCanvasNodeNumber...)
		cloned[index].Rejections = append([]StoryboardRejectionDiagnostic(nil), values[index].Rejections...)
	}
	return cloned
}

// Get never starts work. Durable detail is checked first so a failed Redis
// cleanup cannot mask a committed terminal state with stale live replay data.
// For queued/running tasks Redis may still be ahead of DB during one append.
func (s *StoryboardService) Get(ctx context.Context, scope Scope, projectID, canvasID, taskRunID string) (StoryboardSession, error) {
	if s.canvasAccess != nil {
		if err := s.canvasAccess.Validate(ctx, scope, projectID, canvasID); err != nil {
			return StoryboardSession{}, classifyRepositoryError(err)
		}
	}
	durable, err := s.repository.GetByTaskRunID(ctx, scope, taskRunID)
	if err != nil {
		return StoryboardSession{}, classifyStoryboardStoreError(err)
	}
	if durable.ProjectID != projectID || durable.CanvasID != canvasID {
		return StoryboardSession{}, errno.New(errno.ErrNotFound)
	}
	if durable.Status != StoryboardStatusQueued && durable.Status != StoryboardStatusRunning {
		return durable, nil
	}
	live, err := s.cache.Get(ctx, scope, projectID, canvasID, taskRunID)
	if err == nil && live.ID == durable.ID {
		return live, nil
	}
	if err != nil && !errors.Is(err, ErrStoryboardNotFound) {
		return StoryboardSession{}, errno.Wrap(errno.ErrInternalError, err)
	}
	return durable, nil
}

func (s *StoryboardService) List(ctx context.Context, scope Scope, projectID, canvasID string) ([]StoryboardSession, error) {
	if s.canvasAccess != nil {
		if err := s.canvasAccess.Validate(ctx, scope, projectID, canvasID); err != nil {
			return nil, classifyRepositoryError(err)
		}
	}
	states, err := s.repository.ListUnresolved(ctx, scope, projectID, canvasID)
	if err != nil {
		return nil, classifyStoryboardStoreError(err)
	}
	return states, nil
}

func (s *StoryboardService) Cancel(ctx context.Context, scope Scope, projectID, canvasID, taskRunID string) error {
	state, err := s.repository.GetByTaskRunID(ctx, scope, taskRunID)
	if err != nil {
		return classifyStoryboardStoreError(err)
	}
	if state.ProjectID != projectID || state.CanvasID != canvasID {
		return errno.New(errno.ErrNotFound)
	}
	now := s.clock.Now()
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		current, lockErr := s.runs.GetTaskRunForUpdate(txCtx, state.ID)
		if lockErr != nil {
			return lockErr
		}
		// The task run locked in this transaction is the terminal-status source
		// of truth. The session read before the transaction may already be stale.
		resolveStatus := current.Status
		if !current.Terminal() {
			resolveStatus = StoryboardStatusCancelled
		}
		if resolveErr := s.repository.Resolve(txCtx, scope, projectID, canvasID, state.ID, resolveStatus, now); resolveErr != nil {
			return resolveErr
		}
		if !current.Terminal() {
			updated, updateErr := s.runs.UpdateTaskRun(txCtx, current, applicationtask.TaskRunUpdate{Status: domaintask.StatusCancelled, FinishedAt: &now}, now)
			if updateErr != nil {
				return updateErr
			}
			if !updated {
				return errors.New("storyboard task run state changed before cancel")
			}
			if closeErr := s.closeUsage(txCtx, current.ID); closeErr != nil {
				return closeErr
			}
		}
		if deleteErr := s.canvas_nodes.DeleteStoryboardDraftNode(txCtx, scope, projectID, canvasID, state.ID); deleteErr != nil {
			return deleteErr
		}
		return s.schedules.DeletePollSchedule(txCtx, state.ID)
	})
	if err != nil {
		return errno.Wrap(errno.ErrInternalError, err)
	}
	s.triggerUsageAfterCommit(state.ID)
	s.executions.Cancel(state.ID)
	s.cleanupCache(ctx, scope, projectID, canvasID, taskRunID, "cancel")
	return nil
}

// CancelDeletedCanvasTask converges a storyboard task after its owning Canvas
// node has already been hidden by parent deletion. It intentionally does not
// read or delete the node again; the parent deletion transaction owns that row.
func (s *StoryboardService) CancelDeletedCanvasTask(
	ctx context.Context,
	scope Scope,
	projectID, canvasID, taskRunID string,
) error {
	if !validCallerScope(scope) || projectID == "" || canvasID == "" || taskRunID == "" {
		return errno.New(errno.ErrInvalidArgument)
	}
	now := s.clock.Now()
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		current, lockErr := s.runs.GetTaskRunForUpdate(txCtx, taskRunID)
		if lockErr != nil {
			return lockErr
		}
		if current.RunType != s.RunType() || current.SubjectType != domaintask.SubjectTypeCanvasNode ||
			current.SubjectID == "" || current.TenantID != scope.TenantID {
			return errno.New(errno.ErrNotFound)
		}
		if !current.Terminal() {
			updated, updateErr := s.runs.UpdateTaskRun(txCtx, current, applicationtask.TaskRunUpdate{
				Status: domaintask.StatusCancelled, FinishedAt: &now,
			}, now)
			if updateErr != nil {
				return updateErr
			}
			if !updated {
				return errors.New("storyboard task run state changed before deleted-canvas cancellation")
			}
			if closeErr := s.closeUsage(txCtx, current.ID); closeErr != nil {
				return closeErr
			}
		}
		return s.schedules.DeletePollSchedule(txCtx, taskRunID)
	})
	if err != nil {
		return errno.Wrap(errno.ErrInternalError, err)
	}
	s.triggerUsageAfterCommit(taskRunID)
	s.executions.Cancel(taskRunID)
	s.cleanupCache(ctx, scope, projectID, canvasID, taskRunID, "deleted_canvas")
	return nil
}

func (s *StoryboardService) closeUsage(ctx context.Context, taskRunID string) error {
	if s.usageFinalizer == nil {
		return nil
	}
	return s.usageFinalizer.Close(ctx, applicationprojectusage.CloseInput{TaskRunID: taskRunID})
}

func (s *StoryboardService) triggerUsageAfterCommit(taskRunID string) {
	if s.usageFinalizer != nil {
		s.usageFinalizer.TriggerAfterCommit(taskRunID)
	}
}

func (s *StoryboardService) markInterruptedUsageCall(
	ctx context.Context,
	run domaintask.TaskRun,
) (bool, error) {
	if s.usageCalls == nil {
		return false, nil
	}
	_, _, _, maxCalls, ok := applicationprojectusage.ExpectedUsageShape(string(run.RunType))
	if !ok {
		return false, errors.New("storyboard usage shape is not configured")
	}
	interrupted := false
	for ordinal := int32(1); ordinal <= maxCalls; ordinal++ {
		found, err := s.usageCalls.MarkInterruptedIfPresent(ctx, domainprojectusage.CallRef{
			TaskRunID:   run.ID,
			CallOrdinal: ordinal,
		}, storyboardInterruptedCallReason)
		if err != nil {
			return interrupted, err
		}
		// Storyboard calls are created consecutively immediately before each
		// provider request. The first missing or never-started ordinal therefore
		// proves no later call exists and avoids scanning the full loop budget.
		if !found {
			break
		}
		interrupted = interrupted || found
	}
	return interrupted, nil
}

func (s *StoryboardService) cleanupCache(
	ctx context.Context,
	scope Scope,
	projectID, canvasID, taskRunID, operation string,
) {
	if err := s.cache.Delete(ctx, scope, projectID, canvasID, taskRunID); err != nil {
		reportCtx := logcontext.WithBusiness(ctx, logcontext.Business{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
			ProjectID: projectID, CanvasID: canvasID, TaskRunID: taskRunID,
			CleanupStage: "storyboard_live_cache",
		})
		s.cacheCleanupFailures.ReportStoryboardCacheCleanupFailure(reportCtx, operation, err)
	}
}

type noopStoryboardCacheCleanupFailureReporter struct{}

func (noopStoryboardCacheCleanupFailureReporter) ReportStoryboardCacheCleanupFailure(context.Context, string, error) {
}

func (s *StoryboardService) Confirm(ctx context.Context, scope Scope, projectID, canvasID, taskRunID string, overrides []StoryboardOverride) ([]domaincanvasnode.CanvasNode, int64, error) {
	if !s.confirmationConfigured() || len(overrides) == 0 {
		return nil, 0, errno.New(errno.ErrInvalidArgument)
	}
	state, err := s.repository.GetByTaskRunID(ctx, scope, taskRunID)
	if err != nil {
		return nil, 0, classifyStoryboardStoreError(err)
	}
	if state.ProjectID != projectID || state.CanvasID != canvasID {
		return nil, 0, errno.New(errno.ErrNotFound)
	}
	if state.Status != StoryboardStatusCompleted || len(state.Drafts) != len(overrides) {
		return nil, 0, errno.New(errno.ErrConflict)
	}
	byID := make(map[string]domainvideo.Config, len(overrides))
	for _, item := range overrides {
		if strings.TrimSpace(item.DraftID) == "" || !item.GenerationConfig.Valid() {
			return nil, 0, errno.New(errno.ErrInvalidArgument)
		}
		if _, duplicate := byID[item.DraftID]; duplicate {
			return nil, 0, errno.New(errno.ErrInvalidArgument)
		}
		byID[item.DraftID] = item.GenerationConfig
	}
	inputs := make([]CanvasNodeDraftConfirmInput, 0, len(state.Drafts))
	for _, draft := range state.Drafts {
		config, ok := byID[draft.ID]
		if !ok {
			return nil, 0, errno.New(errno.ErrInvalidArgument)
		}
		inputs = append(inputs, CanvasNodeDraftConfirmInput{
			Prompt: draft.Prompt, GenerationConfig: config, AssetReferences: draft.AssetReferences,
		})
	}
	var created []domaincanvasnode.CanvasNode
	var canvasRevision int64
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		var confirmErr error
		created, canvasRevision, confirmErr = s.canvas_nodes.ConfirmStoryboardDrafts(txCtx, scope, projectID, canvasID, state.ID, inputs)
		if confirmErr != nil {
			return confirmErr
		}
		return s.repository.Resolve(txCtx, scope, projectID, canvasID, state.ID, state.Status, s.clock.Now())
	})
	if err != nil {
		return nil, 0, err
	}
	return created, canvasRevision, nil
}

func classifyStoryboardStoreError(err error) error {
	if errors.Is(err, ErrStoryboardNotFound) {
		return errno.Wrap(errno.ErrNotFound, err)
	}
	return errno.Wrap(errno.ErrInternalError, err)
}
