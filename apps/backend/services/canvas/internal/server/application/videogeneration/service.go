package videogeneration

import (
	"context"
	"errors"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/example/monorepo/canvas/internal/platform/logcontext"
	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
	applicationcanvasnode "github.com/example/monorepo/canvas/internal/server/application/canvas"
	applicationgenerationinput "github.com/example/monorepo/canvas/internal/server/application/canvasgenerationinput"
	applicationmodel "github.com/example/monorepo/canvas/internal/server/application/model"
	applicationprojectstatistics "github.com/example/monorepo/canvas/internal/server/application/projectstatistics"
	applicationprojectusage "github.com/example/monorepo/canvas/internal/server/application/projectusage"
	applicationquota "github.com/example/monorepo/canvas/internal/server/application/quota"
	applicationtask "github.com/example/monorepo/canvas/internal/server/application/task"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domaincanvasnode "github.com/example/monorepo/canvas/internal/server/domain/canvas"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/server/domain/generationinput"
	domainprojectusage "github.com/example/monorepo/canvas/internal/server/domain/projectusage"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
	domainvideo "github.com/example/monorepo/canvas/internal/server/domain/videogeneration"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const (
	initialGenerationStateVersion     = 1
	generationPollInterval            = 2 * time.Second
	generationSubmissionRecoveryDelay = 2 * time.Minute
	generationDeadline                = 24 * time.Hour
	initialFirstLastFrameStateVersion = 1
	maxFrameAssetPresignBatchSize     = 100
	// canvasGenerationConcurrency bounds simultaneous UP presign and AIGW
	// submission requests during a batch start.
	canvasGenerationConcurrency = 128
	videoGenerationCallOrdinal  = int32(1)
	videoGenerationCallType     = "VIDEO_GENERATION"
	videoResourceType           = "VIDEO"
)

var errGenerationSlotClaimed = errors.New("canvas canvasnode generation slot already claimed")

var errGenerationTargetMissing = errors.New("generation target is missing")

type Option func(*Service)

func WithTargetFailureReporter(reporter TargetFailureReporter) Option {
	return func(service *Service) {
		if reporter != nil {
			service.targetFailures = reporter
		}
	}
}

func WithFirstLastFrameDispatches(dispatches AsyncDispatchStore) Option {
	return func(service *Service) { service.asyncDispatches = dispatches }
}

func WithModelCatalog(models applicationmodel.Catalog) Option {
	return func(service *Service) { service.models = models }
}

func WithFramePreviewFailureReporter(reporter FramePreviewFailureReporter) Option {
	return func(service *Service) {
		if reporter != nil {
			service.framePreviewFailures = reporter
		}
	}
}

type FrameAssetReader interface {
	BatchPresignReferencedAssets(context.Context, applicationasset.BatchGetReferencedAssetsInput) ([]applicationasset.PresignedReferencedAsset, error)
}

type GenerationAssetManager interface {
	CreateFromOwnedArtifact(context.Context, applicationasset.CreateFromArtifactInput) (domainasset.Asset, error)
	Get(context.Context, applicationasset.GetInput) (domainasset.Asset, error)
	BypassGet(context.Context, applicationasset.BypassGetInput) (domainasset.Asset, error)
	BypassBatchGet(context.Context, applicationasset.BypassBatchGetInput) ([]domainasset.Asset, error)
	BypassBatchPresignAsset(context.Context, applicationasset.BypassBatchGetInput) ([]applicationasset.PresignedAsset, error)
	BatchPresignReferencedAssets(context.Context, applicationasset.BatchGetReferencedAssetsInput) ([]applicationasset.PresignedReferencedAsset, error)
}

func WithGenerationAssets(assets GenerationAssetManager) Option {
	return func(service *Service) { service.assetManager = assets }
}

func WithCanvasResourceAssets(resourceAssets applicationcanvasnode.CanvasResourceResolver) Option {
	return func(service *Service) { service.resourceAssets = resourceAssets }
}

func WithFrameAssets(assets FrameAssetReader) Option {
	return func(service *Service) { service.frameAssets = assets }
}

func WithFrameTaskRegistrationFailureReporter(reporter FrameTaskRegistrationFailureReporter) Option {
	return func(service *Service) {
		if reporter != nil {
			service.frameTaskFailures = reporter
		}
	}
}

func WithProjectStatistics(projector applicationprojectstatistics.Projector) Option {
	return func(service *Service) { service.projectStatistics = projector }
}

func WithProjectUsageCallRecorder(recorder *applicationprojectusage.CallRecorder) Option {
	return func(service *Service) { service.projectUsageCalls = recorder }
}

func WithProjectUsageFinalizer(finalizer *applicationprojectusage.Finalizer) Option {
	return func(service *Service) { service.projectUsageFinalizer = finalizer }
}

type AssetReferenceTracker interface {
	AcquireAssets(context.Context, applicationasset.AcquireAssetsInput) error
	ReleaseAllAssets(context.Context, applicationasset.ReleaseAllAssetsInput) error
}

type generationAssetReferenceDelta struct {
	createdAssetID string
}

type canvasnodeVideoPollApplyResult struct {
	updated           bool
	references        generationAssetReferenceDelta
	selectedProjectID string
	selectedCanvasID  string
}

func WithAssetReferences(tracker AssetReferenceTracker) Option {
	return func(service *Service) { service.assetReferences = tracker }
}

type StorageAdmission interface {
	CheckStorageAdmission(context.Context, string) error
}

func WithStorageAdmission(admission StorageAdmission) Option {
	return func(service *Service) { service.storageAdmission = admission }
}

type Service struct {
	canvas_nodes            CanvasNodeStore
	runs                    TaskRunStore
	pollSchedules           PollScheduleStore
	videoGenerations        GenerationStore
	canvasnodeVideoProvider CanvasNodeVideoProvider
	canvasnodeVideoResults  CanvasNodeVideoResultStore
	resolver                ReferenceResolver
	transactions            applicationcanvasnode.TransactionManager
	statistics              applicationcanvasnode.CanvasStatisticsProjector
	projectStatistics       applicationprojectstatistics.Projector
	ids                     IDGenerator
	clock                   Clock
	models                  applicationmodel.Catalog
	targetFailures          TargetFailureReporter
	asyncDispatches         AsyncDispatchStore
	framePreviewFailures    FramePreviewFailureReporter
	frameAssets             FrameAssetReader
	assetManager            GenerationAssetManager
	resourceAssets          applicationcanvasnode.CanvasResourceResolver
	frameTaskFailures       FrameTaskRegistrationFailureReporter
	assetReferences         AssetReferenceTracker
	projectUsageCalls       *applicationprojectusage.CallRecorder
	projectUsageFinalizer   *applicationprojectusage.Finalizer
	storageAdmission        StorageAdmission
}

type CanvasStart struct {
	NodeID    string
	TaskRunID string
}

type canvasStartResult struct {
	NodeID    string
	TaskRunID string
	Started   bool
	Err       error
}

func NewService(
	canvas_nodes CanvasNodeStore,
	runs TaskRunStore,
	pollSchedules PollScheduleStore,
	videoGenerations GenerationStore,
	canvasnodeVideoProvider CanvasNodeVideoProvider,
	canvasnodeVideoResults CanvasNodeVideoResultStore,
	resolver ReferenceResolver,
	transactions applicationcanvasnode.TransactionManager,
	statistics applicationcanvasnode.CanvasStatisticsProjector,
	ids IDGenerator,
	clock Clock,
	options ...Option,
) *Service {
	service := &Service{
		canvas_nodes: canvas_nodes, runs: runs, pollSchedules: pollSchedules,
		videoGenerations:        videoGenerations,
		canvasnodeVideoProvider: canvasnodeVideoProvider, canvasnodeVideoResults: canvasnodeVideoResults,
		resolver: resolver, transactions: transactions,
		statistics: statistics, ids: ids, clock: clock,
		targetFailures:       noopTargetFailureReporter{},
		framePreviewFailures: noopFramePreviewFailureReporter{},
		frameTaskFailures:    noopFrameTaskRegistrationFailureReporter{},
	}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) Start(ctx context.Context, scope Scope, projectID, canvasID, canvasnodeID string) (string, error) {
	taskRunID, _, err := s.start(ctx, scope, projectID, canvasID, canvasnodeID, nil)
	return taskRunID, err
}

// start reports whether this call created a new generation. Returning an
// existing non-terminal run remains a successful idempotent Start, but lets
// the canvas-wide entry point count it as skipped rather than newly started.
func (s *Service) start(ctx context.Context, scope Scope, projectID, canvasID, canvasnodeID string, preloadedNodes []domaincanvasnode.CanvasNode) (string, bool, error) {
	if !validScope(scope) || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" ||
		strings.TrimSpace(canvasnodeID) == "" || s.runs == nil || s.pollSchedules == nil || s.videoGenerations == nil || s.canvasnodeVideoProvider == nil {
		return "", false, errno.New(errno.ErrInvalidArgument)
	}
	item, err := s.canvas_nodes.Get(ctx, scope, projectID, canvasID, canvasnodeID)
	if err != nil {
		return "", false, classify(err)
	}
	if item.Type != domaincanvasnode.NodeTypeVideoGeneration {
		return "", false, errno.New(errno.ErrInvalidArgument)
	}
	if strings.TrimSpace(item.Prompt) == "" {
		return "", false, errno.New(errno.ErrInvalidArgument)
	}
	if active := strings.TrimSpace(item.ActiveTaskRunID); active != "" {
		run, runErr := s.runs.Get(ctx, runScopeFromRequest(scope), domaintask.RunTypeCanvasNodeVideoGeneration, domaintask.SubjectTypeCanvasNode, canvasnodeID, active)
		switch {
		case runErr == nil && !run.Terminal():
			return active, false, nil
		case runErr != nil && !errors.Is(runErr, applicationtask.ErrNotFound):
			return "", false, classifyRunError(runErr)
		}
		if runErr == nil || errors.Is(runErr, applicationtask.ErrNotFound) {
			if releaseErr := s.releaseRun(ctx, item, active); releaseErr != nil {
				return "", false, classify(releaseErr)
			}
		}
	}
	if s.storageAdmission != nil {
		if admissionErr := s.storageAdmission.CheckStorageAdmission(ctx, scope.TenantID); admissionErr != nil {
			switch {
			case errors.Is(admissionErr, applicationquota.ErrExceeded):
				return "", false, errno.Wrap(errno.ErrStorageQuotaExceeded, admissionErr)
			case errors.Is(admissionErr, applicationquota.ErrUnavailable):
				return "", false, errno.Wrap(errno.ErrQuotaUnavailable, admissionErr)
			default:
				return "", false, errno.Wrap(errno.ErrInternalError, admissionErr)
			}
		}
	}
	if s.models == nil {
		return "", false, errno.New(errno.ErrConfigurationError)
	}
	resolved, err := s.models.Resolve(ctx, applicationmodel.Actor{
		TenantID: scope.TenantID,
		UserID:   scope.CallerID,
	}, []applicationmodel.Requirement{{
		Capability: applicationmodel.CapabilityCanvasNodeVideo,
		ModelID:    item.GenerationConfig.ModelServiceID,
	}})
	if err != nil {
		if errors.Is(err, applicationmodel.ErrDefaultModelNotConfigured) {
			return "", false, errno.Wrap(errno.ErrDefaultModelNotConfigured, err)
		}
		if errors.Is(err, applicationmodel.ErrUnavailable) {
			return "", false, errno.Wrap(errno.ErrModelUnavailable, err)
		}
		return "", false, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	if len(resolved) != 1 || resolved[0].VideoCapabilities == nil ||
		strings.TrimSpace(resolved[0].ModelName) == "" || strings.TrimSpace(string(resolved[0].ModelSource)) == "" {
		return "", false, errno.New(errno.ErrModelDependencyError)
	}
	capabilities := *resolved[0].VideoCapabilities
	parameters := videoParameters(item.GenerationConfig, nil, item.VideoInputMode)
	if !capabilities.Supports(parameters) {
		return "", false, errno.New(errno.ErrInvalidArgument)
	}
	resolvedInputs, err := s.generationAssets(ctx, scope, projectID, canvasID, item, item.Prompt, item.VideoInputMode, item.GenerationConfig.ModelServiceID, resolved[0].IsPreset, preloadedNodes)
	if err != nil {
		return "", false, err
	}
	references, err := videoReferences(resolvedInputs.References)
	if err != nil {
		return "", false, classify(err)
	}
	parameters = videoParameters(item.GenerationConfig, references, item.VideoInputMode)
	if !capabilities.Supports(parameters) {
		return "", false, errno.New(errno.ErrInvalidArgument)
	}
	taskRunID, err := s.ids.NewID()
	if err != nil {
		return "", false, errno.Wrap(errno.ErrInternalError, err)
	}
	if err = item.BeginGeneration(taskRunID); err != nil {
		return "", false, errno.Wrap(errno.ErrInternalError, err)
	}
	now := s.clock.Now()
	initialNextPollAt := now.Add(generationSubmissionRecoveryDelay)
	deadlineAt := now.Add(generationDeadline)
	run := domaintask.TaskRun{
		ID: taskRunID, TenantID: scope.TenantID, CreatedBy: scope.CallerID, WorkspaceID: scope.WorkspaceID,
		RunType: domaintask.RunTypeCanvasNodeVideoGeneration, SubjectType: domaintask.SubjectTypeCanvasNode,
		SubjectID: canvasnodeID,
		Status:    domaintask.StatusQueued, StateVersion: initialGenerationStateVersion,
		CreatedAt: now, UpdatedAt: now,
	}
	detail := domainvideo.Generation{
		TaskRunID: taskRunID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		ProjectID: projectID, CanvasID: canvasID, NodeID: canvasnodeID,
		ModelServiceID: item.GenerationConfig.ModelServiceID,
		Resolution:     item.GenerationConfig.Resolution, AspectRatio: item.GenerationConfig.AspectRatio,
		DurationSeconds: item.GenerationConfig.DurationSeconds, GenerateAudio: item.GenerationConfig.GenerateAudio,
		Watermark: item.GenerationConfig.Watermark, Prompt: resolvedInputs.Prompt,
		AIGWTraceWorkspaceID: aigwTaskWorkspaceID(scope), Status: string(domaintask.StatusQueued),
		ProviderStatus: domainvideo.ProviderStatusPending,
		Inputs:         generationInputs(resolvedInputs.References),
		CreatedBy:      scope.CallerID, CreatedAt: now, UpdatedAt: now,
	}
	schedule := domaintask.PollSchedule{
		TaskRunID: taskRunID, NextPollAt: initialNextPollAt,
		StateVersion: initialGenerationStateVersion, DeadlineAt: deadlineAt, CreatedAt: now, UpdatedAt: now,
	}
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		claimed, claimErr := s.canvas_nodes.ClaimTaskRun(txCtx, item)
		if claimErr != nil {
			return claimErr
		}
		if !claimed {
			return errGenerationSlotClaimed
		}
		if createErr := s.runs.Create(txCtx, run); createErr != nil {
			return createErr
		}
		if s.projectUsageCalls != nil {
			if _, createErr := s.projectUsageCalls.Plan(txCtx, applicationprojectusage.BeginCallInput{
				TaskRunID: taskRunID, CallOrdinal: videoGenerationCallOrdinal,
				CallType: videoGenerationCallType, ProjectID: projectID, ModelID: detail.ModelServiceID,
				ModelName:   strings.TrimSpace(resolved[0].ModelName),
				ModelSource: strings.TrimSpace(string(resolved[0].ModelSource)),
			}); createErr != nil {
				return createErr
			}
		}
		if createErr := s.pollSchedules.CreatePollSchedule(txCtx, schedule); createErr != nil {
			return createErr
		}
		return s.videoGenerations.CreateGeneration(txCtx, detail)
	})
	if errors.Is(err, errGenerationSlotClaimed) {
		latest, getErr := s.canvas_nodes.Get(ctx, scope, projectID, canvasID, canvasnodeID)
		if getErr != nil {
			return "", false, classify(getErr)
		}
		if active := strings.TrimSpace(latest.ActiveTaskRunID); active != "" {
			if _, runErr := s.runs.Get(ctx, runScopeFromRequest(scope), domaintask.RunTypeCanvasNodeVideoGeneration, domaintask.SubjectTypeCanvasNode, canvasnodeID, active); runErr == nil {
				return active, false, nil
			} else if !errors.Is(runErr, applicationtask.ErrNotFound) {
				return "", false, errno.Wrap(errno.ErrInternalError, runErr)
			}
		}
		return "", false, errno.Wrap(errno.ErrConflict, err)
	}
	if err != nil {
		return "", false, classify(err)
	}
	startedAt := s.clock.Now()
	startedRun, started, startErr := s.markStarted(ctx, run, startedAt)
	if startErr != nil || !started {
		if startErr == nil {
			startErr = errors.New("mark video generation started lost CAS")
		}
		marked, markErr := s.markFailedWithSchedule(ctx, run, &schedule, "视频生成任务启动失败", s.clock.Now())
		if markErr == nil && !marked {
			markErr = errors.New("mark failed task run lost CAS")
		}
		return "", false, errno.Wrap(errno.ErrPersistenceError, errors.Join(startErr, markErr))
	}
	run = startedRun
	usageRef := domainprojectusage.CallRef{TaskRunID: taskRunID, CallOrdinal: videoGenerationCallOrdinal}
	if s.projectUsageCalls != nil {
		usageRef, err = s.projectUsageCalls.BeginRelated(
			ctx, taskRunID, videoGenerationCallOrdinal, videoGenerationCallType, detail.ModelServiceID,
		)
		if err != nil {
			marked, markErr := s.markFailedWithSchedule(ctx, run, &schedule, "视频生成计费调用记录失败", s.clock.Now())
			if markErr == nil && !marked {
				markErr = errors.New("mark failed task run lost CAS")
			}
			return "", false, errno.Wrap(errno.ErrPersistenceError, errors.Join(err, markErr))
		}
	}
	submitResult, err := s.canvasnodeVideoProvider.Submit(ctx, SubmitCanvasNodeVideoInput{
		TaskRunID:       taskRunID,
		CallOrdinal:     int(videoGenerationCallOrdinal),
		Model:           detail.ModelServiceID,
		Prompt:          resolvedInputs.Prompt,
		Identity:        canvasnodeVideoProviderIdentity(run, detail),
		Resolution:      item.GenerationConfig.Resolution.ProviderValue(),
		Ratio:           parameters.AspectRatio,
		DurationSeconds: int64(item.GenerationConfig.DurationSeconds),
		GenerateAudio:   item.GenerationConfig.GenerateAudio,
		Watermark:       item.GenerationConfig.Watermark,
		References:      references,
	})
	taskID := submitResult.TaskID
	if s.projectUsageCalls != nil {
		captureErr := validateVideoProviderCall(submitResult.Call, taskRunID, detail.ModelServiceID)
		if captureErr == nil {
			captureErr = s.projectUsageCalls.RecordProviderResult(
				context.WithoutCancel(ctx), usageRef, submitResult.Call.RequestID, submitResult.Call.RequestAttempted,
			)
		}
		if captureErr != nil {
			var cancelErr error
			if strings.TrimSpace(taskID) != "" {
				cancelErr = s.canvasnodeVideoProvider.Cancel(
					context.WithoutCancel(ctx), canvasnodeVideoProviderIdentity(run, detail), taskID,
				)
			}
			marked, markErr := s.markFailedWithSchedule(ctx, run, &schedule, "视频生成计费响应记录失败", s.clock.Now())
			if markErr == nil && !marked {
				markErr = errors.New("mark failed task run lost CAS")
			}
			return "", false, errno.Wrap(errno.ErrPersistenceError, errors.Join(captureErr, cancelErr, markErr))
		}
	}
	if err != nil {
		message := "视频生成任务提交失败"
		if errors.Is(err, ErrReferenceUnavailable) {
			message = "参考素材无法被 AIGW 访问"
		}
		marked, markErr := s.markFailedWithSchedule(ctx, run, &schedule, message, s.clock.Now())
		if markErr == nil && !marked {
			markErr = errors.New("mark failed task run lost CAS")
		}
		err = errors.Join(err, markErr)
		if errors.Is(err, ErrReferenceUnavailable) {
			return "", false, errno.WrapWithMessage(errno.ErrFailedPrecondition, "参考素材暂时无法供视频模型访问", err)
		}
		return "", false, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	submittedAt := s.clock.Now()
	submitted, markErr := s.markSubmitted(ctx, run, schedule, taskID, submittedAt)
	if markErr != nil || !submitted {
		if markErr == nil {
			markErr = errors.New("mark submitted task run lost CAS")
		}
		cleanupCtx := context.WithoutCancel(ctx)
		cancelErr := s.canvasnodeVideoProvider.Cancel(cleanupCtx, canvasnodeVideoProviderIdentity(run, detail), taskID)
		var confirmErr error
		if cancelErr == nil {
			// Cancellation may have won the local TaskRun CAS before Submit returned.
			// Persist the authoritative zero-charge fact independently: the TaskRun
			// may still be RUNNING if its failure update is temporarily unavailable,
			// and a non-terminal parent Close must not roll this fact back.
			confirmErr = s.confirmProjectUsageCancellation(cleanupCtx, run.ID)
		}
		_, failErr := s.markFailedWithSchedule(cleanupCtx, run, &schedule, "视频生成任务记录失败", s.clock.Now())
		var closeErr error
		if cancelErr == nil && confirmErr == nil {
			// If the TaskRun was already cancelled, this promotes its existing parent
			// projection. If it is still non-terminal, the final billing Call remains
			// durable and a later recovery Close will derive READY.
			closeErr = s.closeProjectUsage(cleanupCtx, run)
		}
		return "", false, errno.Wrap(errno.ErrInternalError, errors.Join(markErr, cancelErr, confirmErr, failErr, closeErr))
	}
	return taskRunID, true, nil
}

func validateVideoProviderCall(call CanvasNodeVideoCall, taskRunID, modelID string) error {
	if call.TaskRunID != taskRunID || call.Ordinal != int(videoGenerationCallOrdinal) ||
		strings.TrimSpace(call.ModelID) != strings.TrimSpace(modelID) {
		return errors.New("video generation provider returned mismatched usage call metadata")
	}
	return nil
}

func videoParameters(
	config domainvideo.Config,
	references []CanvasNodeVideoReference,
	inputMode domaincanvasnode.VideoInputMode,
) applicationmodel.VideoParameters {
	parameters := applicationmodel.VideoParameters{
		Resolution:      config.Resolution.ProviderValue(),
		DurationSeconds: config.DurationSeconds, GenerateAudio: config.GenerateAudio, Watermark: config.Watermark,
	}
	if inputMode != domaincanvasnode.VideoInputModeFirstLastFrame {
		parameters.AspectRatio = config.AspectRatio.ProviderValue()
	}
	for _, reference := range references {
		switch reference.MediaType {
		case domainasset.MediaImage:
			parameters.ImageReferences++
		case domainasset.MediaVideo:
			parameters.VideoReferences++
		case domainasset.MediaAudio:
			parameters.AudioReferences++
		}
	}
	return parameters
}

// StartCanvas delegates every video generation node to Start so single-node
// validation, idempotency, charging, and persistence rules remain identical.
// Other canvas node types remain available as preloaded references and are not
// generation candidates or skipped results.
func (s *Service) StartCanvas(ctx context.Context, scope Scope, projectID, canvasID string) ([]CanvasStart, int, error) {
	if !validScope(scope) || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" || s.canvas_nodes == nil {
		return nil, 0, errno.New(errno.ErrInvalidArgument)
	}
	canvas_nodes, err := s.canvas_nodes.List(ctx, scope, projectID, canvasID)
	if err != nil {
		return nil, 0, classify(err)
	}
	videoNodes := make([]domaincanvasnode.CanvasNode, 0, len(canvas_nodes))
	for _, item := range canvas_nodes {
		if item.Type == domaincanvasnode.NodeTypeVideoGeneration {
			videoNodes = append(videoNodes, item)
		}
	}
	results, err := startCanvasNodes(ctx, videoNodes, func(startCtx context.Context, canvasnodeID string) (string, bool, error) {
		return s.start(startCtx, scope, projectID, canvasID, canvasnodeID, canvas_nodes)
	})
	if err != nil {
		return nil, 0, errno.Wrap(errno.ErrInternalError, err)
	}
	if err := ctx.Err(); err != nil {
		return nil, 0, errno.Wrap(errno.ErrInternalError, err)
	}
	started := make([]CanvasStart, 0, len(results))
	skipped := 0
	for _, result := range results {
		if result.Err != nil || !result.Started {
			skipped++
			continue
		}
		started = append(started, CanvasStart{NodeID: result.NodeID, TaskRunID: result.TaskRunID})
	}
	return started, skipped, nil
}

func startCanvasNodes(
	ctx context.Context,
	canvas_nodes []domaincanvasnode.CanvasNode,
	start func(context.Context, string) (string, bool, error),
) ([]canvasStartResult, error) {
	results := make([]canvasStartResult, len(canvas_nodes))
	var group errgroup.Group
	group.SetLimit(canvasGenerationConcurrency)
	for index := range canvas_nodes {
		group.Go(func() error {
			canvasnodeID := canvas_nodes[index].ID
			result := canvasStartResult{NodeID: canvasnodeID}
			if err := ctx.Err(); err != nil {
				result.Err = err
			} else {
				result.TaskRunID, result.Started, result.Err = start(ctx, canvasnodeID)
			}
			results[index] = result
			return nil
		})
	}
	return results, group.Wait()
}

func (s *Service) generationAssets(ctx context.Context, scope Scope, projectID, canvasID string, target domaincanvasnode.CanvasNode, prompt string, inputMode domaincanvasnode.VideoInputMode, modelID string, modelIsPreset bool, preloadedNodes []domaincanvasnode.CanvasNode) (resolvedGenerationInputs, error) {
	var mentionIDs []string
	if inputMode != domaincanvasnode.VideoInputModeFirstLastFrame {
		var err error
		mentionIDs, err = domaincanvasnode.AssetMentionIDs(prompt)
		if err != nil {
			return resolvedGenerationInputs{}, errno.Wrap(errno.ErrInvalidArgument, err)
		}
		if len(mentionIDs) == 0 && !applicationgenerationinput.HasReferenceInputEdges(target) {
			return resolvedGenerationInputs{Prompt: prompt}, nil
		}
	}
	nodes := preloadedNodes
	var err error
	if nodes == nil {
		nodes, err = s.canvas_nodes.List(ctx, scope, projectID, canvasID)
		if err != nil {
			return resolvedGenerationInputs{}, classify(err)
		}
	}
	target.Prompt = prompt
	inputResolver := applicationgenerationinput.New(s.resourceAssets)
	var inputResult applicationgenerationinput.Result
	if inputMode == domaincanvasnode.VideoInputModeFirstLastFrame {
		inputResult, err = inputResolver.ResolveFrames(ctx, scope, projectID, target, nodes)
	} else {
		inputResult, err = inputResolver.ResolveMentions(ctx, scope, projectID, target, nodes, applicationgenerationinput.AllModalities())
	}
	if err != nil {
		return resolvedGenerationInputs{}, errno.Wrap(errno.ErrCanvasNodeAssetMissing, err)
	}
	assetIDs := make([]string, 0, len(inputResult.Inputs))
	for _, input := range inputResult.Inputs {
		if input.AssetID != "" {
			assetIDs = append(assetIDs, input.AssetID)
		}
	}
	if len(assetIDs) > 0 && (s.resolver == nil || s.assetManager == nil) {
		return resolvedGenerationInputs{}, errno.NewWithMessage(errno.ErrConfigurationError, "asset generation dependencies are not configured")
	}
	var resolvedAssets []domainasset.Asset
	if len(assetIDs) > 0 {
		resolvedAssets, err = s.assetManager.BypassBatchGet(ctx, applicationasset.BypassBatchGetInput{
			Scope: applicationasset.Scope{
				TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
			},
			AssetIDs: assetIDs,
		})
		if err != nil {
			return resolvedGenerationInputs{}, err
		}
	}
	assetsByID := make(map[string]domainasset.Asset, len(resolvedAssets))
	for _, asset := range resolvedAssets {
		assetsByID[asset.ID] = asset
	}
	ordered := make([]resolvedNodeReference, 0, len(inputResult.Inputs))
	for _, input := range inputResult.Inputs {
		if input.Modality == domaingenerationinput.ModalityText {
			ordered = append(ordered, resolvedNodeReference{NodeID: input.SourceNodeID, Text: input.Text, Input: input})
			continue
		}
		asset, ok := assetsByID[input.AssetID]
		if !ok {
			return resolvedGenerationInputs{}, errno.New(errno.ErrCanvasNodeAssetMissing)
		}
		expectedMediaType, validModality := applicationgenerationinput.AssetMediaType(input)
		if !validModality || asset.MediaType != expectedMediaType {
			return resolvedGenerationInputs{}, errno.New(errno.ErrCanvasNodeAssetMissing)
		}
		referenceURL, resolveErr := generationAssetReference(ctx, s.resolver, scope, asset, modelID, modelIsPreset)
		if resolveErr != nil {
			if errors.Is(resolveErr, domainasset.ErrInvalidProviderAssetReference) {
				return resolvedGenerationInputs{}, errno.WrapWithMessage(errno.ErrFailedPrecondition, "审核通过的参考素材缺少有效的火山素材 ID", resolveErr)
			}
			if errors.Is(resolveErr, ErrReferenceUnavailable) {
				return resolvedGenerationInputs{}, errno.WrapWithMessage(errno.ErrFailedPrecondition, "参考素材暂时无法供视频模型访问", resolveErr)
			}
			return resolvedGenerationInputs{}, errno.ObjectStorageDependency(resolveErr)
		}
		role := ""
		switch input.Role {
		case domaingenerationinput.RoleFirstFrame:
			role = "first_frame"
		case domaingenerationinput.RoleLastFrame:
			role = "last_frame"
		}
		ordered = append(ordered, resolvedNodeReference{NodeID: input.SourceNodeID, Asset: asset, ReferenceURL: referenceURL, Role: role, Input: input})
	}
	return resolvedGenerationInputs{Prompt: inputResult.Prompt, References: ordered}, nil
}

func generationInputs(references []resolvedNodeReference) []domaingenerationinput.Input {
	result := make([]domaingenerationinput.Input, 0, len(references))
	contentIndex := int32(1)
	for _, reference := range references {
		input := reference.Input
		if input.AssetID != "" {
			index := contentIndex
			input.ProviderContentIndex = &index
			contentIndex++
		}
		result = append(result, input)
	}
	return result
}

func generationAssetReference(ctx context.Context, resolver ReferenceResolver, scope Scope, asset domainasset.Asset, modelID string, modelIsPreset bool) (string, error) {
	if len(asset.Reviews) > 0 {
		reference, err := asset.ProviderReferenceForModel(modelID, modelIsPreset)
		if err != nil || reference != "" {
			return reference, err
		}
	}
	return resolver.PublicReferenceURL(ctx, scope.TenantID, scope.CallerID, asset)
}

func (s *Service) List(ctx context.Context, scope Scope, projectID, canvasID, canvasnodeID string) ([]TaskRun, error) {
	if !validScope(scope) || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" || strings.TrimSpace(canvasnodeID) == "" || s.videoGenerations == nil || s.canvasnodeVideoResults == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	generations, err := s.videoGenerations.ListGenerations(ctx, scope, projectID, canvasID, canvasnodeID)
	if err != nil {
		return nil, classifyRunError(err)
	}
	for index := range generations {
		generation := generations[index]
		if generation.Status == string(domaintask.StatusSucceeded) {
			if generation.AssetID == "" {
				return nil, errno.New(errno.ErrPersistenceError)
			}
		}
	}
	previewURLs, err := s.videoAssetPreviewURLs(ctx, scope, projectID, generations)
	if err != nil {
		return nil, err
	}
	items := make([]TaskRun, 0, len(generations))
	for index := range generations {
		item := runFromGeneration(generations[index])
		if generations[index].Status == string(domaintask.StatusSucceeded) && generations[index].AssetID != "" {
			item.VideoURL = previewURLs[generations[index].AssetID]
		}
		items = append(items, item)
	}
	runPointers := make([]*TaskRun, 0, len(items))
	for index := range items {
		runPointers = append(runPointers, &items[index])
	}
	s.addFramePreviewURLs(ctx, scope, runPointers)
	return items, nil
}

func (s *Service) Select(ctx context.Context, scope Scope, projectID, canvasID, canvasnodeID, historyID string) (TaskRun, error) {
	if !validScope(scope) || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" || strings.TrimSpace(canvasnodeID) == "" || strings.TrimSpace(historyID) == "" || s.videoGenerations == nil || s.canvasnodeVideoResults == nil {
		return TaskRun{}, errno.New(errno.ErrInvalidArgument)
	}
	candidate, err := s.getVisibleGeneration(ctx, scope, projectID, canvasID, canvasnodeID, historyID)
	if errors.Is(err, ErrNotFound) {
		return TaskRun{}, errno.Wrap(errno.ErrNotFound, err)
	}
	if err != nil {
		return TaskRun{}, classifyRunError(err)
	}
	if candidate.Status != string(domaintask.StatusSucceeded) {
		return TaskRun{}, errno.NewWithMessage(errno.ErrFailedPrecondition, "只能选用已成功生成的视频")
	}
	if candidate.AssetID == "" {
		return TaskRun{}, errno.New(errno.ErrPersistenceError)
	}
	if err = s.validateGenerationVideoAsset(ctx, scope, projectID, candidate.TaskRunID, candidate.AssetID); err != nil {
		return TaskRun{}, err
	}
	var selected domainvideo.Generation
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		var selectErr error
		selected, selectErr = s.videoGenerations.SelectGeneration(txCtx, scope, projectID, canvasID, canvasnodeID, historyID, scope.CallerID, s.clock.Now())
		return selectErr
	})
	if errors.Is(err, ErrHistoryNotSelectable) {
		return TaskRun{}, errno.WrapWithMessage(errno.ErrFailedPrecondition, "只能选用已成功生成的视频", err)
	}
	if err != nil {
		return TaskRun{}, classifyRunError(err)
	}
	s.statistics.Refresh(ctx, scope, projectID, canvasID)
	if s.projectStatistics != nil {
		projectCtx := logcontext.WithBusiness(ctx, logcontext.Business{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ProjectID: projectID, CanvasID: canvasID,
		})
		s.projectStatistics.Refresh(projectCtx, applicationprojectstatistics.Scope{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		}, projectID, applicationprojectstatistics.SelectedVideoDurationField)
	}
	s.EnsureSelectedOutputFirstLastFrames(ctx, scope, []string{selected.TaskRunID})
	out := runFromGeneration(selected)
	previewURLs, err := s.videoAssetPreviewURLs(ctx, scope, projectID, []domainvideo.Generation{selected})
	if err != nil {
		return TaskRun{}, err
	}
	out.VideoURL = previewURLs[selected.AssetID]
	s.addFramePreviewURLs(ctx, scope, []*TaskRun{&out})
	return out, nil
}

func (s *Service) videoAssetPreviewURLs(ctx context.Context, scope Scope, projectID string, generations []domainvideo.Generation) (map[string]string, error) {
	references := make([]applicationasset.AssetReference, 0, len(generations))
	for _, generation := range generations {
		if generation.Status == string(domaintask.StatusSucceeded) && generation.AssetID != "" {
			references = append(references, applicationasset.AssetReference{
				Owner:   applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationOutput, Key: generation.TaskRunID},
				AssetID: generation.AssetID,
			})
		}
	}
	urls := make(map[string]string, len(references))
	if len(references) == 0 {
		return urls, nil
	}
	if s.assetManager == nil {
		return nil, errno.New(errno.ErrInternalError)
	}
	for start := 0; start < len(references); start += maxFrameAssetPresignBatchSize {
		end := min(start+maxFrameAssetPresignBatchSize, len(references))
		batchReferences := references[start:end]
		items, err := s.assetManager.BatchPresignReferencedAssets(ctx, applicationasset.BatchGetReferencedAssetsInput{
			Scope:      applicationasset.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID},
			References: batchReferences,
		})
		if err != nil {
			return nil, err
		}
		found := make(map[string]struct{}, len(items))
		for _, item := range items {
			if !validGenerationVideoAsset(item.Asset, projectID) {
				return nil, errno.New(errno.ErrPersistenceError)
			}
			found[item.Reference.AssetID] = struct{}{}
			urls[item.Reference.AssetID] = item.URL
		}
		for _, reference := range batchReferences {
			if _, ok := found[reference.AssetID]; !ok {
				return nil, errno.New(errno.ErrPersistenceError)
			}
		}
	}
	return urls, nil
}

func (s *Service) validateGenerationVideoAsset(ctx context.Context, scope Scope, projectID, taskRunID, assetID string) error {
	if s.assetManager == nil {
		return errno.New(errno.ErrInternalError)
	}
	asset, err := s.assetManager.Get(ctx, applicationasset.GetInput{
		Scope: applicationasset.Scope{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
		},
		Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationOutput, Key: taskRunID}, AssetID: assetID,
	})
	if err != nil {
		if errno.IsCode(err, errno.ErrNotFound) || errors.Is(err, applicationasset.ErrNotFound) {
			return errno.Wrap(errno.ErrPersistenceError, err)
		}
		return err
	}
	if !validGenerationVideoAsset(asset, projectID) {
		return errno.New(errno.ErrPersistenceError)
	}
	return nil
}

func validGenerationVideoAsset(asset domainasset.Asset, projectID string) bool {
	return asset.ID != "" && asset.OwnerType == domainasset.OwnerProject && asset.OwnerID == projectID && asset.MediaType == domainasset.MediaVideo
}

func (s *Service) addFramePreviewURLs(ctx context.Context, scope Scope, runs []*TaskRun) {
	if s.frameAssets == nil {
		return
	}
	references := make([]applicationasset.AssetReference, 0, len(runs)*2)
	for _, run := range runs {
		if run.FirstFrameAssetID != "" {
			references = append(references, applicationasset.AssetReference{Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationFirstFrame, Key: run.TaskRunID}, AssetID: run.FirstFrameAssetID})
		}
		if run.LastFrameAssetID != "" {
			references = append(references, applicationasset.AssetReference{Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationLastFrame, Key: run.TaskRunID}, AssetID: run.LastFrameAssetID})
		}
	}
	if len(references) == 0 {
		return
	}
	byID := make(map[string]applicationasset.PresignedReferencedAsset, len(references))
	errorsByID := make(map[string]error)
	assetScope := applicationasset.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID}
	for start := 0; start < len(references); start += maxFrameAssetPresignBatchSize {
		end := min(start+maxFrameAssetPresignBatchSize, len(references))
		batchReferences := references[start:end]
		items, err := s.frameAssets.BatchPresignReferencedAssets(ctx, applicationasset.BatchGetReferencedAssetsInput{
			Scope: assetScope, References: batchReferences,
		})
		for _, item := range items {
			byID[item.Reference.AssetID] = item
		}
		if err != nil {
			for _, reference := range batchReferences {
				errorsByID[reference.AssetID] = err
			}
		}
	}
	for _, run := range runs {
		s.assignFramePreview(ctx, run, run.FirstFrameAssetID, true, byID, errorsByID[run.FirstFrameAssetID])
		s.assignFramePreview(ctx, run, run.LastFrameAssetID, false, byID, errorsByID[run.LastFrameAssetID])
	}
}

func (s *Service) assignFramePreview(ctx context.Context, run *TaskRun, assetID string, first bool, items map[string]applicationasset.PresignedReferencedAsset, batchErr error) {
	if assetID == "" {
		return
	}
	item, found := items[assetID]
	if batchErr != nil || !found || item.URL == "" {
		err := batchErr
		if err == nil {
			err = errors.New("frame Asset preview is unavailable")
		}
		s.framePreviewFailures.ReportFramePreviewFailure(ctx, run.TenantID, assetID, err)
		return
	}
	if first {
		run.FirstFrameURL = item.URL
	} else {
		run.LastFrameURL = item.URL
	}
}

func (s *Service) Cancel(ctx context.Context, scope Scope, projectID, canvasID, canvasnodeID, taskRunID string) error {
	if !validScope(scope) || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" || strings.TrimSpace(canvasnodeID) == "" || strings.TrimSpace(taskRunID) == "" || s.runs == nil || s.videoGenerations == nil || s.canvasnodeVideoProvider == nil {
		return errno.New(errno.ErrInvalidArgument)
	}
	if _, err := s.getVisibleGeneration(ctx, scope, projectID, canvasID, canvasnodeID, taskRunID); err != nil {
		return classifyRunError(err)
	}
	run, err := s.runs.Get(ctx, runScopeFromRequest(scope), domaintask.RunTypeCanvasNodeVideoGeneration, domaintask.SubjectTypeCanvasNode, canvasnodeID, taskRunID)
	if err != nil {
		return classifyRunError(err)
	}
	if run.Terminal() {
		return nil
	}
	return s.cancelRun(ctx, run, true)
}

func (s *Service) getVisibleGeneration(
	ctx context.Context,
	scope Scope,
	projectID, canvasID, canvasnodeID, taskRunID string,
) (domainvideo.Generation, error) {
	detail, err := s.videoGenerations.GetVisibleGeneration(ctx, scope, taskRunID)
	if err != nil {
		return domainvideo.Generation{}, err
	}
	if detail.TaskRunID != taskRunID || detail.TenantID != scope.TenantID ||
		!sameWorkspace(detail.WorkspaceID, scope.WorkspaceID) || detail.ProjectID != projectID ||
		detail.CanvasID != canvasID || detail.NodeID != canvasnodeID {
		return domainvideo.Generation{}, ErrNotFound
	}
	return detail, nil
}

func (s *Service) cancelRun(ctx context.Context, run domaintask.TaskRun, requireQueuedProvider bool) error {
	detail, detailErr := s.videoGenerations.GetGeneration(ctx, runScope(run), run.ID)
	if detailErr != nil && !errors.Is(detailErr, ErrNotFound) {
		return classifyRunError(detailErr)
	}
	providerCancellationConfirmed := false
	if detailErr == nil && detail.ProviderTaskID != "" {
		// Check the same provider task that will be cancelled: submission may finish
		// after the earlier visibility read. TaskRun RUNNING does not imply that
		// the provider is running; it also covers queueing and artifact processing.
		if requireQueuedProvider {
			task, getErr := s.canvasnodeVideoProvider.Get(ctx, canvasnodeVideoProviderIdentity(run, detail), detail.ProviderTaskID)
			if getErr != nil {
				return errno.Wrap(errno.ErrInternalError, getErr)
			}
			if task.Status != domainvideo.ProviderStatusQueued {
				return errno.New(errno.ErrConflict)
			}
		}
		cancelErr := s.canvasnodeVideoProvider.Cancel(ctx, canvasnodeVideoProviderIdentity(run, detail), detail.ProviderTaskID)
		if cancelErr == nil {
			providerCancellationConfirmed = true
		} else if !errors.Is(cancelErr, ErrCanvasNodeVideoProviderTaskNotFound) {
			return errno.Wrap(errno.ErrInternalError, cancelErr)
		}
	}
	cancelled, err := s.markCancelled(ctx, run, providerCancellationConfirmed, s.clock.Now())
	if err != nil {
		return errno.Wrap(errno.ErrInternalError, err)
	}
	if cancelled {
		return nil
	}
	latest, err := s.runs.GetTaskRun(ctx, run.ID)
	if err == nil && latest.Terminal() {
		return nil
	}
	return errno.New(errno.ErrConflict)
}

func (s *Service) CancelActive(ctx context.Context, scope Scope, item domaincanvasnode.CanvasNode) error {
	taskRunID := strings.TrimSpace(item.ActiveTaskRunID)
	if taskRunID == "" {
		return nil
	}
	run, err := s.runs.GetTaskRun(ctx, taskRunID)
	if errors.Is(err, applicationtask.ErrNotFound) {
		return nil
	}
	if err != nil {
		return classifyRunError(err)
	}
	if run.TenantID != scope.TenantID || !sameWorkspace(run.WorkspaceID, scope.WorkspaceID) ||
		run.SubjectType != domaintask.SubjectTypeCanvasNode ||
		run.SubjectID != item.ID || run.RunType != domaintask.RunTypeCanvasNodeVideoGeneration {
		return errno.New(errno.ErrNotFound)
	}
	if run.Terminal() {
		return nil
	}
	return s.cancelRun(ctx, run, false)
}

func (s *Service) HideByCanvasNodes(ctx context.Context, scope Scope, canvasnodeIDs []string, hiddenAt time.Time) error {
	return s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		hiddenRunIDs, detailErr := s.videoGenerations.HideGenerations(txCtx, scope, canvasnodeIDs, hiddenAt)
		runErr := s.runs.HideTaskRunsBySubjects(
			txCtx, runScopeFromRequest(scope), domaintask.RunTypeCanvasNodeVideoGeneration,
			domaintask.SubjectTypeCanvasNode, canvasnodeIDs, hiddenAt,
		)
		if err := errors.Join(detailErr, runErr); err != nil {
			return err
		}
		if s.assetReferences != nil {
			for _, runID := range hiddenRunIDs {
				for _, ownerType := range []applicationasset.ReferenceOwnerType{
					applicationasset.ReferenceOwnerVideoGenerationOutput,
					applicationasset.ReferenceOwnerVideoGenerationFirstFrame,
					applicationasset.ReferenceOwnerVideoGenerationLastFrame,
				} {
					if err := s.assetReferences.ReleaseAllAssets(txCtx, applicationasset.ReleaseAllAssetsInput{
						Scope: generationAssetReferenceScope(scope),
						Owner: applicationasset.ReferenceOwner{Type: ownerType, Key: runID},
					}); err != nil {
						return err
					}
				}
			}
		}
		return nil
	})
}

func (s *Service) releaseRun(ctx context.Context, item domaincanvasnode.CanvasNode, taskRunID string) error {
	if item.ActiveTaskRunID != taskRunID {
		return nil
	}
	item.FinishGeneration()
	_, err := s.canvas_nodes.ReleaseTaskRun(ctx, item, taskRunID)
	return err
}

func (s *Service) markSubmitted(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule, taskID string, now time.Time) (bool, error) {
	updated := false
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		var updateErr error
		// The version-only RUNNING transition fences a cancellation that read the
		// run before ProviderTaskID existed. A stale canceller must retry, reload
		// the provider task, and perform the real remote cancellation.
		updated, updateErr = s.runs.UpdateTaskRun(txCtx, run, TaskRunUpdate{
			Status: domaintask.StatusRunning,
		}, now)
		if updateErr != nil || !updated {
			return updateErr
		}
		if updateErr := s.videoGenerations.MarkGenerationSubmitted(txCtx, run.ID, taskID, now); updateErr != nil {
			return updateErr
		}
		rescheduled, scheduleErr := s.pollSchedules.ReschedulePoll(txCtx, schedule, domaintask.PollScheduleUpdate{
			NextPollAt: now.Add(generationPollInterval),
		}, now)
		if scheduleErr != nil {
			return scheduleErr
		}
		if !rescheduled {
			return errors.New("mark submitted poll schedule lost CAS")
		}
		return nil
	})
	return updated, err
}

func (s *Service) markStarted(
	ctx context.Context,
	run domaintask.TaskRun,
	startedAt time.Time,
) (domaintask.TaskRun, bool, error) {
	updated := false
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		var updateErr error
		updated, updateErr = s.runs.UpdateTaskRun(txCtx, run, TaskRunUpdate{
			Status: domaintask.StatusRunning, StartedAt: &startedAt,
		}, startedAt)
		if updateErr != nil || !updated {
			return updateErr
		}
		return s.videoGenerations.UpdateGeneration(txCtx, run.ID, GenerationUpdate{
			Status: string(domaintask.StatusRunning), UpdatedAt: startedAt,
		})
	})
	if err != nil || !updated {
		return run, updated, err
	}
	run.Status = domaintask.StatusRunning
	run.StartedAt = &startedAt
	run.StateVersion++
	run.UpdatedAt = startedAt
	return run, true, nil
}

func (s *Service) markFailed(ctx context.Context, run domaintask.TaskRun, message string, finishedAt time.Time) (bool, error) {
	return s.markFailedWithSchedule(ctx, run, nil, message, finishedAt)
}

func (s *Service) closeProjectUsage(ctx context.Context, run domaintask.TaskRun) error {
	if s.projectUsageFinalizer == nil {
		return nil
	}
	return s.projectUsageFinalizer.Close(ctx, applicationprojectusage.CloseInput{TaskRunID: run.ID})
}

func (s *Service) triggerProjectUsageAfterCommit(taskRunID string) {
	if s.projectUsageFinalizer != nil {
		s.projectUsageFinalizer.TriggerAfterCommit(taskRunID)
	}
}

func (s *Service) markFailedWithSchedule(ctx context.Context, run domaintask.TaskRun, schedule *domaintask.PollSchedule, message string, finishedAt time.Time) (bool, error) {
	updated := false
	var missing error
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		var updateErr error
		updated, updateErr = s.runs.UpdateTaskRun(txCtx, run, TaskRunUpdate{
			Status: domaintask.StatusFailed, ErrorMessage: message, FinishedAt: &finishedAt,
		}, finishedAt)
		if updateErr != nil || !updated {
			return updateErr
		}
		if updateErr = s.videoGenerations.UpdateGeneration(txCtx, run.ID, GenerationUpdate{Status: string(domaintask.StatusFailed), ErrorMessage: message, CompletedAt: &finishedAt, UpdatedAt: finishedAt}); updateErr != nil {
			if !errors.Is(updateErr, ErrNotFound) {
				return updateErr
			}
			missing = errors.Join(missing, updateErr)
		}
		_, _, updateErr = s.releaseGenerationSlot(txCtx, run)
		if updateErr != nil && !errors.Is(updateErr, applicationcanvasnode.ErrNotFound) {
			return updateErr
		}
		missing = errors.Join(missing, updateErr)
		if schedule != nil {
			completed, completeErr := s.pollSchedules.CompletePollSchedule(txCtx, *schedule)
			if completeErr != nil {
				return completeErr
			}
			if !completed {
				return errors.New("complete failed poll schedule lost CAS")
			}
		} else if updateErr = s.pollSchedules.DeletePollSchedule(txCtx, run.ID); updateErr != nil {
			return updateErr
		}
		return s.closeProjectUsage(txCtx, run)
	})
	if err == nil {
		s.triggerProjectUsageAfterCommit(run.ID)
	}
	if err == nil && missing != nil {
		s.targetFailures.ReportTargetFailure(ctx, run, missing)
	}
	return updated, err
}

func (s *Service) markCancelled(
	ctx context.Context,
	run domaintask.TaskRun,
	providerCancellationConfirmed bool,
	finishedAt time.Time,
) (bool, error) {
	updated := false
	var missing error
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		var updateErr error
		updated, updateErr = s.runs.UpdateTaskRun(txCtx, run, TaskRunUpdate{
			Status: domaintask.StatusCancelled, FinishedAt: &finishedAt,
		}, finishedAt)
		if updateErr != nil || !updated {
			return updateErr
		}
		if updateErr = s.videoGenerations.UpdateGeneration(txCtx, run.ID, GenerationUpdate{Status: string(domaintask.StatusCancelled), CompletedAt: &finishedAt, UpdatedAt: finishedAt}); updateErr != nil {
			if !errors.Is(updateErr, ErrNotFound) {
				return updateErr
			}
			missing = errors.Join(missing, updateErr)
		}
		_, _, updateErr = s.releaseGenerationSlot(txCtx, run)
		if updateErr != nil && !errors.Is(updateErr, applicationcanvasnode.ErrNotFound) {
			return updateErr
		}
		missing = errors.Join(missing, updateErr)
		if updateErr = s.pollSchedules.DeletePollSchedule(txCtx, run.ID); updateErr != nil {
			return updateErr
		}
		if providerCancellationConfirmed {
			return s.confirmAndCloseProjectUsageCancellation(txCtx, run)
		}
		return s.closeProjectUsage(txCtx, run)
	})
	if err == nil {
		s.triggerProjectUsageAfterCommit(run.ID)
	}
	if err == nil && missing != nil {
		s.targetFailures.ReportTargetFailure(ctx, run, missing)
	}
	return updated, err
}

func (s *Service) confirmProjectUsageCancellation(ctx context.Context, taskRunID string) error {
	if s.projectUsageCalls == nil {
		return nil
	}
	return s.projectUsageCalls.CancelConfirmed(ctx, domainprojectusage.CallRef{
		TaskRunID: taskRunID, CallOrdinal: videoGenerationCallOrdinal,
	})
}

func (s *Service) confirmAndCloseProjectUsageCancellation(ctx context.Context, run domaintask.TaskRun) error {
	if err := s.confirmProjectUsageCancellation(ctx, run.ID); err != nil {
		return err
	}
	return s.closeProjectUsage(ctx, run)
}

func (s *Service) applyPoll(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule, poll CanvasNodeVideoPollResult, now time.Time) error {
	_, err := s.applyPollWithHistory(ctx, run, schedule, poll, "", "", PersistedCanvasNodeVideo{}, now)
	return err
}

func (s *Service) applyPollWithHistory(
	ctx context.Context,
	run domaintask.TaskRun,
	schedule domaintask.PollSchedule,
	poll CanvasNodeVideoPollResult,
	previousProviderStatus domainvideo.ProviderStatus,
	providerVideoURL string,
	persisted PersistedCanvasNodeVideo,
	now time.Time,
) (canvasnodeVideoPollApplyResult, error) {
	updated := false
	var missing error
	selectedProjectID := ""
	selectedCanvasID := ""
	createdAssetID := ""
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		var updateErr error
		if terminalStatus(poll.TerminalStatus) {
			// The TaskRun CAS must win before accounting the owned Artifact as
			// Asset metadata. Otherwise a losing poller can commit an orphan Asset
			// even though it no longer owns the right to finalize this Run.
			updated, updateErr = s.runs.UpdateTaskRun(txCtx, run, TaskRunUpdate{
				Status: poll.TerminalStatus, ErrorMessage: poll.ErrorMessage, FinishedAt: poll.FinishedAt,
			}, now)
			if updateErr != nil || !updated {
				return updateErr
			}
			assetID := ""
			if poll.TerminalStatus == domaintask.StatusSucceeded {
				if s.assetManager == nil || persisted.ArtifactID == "" || persisted.SizeBytes <= 0 {
					return errors.New("generation Asset manager or persisted video metadata is missing")
				}
				detail, detailErr := s.videoGenerations.GetGeneration(txCtx, runScope(run), run.ID)
				if detailErr != nil {
					return detailErr
				}
				asset, assetErr := s.assetManager.CreateFromOwnedArtifact(txCtx, applicationasset.CreateFromArtifactInput{
					Scope:     applicationasset.Scope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy},
					OwnerType: domainasset.OwnerProject, OwnerID: detail.ProjectID,
					ArtifactID: persisted.ArtifactID, ArtifactNamespace: persisted.ArtifactNamespace, FileName: run.ID + ".mp4", MediaType: domainasset.MediaVideo,
					ContentType: "video/mp4", SizeBytes: persisted.SizeBytes,
				})
				if assetErr != nil {
					return assetErr
				}
				assetID = asset.ID
				createdAssetID = asset.ID
			}
			if updateErr = s.videoGenerations.UpdateGeneration(txCtx, run.ID, GenerationUpdate{Status: string(poll.TerminalStatus), AssetID: assetID, ErrorMessage: poll.ErrorMessage, CompletedAt: poll.FinishedAt, UpdatedAt: now}); updateErr != nil {
				if errors.Is(updateErr, ErrNotFound) {
					missing = updateErr
					return errGenerationTargetMissing
				}
				return updateErr
			}
			if createdAssetID != "" && s.assetReferences != nil {
				if updateErr = s.assetReferences.AcquireAssets(txCtx, applicationasset.AcquireAssetsInput{
					Scope:    generationAssetReferenceScope(runScope(run)),
					Owner:    applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationOutput, Key: run.ID},
					AssetIDs: []string{createdAssetID},
				}); updateErr != nil {
					return updateErr
				}
			}
			if poll.TerminalStatus == domaintask.StatusSucceeded && s.asyncDispatches != nil {
				if updateErr = s.createFirstLastFrameTask(txCtx, firstLastFrameTargetFromRun(run), now); updateErr != nil {
					return updateErr
				}
			}
			if poll.ProviderStatus == domainvideo.ProviderStatusCancelled {
				updateErr = s.confirmAndCloseProjectUsageCancellation(txCtx, run)
			} else {
				updateErr = s.closeProjectUsage(txCtx, run)
			}
			if updateErr != nil {
				return updateErr
			}
		}
		if providerObservationChanged(previousProviderStatus, providerVideoURL, poll) {
			if updateErr = s.videoGenerations.UpdateGenerationProviderObservation(
				txCtx, run.ID, poll.ProviderStatus, providerVideoURL,
				poll.OutputDurationSeconds, poll.ProviderErrorCode, poll.ProviderErrorMessage, poll.SeedanceTaskID, now,
			); updateErr != nil {
				if errors.Is(updateErr, ErrNotFound) {
					missing = updateErr
					return errGenerationTargetMissing
				}
				return updateErr
			}
		}
		if !terminalStatus(poll.TerminalStatus) {
			if poll.NextPollingAt == nil {
				return errors.New("running generation poll has no next polling time")
			}
			consecutiveErrors := int32(0)
			if poll.ProviderError {
				consecutiveErrors = schedule.ConsecutiveErrors + 1
			}
			rescheduled, scheduleErr := s.pollSchedules.ReschedulePoll(txCtx, schedule, domaintask.PollScheduleUpdate{
				NextPollAt: *poll.NextPollingAt, PollAttempts: schedule.PollAttempts + 1,
				ConsecutiveErrors: consecutiveErrors, DeadlineAt: poll.DeadlineAt,
			}, now)
			if scheduleErr != nil {
				return scheduleErr
			}
			if !rescheduled {
				return errors.New("reschedule generation poll lost CAS")
			}
			updated = true
			return nil
		}
		completed, scheduleErr := s.pollSchedules.CompletePollSchedule(txCtx, schedule)
		if scheduleErr != nil {
			return scheduleErr
		}
		if !completed {
			return errors.New("complete generation poll lost CAS")
		}
		item, released, releaseErr := s.releaseGenerationSlot(txCtx, run)
		if releaseErr != nil {
			if errors.Is(releaseErr, applicationcanvasnode.ErrNotFound) {
				missing = releaseErr
				return errGenerationTargetMissing
			}
			return releaseErr
		}
		if poll.TerminalStatus != domaintask.StatusSucceeded {
			return nil
		}
		if !released {
			// A revoked slot only removes this TaskRun's right to become the current
			// CanvasNode output. It does not change the provider's successful fact or
			// make the persisted Artifact invalid as generation history.
			return nil
		}
		if _, updateErr = s.videoGenerations.SelectGeneration(txCtx, runScope(run), item.ProjectID, item.CanvasID, item.ID, run.ID, run.CreatedBy, now); updateErr != nil {
			if errors.Is(updateErr, ErrNotFound) {
				missing = updateErr
				return errGenerationTargetMissing
			}
			return updateErr
		}
		selectedProjectID = item.ProjectID
		selectedCanvasID = item.CanvasID
		return nil
	})
	result := canvasnodeVideoPollApplyResult{
		updated:           updated,
		references:        generationAssetReferenceDelta{createdAssetID: createdAssetID},
		selectedProjectID: selectedProjectID,
		selectedCanvasID:  selectedCanvasID,
	}
	if err == nil {
		if result.selectedProjectID != "" {
			s.statistics.Refresh(ctx, runScope(run), result.selectedProjectID, result.selectedCanvasID)
		}
		if terminalStatus(poll.TerminalStatus) {
			s.triggerProjectUsageAfterCommit(run.ID)
		}
		s.applyCanvasNodeVideoPostCommit(ctx, run, result)
	}
	if errors.Is(err, errGenerationTargetMissing) {
		s.targetFailures.ReportTargetFailure(ctx, run, missing)
		_, failErr := s.markFailed(ctx, run, "视频生成目标已不存在", now)
		return canvasnodeVideoPollApplyResult{}, failErr
	}
	return result, err
}

func (s *Service) applyCanvasNodeVideoPostCommit(ctx context.Context, run domaintask.TaskRun, result canvasnodeVideoPollApplyResult) {
	if result.selectedProjectID != "" && s.projectStatistics != nil {
		projectCtx := logcontext.WithBusiness(ctx, logcontext.Business{
			TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, ProjectID: result.selectedProjectID,
		})
		s.projectStatistics.Refresh(projectCtx, applicationprojectstatistics.Scope{
			TenantID: run.TenantID, WorkspaceID: run.WorkspaceID,
		}, result.selectedProjectID, applicationprojectstatistics.SelectedVideoDurationField)
	}
	if result.selectedProjectID != "" {
		s.EnsureSelectedOutputFirstLastFrames(ctx, runScope(run), []string{run.ID})
	}
}

func generationAssetReferenceScope(scope Scope) applicationasset.ReferenceScope {
	return applicationasset.ReferenceScope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}
}

type firstLastFrameTarget struct {
	GenerationTaskRunID string
	TenantID            string
	WorkspaceID         *string
	NodeID              string
	CreatedBy           string
}

func firstLastFrameTargetFromRun(run domaintask.TaskRun) firstLastFrameTarget {
	return firstLastFrameTarget{
		GenerationTaskRunID: run.ID,
		TenantID:            run.TenantID,
		WorkspaceID:         run.WorkspaceID,
		NodeID:              run.SubjectID,
		CreatedBy:           run.CreatedBy,
	}
}

func firstLastFrameTargetFromGeneration(generation domainvideo.Generation) firstLastFrameTarget {
	return firstLastFrameTarget{
		GenerationTaskRunID: generation.TaskRunID,
		TenantID:            generation.TenantID,
		WorkspaceID:         generation.WorkspaceID,
		NodeID:              generation.NodeID,
		CreatedBy:           generation.CreatedBy,
	}
}

func (s *Service) ensureSelectedOutputFirstLastFrames(ctx context.Context, scope Scope, outputIDs []string) error {
	ids := uniqueNonEmpty(outputIDs)
	if !validScope(scope) || s.asyncDispatches == nil || len(ids) == 0 {
		return nil
	}
	now := s.clock.Now()
	return s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		candidates, err := s.videoGenerations.ListFirstLastFrameCandidates(txCtx, scope, ids)
		if err != nil {
			return err
		}
		for index := range candidates {
			if err = s.createFirstLastFrameTask(txCtx, firstLastFrameTargetFromGeneration(candidates[index]), now); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Service) EnsureSelectedOutputFirstLastFrames(ctx context.Context, scope Scope, outputIDs []string) {
	ids := uniqueNonEmpty(outputIDs)
	if err := s.ensureSelectedOutputFirstLastFrames(ctx, scope, ids); err != nil {
		s.frameTaskFailures.ReportFrameTaskRegistrationFailure(ctx, scope.TenantID, ids, err)
	}
}

func uniqueNonEmpty(values []string) []string {
	items := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		items = append(items, value)
	}
	return items
}

func (s *Service) createFirstLastFrameTask(ctx context.Context, target firstLastFrameTarget, now time.Time) error {
	taskRunID, err := s.ids.NewID()
	if err != nil {
		return err
	}
	attached, err := s.videoGenerations.AttachFirstLastFrameTask(ctx, target.GenerationTaskRunID, taskRunID, now)
	if err != nil {
		return err
	}
	if !attached {
		return nil
	}
	run := domaintask.TaskRun{
		ID: taskRunID, TenantID: target.TenantID, WorkspaceID: target.WorkspaceID,
		CreatedBy:   target.CreatedBy,
		RunType:     domaintask.RunTypeCanvasNodeVideoFirstLastFrameExtraction,
		SubjectType: domaintask.SubjectTypeCanvasNode, SubjectID: target.NodeID,
		Status: domaintask.StatusQueued, IsInternal: true, StateVersion: initialFirstLastFrameStateVersion,
		CreatedAt: now, UpdatedAt: now,
	}
	if err = s.runs.Create(ctx, run); err != nil {
		return err
	}
	return s.asyncDispatches.CreateAsyncDispatch(ctx, domaintask.AsyncDispatch{
		TaskRunID: taskRunID, RunType: domaintask.RunTypeCanvasNodeVideoFirstLastFrameExtraction,
		DeliveryState: domaintask.AsyncDeliveryPending, ExecutionState: domaintask.AsyncExecutionWaiting,
		NextDispatchAt: now, DeliveryVersion: initialFirstLastFrameStateVersion,
		ExecutionVersion: initialFirstLastFrameStateVersion, CreatedAt: now, UpdatedAt: now,
	})
}

func providerObservationChanged(previousStatus domainvideo.ProviderStatus, providerVideoURL string, poll CanvasNodeVideoPollResult) bool {
	return poll.ProviderStatus != "" && (poll.ProviderStatus != previousStatus ||
		providerVideoURL != "" || poll.OutputDurationSeconds != nil ||
		poll.ProviderErrorCode != "" || poll.ProviderErrorMessage != "" || poll.SeedanceTaskID != "")
}

type noopTargetFailureReporter struct{}

func (noopTargetFailureReporter) ReportTargetFailure(context.Context, domaintask.TaskRun, error) {
}

type noopFramePreviewFailureReporter struct{}

func (noopFramePreviewFailureReporter) ReportFramePreviewFailure(context.Context, string, string, error) {
}

type noopFrameTaskRegistrationFailureReporter struct{}

func (noopFrameTaskRegistrationFailureReporter) ReportFrameTaskRegistrationFailure(context.Context, string, []string, error) {
}

func (s *Service) releaseGenerationSlot(ctx context.Context, run domaintask.TaskRun) (domaincanvasnode.CanvasNode, bool, error) {
	item, err := s.canvas_nodes.GetByID(ctx, runScope(run), run.SubjectID)
	if err != nil {
		return domaincanvasnode.CanvasNode{}, false, err
	}
	item.FinishGeneration()
	released, err := s.canvas_nodes.ReleaseTaskRun(ctx, item, run.ID)
	if err != nil {
		return domaincanvasnode.CanvasNode{}, false, err
	}
	return item, released, nil
}

func runScopeFromRequest(scope Scope) applicationtask.Scope {
	return applicationtask.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}
}

func runScope(run domaintask.TaskRun) Scope {
	return Scope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy}
}

func sameWorkspace(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func canvasnodeVideoProviderIdentity(run domaintask.TaskRun, detail domainvideo.Generation) CanvasNodeVideoProviderIdentity {
	return CanvasNodeVideoProviderIdentity{TenantID: run.TenantID, CallerID: run.CreatedBy, WorkspaceID: detail.AIGWTraceWorkspaceID, ProjectID: detail.ProjectID}
}

func aigwTaskWorkspaceID(scope Scope) string {
	if scope.WorkspaceID != nil {
		if workspaceID := strings.TrimSpace(*scope.WorkspaceID); workspaceID != "" {
			return workspaceID
		}
	}
	return "personal-" + scope.CallerID
}

func runFromGeneration(generation domainvideo.Generation) TaskRun {
	return TaskRun{
		TaskRunID: generation.TaskRunID, TenantID: generation.TenantID, WorkspaceID: generation.WorkspaceID,
		ProjectID: generation.ProjectID, CanvasID: generation.CanvasID, NodeID: generation.NodeID,
		CallerID: generation.CreatedBy, Status: generation.Status, ProviderStatus: generation.ProviderStatus,
		ProviderTaskID: generation.ProviderTaskID,
		SeedanceTaskID: generation.SeedanceTaskID,
		NodeType:       domaincanvasnode.NodeTypeVideoGeneration, OutputAssetID: generation.AssetID,
		ErrorCode:      generation.ProviderErrorCode,
		ErrorMessage:   generation.ErrorMessage,
		ModelServiceID: generation.ModelServiceID, Prompt: generation.Prompt,
		Resolution: generation.Resolution, AspectRatio: generation.AspectRatio,
		DurationSeconds: generation.DurationSeconds, GenerateAudio: generation.GenerateAudio, Watermark: generation.Watermark,
		FirstFrameAssetID: generation.FirstFrameAssetID, LastFrameAssetID: generation.LastFrameAssetID,
		Inputs:    append([]domaingenerationinput.Input(nil), generation.Inputs...),
		CreatedAt: generation.CreatedAt, UpdatedAt: generation.UpdatedAt, FinishedAt: generation.CompletedAt,
	}
}

func terminalStatus(status domaintask.Status) bool {
	switch status {
	case domaintask.StatusSucceeded, domaintask.StatusFailed, domaintask.StatusCancelled:
		return true
	default:
		return false
	}
}

func classifyRunError(err error) error {
	if errors.Is(err, ErrNotFound) || errors.Is(err, applicationtask.ErrNotFound) || errors.Is(err, applicationcanvasnode.ErrNotFound) {
		return errno.Wrap(errno.ErrNotFound, err)
	}
	return errno.Wrap(errno.ErrPersistenceError, err)
}

func validScope(scope Scope) bool {
	return strings.TrimSpace(scope.TenantID) != "" && strings.TrimSpace(scope.CallerID) != ""
}

func classify(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrNotFound) || errors.Is(err, applicationtask.ErrNotFound) || errors.Is(err, applicationcanvasnode.ErrNotFound) {
		return errno.Wrap(errno.ErrNotFound, err)
	}
	if errors.Is(err, applicationcanvasnode.ErrAssetMissing) {
		return errno.Wrap(errno.ErrCanvasNodeAssetMissing, err)
	}
	return errno.Wrap(errno.ErrPersistenceError, err)
}
