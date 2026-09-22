package canvastextgeneration

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationgenerationinput "github.com/example/monorepo/canvas/internal/application/canvasgenerationinput"
	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	applicationprojectusage "github.com/example/monorepo/canvas/internal/application/projectusage"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
	domainprojectusage "github.com/example/monorepo/canvas/internal/domain/projectusage"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const (
	lifetime                       = 9 * time.Minute
	liveProjectionRetention        = 30 * time.Minute
	textGenerationCallOrdinal      = int32(1)
	textGenerationInterruptedCause = "canvas text generation was interrupted after an AIGW call began"
)

var ErrNotFound = errors.New("canvas text generation not found")

const (
	StatusQueued    = domaintask.StatusQueued
	StatusRunning   = domaintask.StatusRunning
	StatusSucceeded = domaintask.StatusSucceeded
	StatusFailed    = domaintask.StatusFailed
	StatusCancelled = domaintask.StatusCancelled
)

type Failure struct{ Code, Message string }
type Session struct {
	ID, ProjectID, CanvasID, NodeID, Prompt, ModelServiceID, Content string
	Inputs                                                           []domaingenerationinput.Input
	Status                                                           domaintask.Status
	Failure                                                          *Failure
	CreatedAt, UpdatedAt                                             time.Time
	FinishedAt                                                       *time.Time
}

type Delta struct {
	Cursor string
	Text   string
}

type Cache interface {
	Create(context.Context, applicationcanvas.Scope, Session) (bool, error)
	Get(context.Context, applicationcanvas.Scope, string, string, string, string) (Session, error)
	Append(context.Context, applicationcanvas.Scope, string, string, string, string, string) error
	ReadDeltas(context.Context, applicationcanvas.Scope, string, string, string, string, string, time.Duration) ([]Delta, error)
	Retire(context.Context, applicationcanvas.Scope, string, string, string, string, time.Duration) error
}
type Repository interface {
	Create(context.Context, applicationcanvas.Scope, Session) error
	Get(context.Context, applicationcanvas.Scope, string) (Session, error)
	GetHistory(context.Context, applicationcanvas.Scope, string, string, string, string) (Session, error)
	List(context.Context, applicationcanvas.Scope, string, string, string) ([]Session, error)
	MarkRunning(context.Context, applicationcanvas.Scope, string, time.Time) error
	Append(context.Context, applicationcanvas.Scope, string, string, time.Time) error
	Finish(context.Context, applicationcanvas.Scope, string, domaintask.Status, *Failure, time.Time) error
}
type NodeStore interface {
	Get(context.Context, applicationcanvas.Scope, string, string, string) (domaincanvas.CanvasNode, error)
	ClaimTaskRun(context.Context, domaincanvas.CanvasNode) (bool, error)
	ReleaseTaskRun(context.Context, domaincanvas.CanvasNode, string) (bool, error)
	BindGeneratedText(context.Context, applicationcanvas.Scope, string, string, string, string, string, time.Time) (bool, error)
	SelectGeneratedText(context.Context, applicationcanvas.Scope, string, string, string, string, string, time.Time) (bool, error)
}

type InputNodeStore interface {
	List(context.Context, applicationcanvas.Scope, string, string) ([]domaincanvas.CanvasNode, error)
	applicationcanvas.CanvasResourceResolver
}

type InputAssetReader interface {
	BypassBatchGet(context.Context, applicationasset.BypassBatchGetInput) ([]domainasset.Asset, error)
}

type InputReferenceResolver interface {
	PlatformReferenceURL(context.Context, string, string, domainasset.Asset) (string, error)
}

type ProviderInput struct {
	TenantID    string
	WorkspaceID *string
	CallerID    string
	TaskRunID   string
	CallOrdinal int32
	Selection   applicationmodel.Selection
	Prompt      string
	References  []Reference
	Emit        func(string) error
}

type Reference struct {
	Modality domaingenerationinput.Modality
	URL      string
}

type ProviderCall struct {
	TaskRunID        string
	Ordinal          int32
	ModelID          string
	RequestID        string
	RequestAttempted bool
}

type ProviderResult struct {
	Call ProviderCall
}

type Provider interface {
	Generate(context.Context, ProviderInput) (ProviderResult, error)
}
type IDGenerator interface{ NewID() (string, error) }
type Clock interface{ Now() time.Time }

type UsageFinalizer interface {
	Close(context.Context, applicationprojectusage.CloseInput) error
	TriggerAfterCommit(string) bool
}

type Service struct {
	nodes          NodeStore
	cache          Cache
	repository     Repository
	runs           applicationtask.TaskRunStore
	schedules      applicationtask.PollScheduleStore
	executions     *applicationtask.ActiveExecutions
	transactions   applicationtask.TransactionManager
	ids            IDGenerator
	clock          Clock
	models         applicationmodel.Catalog
	provider       Provider
	usageCalls     *applicationprojectusage.CallRecorder
	usageFinalizer UsageFinalizer
	inputNodes     InputNodeStore
	inputAssets    InputAssetReader
	inputResolver  InputReferenceResolver
}

type Option func(*Service)

func WithProjectUsage(calls *applicationprojectusage.CallRecorder, finalizer UsageFinalizer) Option {
	return func(service *Service) {
		service.usageCalls = calls
		service.usageFinalizer = finalizer
	}
}

func WithGenerationInputs(nodes InputNodeStore, assets InputAssetReader, resolver InputReferenceResolver) Option {
	return func(service *Service) {
		service.inputNodes, service.inputAssets, service.inputResolver = nodes, assets, resolver
	}
}

func NewService(nodes NodeStore, cache Cache, repository Repository, runs applicationtask.TaskRunStore, schedules applicationtask.PollScheduleStore, executions *applicationtask.ActiveExecutions, transactions applicationtask.TransactionManager, ids IDGenerator, clock Clock, models applicationmodel.Catalog, provider Provider, options ...Option) *Service {
	service := &Service{nodes: nodes, cache: cache, repository: repository, runs: runs, schedules: schedules, executions: executions, transactions: transactions, ids: ids, clock: clock, models: models, provider: provider}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) Start(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID string) (Session, error) {
	if !s.configured() {
		return Session{}, errno.New(errno.ErrConfigurationError)
	}
	node, err := s.nodes.Get(ctx, scope, projectID, canvasID, nodeID)
	if err != nil {
		return Session{}, err
	}
	if node.Type != domaincanvas.NodeTypeTextGeneration || strings.TrimSpace(node.Prompt) == "" || !utf8.ValidString(node.Prompt) || strings.TrimSpace(node.GenerationConfig.ModelServiceID) == "" || node.ActiveTaskRunID != "" {
		return Session{}, errno.New(errno.ErrInvalidArgument)
	}
	resolved, err := s.models.Resolve(ctx, applicationmodel.Actor{
		TenantID: scope.TenantID,
		UserID:   scope.CallerID,
	}, []applicationmodel.Requirement{{
		Capability: applicationmodel.CapabilityCanvasTextGeneration,
		ModelID:    node.GenerationConfig.ModelServiceID,
	}})
	if err != nil {
		if errors.Is(err, applicationmodel.ErrDefaultModelNotConfigured) {
			return Session{}, errno.Wrap(errno.ErrDefaultModelNotConfigured, err)
		}
		if errors.Is(err, applicationmodel.ErrUnavailable) {
			return Session{}, errno.Wrap(errno.ErrModelUnavailable, err)
		}
		return Session{}, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	if len(resolved) != 1 || strings.TrimSpace(resolved[0].Selection.ModelID) == "" ||
		strings.TrimSpace(resolved[0].ModelName) == "" || strings.TrimSpace(string(resolved[0].ModelSource)) == "" {
		return Session{}, errno.New(errno.ErrModelDependencyError)
	}
	selection := resolved[0].Selection
	inputResult, err := s.resolveGenerationInputs(ctx, scope, projectID, canvasID, node)
	if err != nil {
		return Session{}, errno.Wrap(errno.ErrCanvasNodeAssetMissing, err)
	}
	id, err := s.ids.NewID()
	if err != nil {
		return Session{}, errno.Wrap(errno.ErrInternalError, err)
	}
	now := s.clock.Now().UTC()
	state := Session{ID: id, ProjectID: projectID, CanvasID: canvasID, NodeID: nodeID, Prompt: inputResult.Prompt, Inputs: inputResult.Inputs, ModelServiceID: selection.ModelID, Status: domaintask.StatusQueued, CreatedAt: now, UpdatedAt: now}
	run := domaintask.TaskRun{ID: id, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CreatedBy: scope.CallerID, RunType: s.RunType(), SubjectType: domaintask.SubjectTypeCanvasNode, SubjectID: nodeID, Status: domaintask.StatusQueued, StateVersion: 1, CreatedAt: now, UpdatedAt: now}
	schedule := domaintask.PollSchedule{TaskRunID: id, NextPollAt: now, StateVersion: 1, DeadlineAt: now.Add(lifetime), CreatedAt: now, UpdatedAt: now}
	if err := node.BeginGeneration(id); err != nil {
		return Session{}, errno.Wrap(errno.ErrInternalError, err)
	}
	err = s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		claimed, claimErr := s.nodes.ClaimTaskRun(tx, node)
		if claimErr != nil {
			return claimErr
		}
		if !claimed {
			return errors.New("text generation slot already claimed")
		}
		if createErr := s.runs.Create(tx, run); createErr != nil {
			return createErr
		}
		if s.usageCalls != nil {
			if _, createErr := s.usageCalls.Plan(tx, applicationprojectusage.BeginCallInput{
				TaskRunID: id, CallOrdinal: textGenerationCallOrdinal,
				CallType:  applicationprojectusage.CallTypeCanvasTextGeneration,
				ProjectID: projectID, ModelID: selection.ModelID,
				ModelName: resolved[0].ModelName, ModelSource: string(resolved[0].ModelSource),
			}); createErr != nil {
				return createErr
			}
		}
		if createErr := s.repository.Create(tx, scope, state); createErr != nil {
			return createErr
		}
		return s.schedules.CreatePollSchedule(tx, schedule)
	})
	if err != nil {
		return Session{}, errno.Wrap(errno.ErrInternalError, err)
	}
	return state, nil
}

func (*Service) RunType() domaintask.RunType { return domaintask.RunTypeCanvasNodeTextGeneration }

func (s *Service) resolveGenerationInputs(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID string, target domaincanvas.CanvasNode) (applicationgenerationinput.Result, error) {
	mentionIDs, err := domaincanvas.AssetMentionIDs(target.Prompt)
	if err != nil {
		return applicationgenerationinput.Result{Prompt: target.Prompt}, err
	}
	if len(mentionIDs) == 0 && !applicationgenerationinput.HasReferenceInputEdges(target) {
		return applicationgenerationinput.Result{Prompt: target.Prompt}, nil
	}
	if s.inputNodes == nil {
		return applicationgenerationinput.Result{}, errors.New("text generation input resolver is not configured")
	}
	nodes, err := s.inputNodes.List(ctx, scope, projectID, canvasID)
	if err != nil {
		return applicationgenerationinput.Result{}, err
	}
	result, err := applicationgenerationinput.New(s.inputNodes).ResolveMentions(ctx, scope, projectID, target, nodes, applicationgenerationinput.AllModalities())
	if err != nil {
		return applicationgenerationinput.Result{}, err
	}
	contentIndex := int32(1)
	for index := range result.Inputs {
		if result.Inputs[index].AssetID == "" {
			continue
		}
		providerIndex := contentIndex
		result.Inputs[index].ProviderContentIndex = &providerIndex
		contentIndex++
	}
	return result, nil
}

func (s *Service) resolveProviderReferences(ctx context.Context, scope applicationcanvas.Scope, inputs []domaingenerationinput.Input) ([]Reference, error) {
	assetIDs := make([]string, 0, len(inputs))
	for _, input := range inputs {
		if input.AssetID != "" {
			assetIDs = append(assetIDs, input.AssetID)
		}
	}
	if len(assetIDs) == 0 {
		return nil, nil
	}
	if s.inputAssets == nil || s.inputResolver == nil {
		return nil, errors.New("text generation media resolver is not configured")
	}
	assets, err := s.inputAssets.BypassBatchGet(ctx, applicationasset.BypassBatchGetInput{Scope: applicationasset.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID}, AssetIDs: assetIDs})
	if err != nil {
		return nil, err
	}
	byID := make(map[string]domainasset.Asset, len(assets))
	for _, asset := range assets {
		byID[asset.ID] = asset
	}
	references := make([]Reference, 0, len(assetIDs))
	for _, input := range inputs {
		if input.AssetID == "" {
			continue
		}
		asset, exists := byID[input.AssetID]
		if !exists {
			return nil, errors.New("text generation input asset is unavailable")
		}
		expectedMediaType, validModality := applicationgenerationinput.AssetMediaType(input)
		if !validModality || asset.MediaType != expectedMediaType {
			return nil, errors.New("text generation input asset modality does not match its source node")
		}
		url, resolveErr := s.inputResolver.PlatformReferenceURL(ctx, scope.TenantID, scope.CallerID, asset)
		if resolveErr != nil || strings.TrimSpace(url) == "" {
			return nil, errors.Join(resolveErr, errors.New("text generation input asset is unavailable"))
		}
		references = append(references, Reference{Modality: input.Modality, URL: url})
	}
	return references, nil
}

func (s *Service) ProcessPollClaim(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule) error {
	if !s.configured() || run.RunType != s.RunType() || schedule.TaskRunID != run.ID {
		return errors.New("text generation claim is invalid")
	}
	scope := applicationcanvas.Scope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy}
	state, err := s.repository.Get(ctx, scope, run.ID)
	if err != nil {
		return err
	}
	if state.Status == domaintask.StatusQueued {
		now := s.clock.Now()
		started := now
		err = s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
			if e := s.repository.MarkRunning(tx, scope, run.ID, now); e != nil {
				return e
			}
			ok, e := s.runs.UpdateTaskRun(tx, run, applicationtask.TaskRunUpdate{Status: domaintask.StatusRunning, StartedAt: &started}, now)
			if e != nil {
				return e
			}
			if !ok {
				return errors.New("text generation start fencing lost")
			}
			return nil
		})
		if err != nil {
			return err
		}
		state.Status = domaintask.StatusRunning
		run.Status = domaintask.StatusRunning
		run.StateVersion++
	}
	if state.Status != domaintask.StatusRunning {
		return nil
	}
	if err = s.ensureCache(ctx, scope, state); err != nil {
		return s.finish(context.WithoutCancel(ctx), scope, run, schedule, domaintask.StatusFailed, &Failure{Code: string(errno.ErrInternalError), Message: errno.Meta(errno.ErrInternalError).Message})
	}
	providerCtx, cancel := context.WithDeadline(ctx, schedule.DeadlineAt)
	defer cancel()
	selection, err := s.models.LoadSelection(providerCtx, scope.TenantID, scope.WorkspaceID, applicationmodel.CapabilityCanvasTextGeneration, state.ModelServiceID)
	var references []Reference
	if err == nil {
		references, err = s.resolveProviderReferences(providerCtx, scope, state.Inputs)
	}
	usageRef := domainprojectusage.CallRef{TaskRunID: state.ID, CallOrdinal: textGenerationCallOrdinal}
	if err == nil && s.usageCalls != nil {
		var interrupted bool
		interrupted, err = s.usageCalls.MarkInterruptedIfPresent(providerCtx, usageRef, textGenerationInterruptedCause)
		if err == nil && interrupted {
			err = errors.New(textGenerationInterruptedCause)
		}
		if err == nil {
			usageRef, err = s.usageCalls.BeginRelated(
				providerCtx,
				state.ID,
				textGenerationCallOrdinal,
				applicationprojectusage.CallTypeCanvasTextGeneration,
				state.ModelServiceID,
			)
		}
	}
	var providerResult ProviderResult
	providerInvoked := false
	if err == nil {
		providerInvoked = true
		providerResult, err = s.provider.Generate(providerCtx, ProviderInput{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
			TaskRunID: state.ID, CallOrdinal: textGenerationCallOrdinal,
			Selection: selection, Prompt: state.Prompt, References: references,
			Emit: func(delta string) error {
				if delta == "" {
					return nil
				}
				state.Content += delta
				state.UpdatedAt = s.clock.Now()
				if e := s.cache.Append(providerCtx, scope, state.ProjectID, state.CanvasID, state.NodeID, state.ID, delta); e != nil {
					return e
				}
				return s.repository.Append(providerCtx, scope, state.ID, delta, state.UpdatedAt)
			},
		})
	}
	if s.usageCalls != nil && providerInvoked {
		captureErr := validateTextProviderCall(providerResult.Call, state.ID, state.ModelServiceID)
		if captureErr == nil {
			captureErr = s.usageCalls.RecordProviderResult(
				context.WithoutCancel(ctx),
				usageRef,
				providerResult.Call.RequestID,
				providerResult.Call.RequestAttempted,
			)
		}
		if captureErr != nil {
			err = errors.Join(err, captureErr)
		}
	}
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil
		}
		if errors.Is(err, applicationmodel.ErrDefaultModelNotConfigured) {
			err = errno.Wrap(errno.ErrDefaultModelNotConfigured, err)
		}
		return s.finish(context.WithoutCancel(ctx), scope, run, schedule, domaintask.StatusFailed, &Failure{Code: string(errno.CodeOf(err)), Message: errno.MessageOf(err)})
	}
	return s.finish(context.WithoutCancel(ctx), scope, run, schedule, domaintask.StatusSucceeded, nil)
}

func (s *Service) finish(ctx context.Context, scope applicationcanvas.Scope, run domaintask.TaskRun, schedule domaintask.PollSchedule, status domaintask.Status, failure *Failure) error {
	state, err := s.repository.Get(ctx, scope, run.ID)
	if err != nil {
		return err
	}
	now := s.clock.Now()
	update := applicationtask.TaskRunUpdate{Status: status, FinishedAt: &now}
	if failure != nil {
		update.ErrorCode, update.ErrorMessage = failure.Code, failure.Message
	}
	err = s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		if e := s.repository.Finish(tx, scope, run.ID, status, failure, now); e != nil {
			return e
		}
		if status == domaintask.StatusSucceeded {
			_, e := s.nodes.BindGeneratedText(tx, scope, state.ProjectID, state.CanvasID, state.NodeID, state.ID, state.Content, now)
			if e != nil && !errors.Is(e, applicationcanvas.ErrNotFound) {
				return e
			}
		} else {
			node, e := s.nodes.Get(tx, scope, state.ProjectID, state.CanvasID, state.NodeID)
			if e != nil && !errors.Is(e, applicationcanvas.ErrNotFound) {
				return e
			}
			if e == nil {
				if _, e = s.nodes.ReleaseTaskRun(tx, node, state.ID); e != nil {
					return e
				}
			}
		}
		ok, e := s.runs.UpdateTaskRun(tx, run, update, now)
		if e != nil {
			return e
		}
		if !ok {
			return errors.New("text generation finish fencing lost")
		}
		done, e := s.schedules.CompletePollSchedule(tx, schedule)
		if e != nil {
			return e
		}
		if !done {
			return errors.New("text generation schedule fencing lost")
		}
		return s.closeUsage(tx, run.ID)
	})
	if err == nil {
		s.retireCache(ctx, scope, state.ProjectID, state.CanvasID, state.NodeID, state.ID)
		s.triggerUsage(run.ID)
	}
	return err
}

func (s *Service) Get(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID, taskRunID string) (Session, error) {
	if _, err := s.nodes.Get(ctx, scope, projectID, canvasID, nodeID); err != nil {
		return Session{}, err
	}
	return s.getSession(ctx, scope, projectID, canvasID, nodeID, taskRunID)
}

func (s *Service) List(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID string) ([]Session, error) {
	if s == nil || s.nodes == nil || s.repository == nil || strings.TrimSpace(scope.TenantID) == "" || strings.TrimSpace(scope.CallerID) == "" || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" || strings.TrimSpace(nodeID) == "" {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	node, err := s.nodes.Get(ctx, scope, projectID, canvasID, nodeID)
	if err != nil {
		return nil, err
	}
	if node.Type != domaincanvas.NodeTypeTextGeneration {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	items, err := s.repository.List(ctx, scope, projectID, canvasID, nodeID)
	if err != nil {
		return nil, errno.Wrap(errno.ErrPersistenceError, err)
	}
	return items, nil
}

func (s *Service) Select(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID, historyID string) (Session, error) {
	if s == nil || s.nodes == nil || s.repository == nil || s.clock == nil || strings.TrimSpace(scope.TenantID) == "" || strings.TrimSpace(scope.CallerID) == "" || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" || strings.TrimSpace(nodeID) == "" || strings.TrimSpace(historyID) == "" {
		return Session{}, errno.New(errno.ErrInvalidArgument)
	}
	node, err := s.nodes.Get(ctx, scope, projectID, canvasID, nodeID)
	if err != nil {
		return Session{}, err
	}
	if node.Type != domaincanvas.NodeTypeTextGeneration {
		return Session{}, errno.New(errno.ErrInvalidArgument)
	}
	history, err := s.repository.GetHistory(ctx, scope, projectID, canvasID, nodeID, historyID)
	if errors.Is(err, ErrNotFound) {
		return Session{}, errno.Wrap(errno.ErrNotFound, err)
	}
	if err != nil {
		return Session{}, errno.Wrap(errno.ErrPersistenceError, err)
	}
	if history.Status != domaintask.StatusSucceeded || strings.TrimSpace(history.Content) == "" {
		return Session{}, errno.NewWithMessage(errno.ErrFailedPrecondition, "只能选用已成功生成的文本")
	}
	selected, err := s.nodes.SelectGeneratedText(ctx, scope, projectID, canvasID, nodeID, history.ID, history.Content, s.clock.Now().UTC())
	if err != nil {
		return Session{}, errno.Wrap(errno.ErrPersistenceError, err)
	}
	if !selected {
		return Session{}, errno.New(errno.ErrConflict)
	}
	return history, nil
}

func (s *Service) getSession(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID, taskRunID string) (Session, error) {
	durable, err := s.repository.Get(ctx, scope, taskRunID)
	if err != nil {
		return Session{}, err
	}
	if durable.ProjectID != projectID || durable.CanvasID != canvasID || durable.NodeID != nodeID {
		return Session{}, errno.New(errno.ErrNotFound)
	}
	if durable.Status != domaintask.StatusQueued && durable.Status != domaintask.StatusRunning {
		return durable, nil
	}
	live, e := s.cache.Get(ctx, scope, projectID, canvasID, nodeID, taskRunID)
	if e == nil {
		return live, nil
	}
	return durable, nil
}

func (s *Service) Cancel(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID, taskRunID string) error {
	state, err := s.getSession(ctx, scope, projectID, canvasID, nodeID, taskRunID)
	if err != nil {
		return err
	}
	run, err := s.runs.GetTaskRun(ctx, taskRunID)
	if err != nil {
		return err
	}
	if run.Terminal() {
		return nil
	}
	now := s.clock.Now()
	err = s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		if e := s.repository.Finish(tx, scope, state.ID, domaintask.StatusCancelled, nil, now); e != nil {
			return e
		}
		node, e := s.nodes.Get(tx, scope, projectID, canvasID, nodeID)
		if e != nil && !errors.Is(e, applicationcanvas.ErrNotFound) {
			return e
		}
		if e == nil {
			if _, e = s.nodes.ReleaseTaskRun(tx, node, state.ID); e != nil {
				return e
			}
		}
		ok, e := s.runs.UpdateTaskRun(tx, run, applicationtask.TaskRunUpdate{Status: domaintask.StatusCancelled, FinishedAt: &now}, now)
		if e != nil {
			return e
		}
		if !ok {
			return errors.New("text generation cancel fencing lost")
		}
		if e = s.schedules.DeletePollSchedule(tx, state.ID); e != nil {
			return e
		}
		return s.closeUsage(tx, run.ID)
	})
	if err == nil {
		s.executions.Cancel(taskRunID)
		s.retireCache(ctx, scope, projectID, canvasID, nodeID, taskRunID)
		s.triggerUsage(taskRunID)
	}
	return err
}

// retireCache keeps the ordered delta stream briefly after terminal commit so
// an SSE reader can drain every provider event even when generation finishes
// between two reads. Durable terminal reads still bypass this projection.
func (s *Service) retireCache(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID, taskRunID string) {
	if err := s.cache.Retire(ctx, scope, projectID, canvasID, nodeID, taskRunID, liveProjectionRetention); err != nil {
		return
	}
}

func (s *Service) ReadDeltas(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID, taskRunID, cursor string, block time.Duration) ([]Delta, error) {
	if !s.configured() || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" ||
		strings.TrimSpace(nodeID) == "" || strings.TrimSpace(taskRunID) == "" || strings.TrimSpace(cursor) == "" || block <= 0 {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	if _, err := s.Get(ctx, scope, projectID, canvasID, nodeID, taskRunID); err != nil {
		return nil, err
	}
	return s.cache.ReadDeltas(ctx, scope, projectID, canvasID, nodeID, taskRunID, cursor, block)
}

func (s *Service) ensureCache(ctx context.Context, scope applicationcanvas.Scope, state Session) error {
	created, err := s.cache.Create(ctx, scope, state)
	if err != nil || created {
		return err
	}
	live, err := s.cache.Get(ctx, scope, state.ProjectID, state.CanvasID, state.NodeID, state.ID)
	if err != nil {
		return err
	}
	if live.ID != state.ID {
		return errors.New("text generation cache conflict")
	}
	return nil
}
func (s *Service) configured() bool {
	return s != nil && s.nodes != nil && s.cache != nil && s.repository != nil && s.runs != nil && s.schedules != nil && s.executions != nil && s.transactions != nil && s.ids != nil && s.clock != nil && s.models != nil && s.provider != nil &&
		(s.usageCalls == nil) == (s.usageFinalizer == nil)
}

func validateTextProviderCall(call ProviderCall, taskRunID, modelID string) error {
	if strings.TrimSpace(call.TaskRunID) != strings.TrimSpace(taskRunID) ||
		call.Ordinal != textGenerationCallOrdinal ||
		strings.TrimSpace(call.ModelID) != strings.TrimSpace(modelID) {
		return errors.New("canvas text provider returned mismatched usage call metadata")
	}
	return nil
}

func (s *Service) closeUsage(ctx context.Context, taskRunID string) error {
	if s.usageFinalizer == nil {
		return nil
	}
	return s.usageFinalizer.Close(ctx, applicationprojectusage.CloseInput{TaskRunID: taskRunID})
}

func (s *Service) triggerUsage(taskRunID string) {
	if s.usageFinalizer != nil {
		s.usageFinalizer.TriggerAfterCommit(taskRunID)
	}
}
