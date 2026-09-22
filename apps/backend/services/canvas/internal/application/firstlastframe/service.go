package firstlastframe

import (
	"context"
	"errors"
	"strings"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	artifactnamespace "github.com/example/monorepo/canvas/internal/infrastructure/storage/namespace"
)

var (
	ErrExecutionNotReady  = errors.New("first last frame execution is not ready")
	ErrExecutionSucceeded = errors.New("first last frame execution already succeeded")
	ErrExecutionTerminal  = errors.New("first last frame execution is terminal")
	ErrLifecycleCASLost   = errors.New("first last frame lifecycle compare-and-swap lost")
)

type Generation struct {
	GenerationTaskRunID, FirstLastFrameTaskRunID     string
	TenantID, ProjectID, CreatedBy, SourceArtifactID string
	WorkspaceID                                      *string
	SourceArtifactNamespace                          string
	FirstFrameAssetID, LastFrameAssetID              string
	FirstFrameCheckpointID, LastFrameCheckpointID    string
	FirstFrameCheckpointSizeBytes                    int64
	LastFrameCheckpointSizeBytes                     int64
	GenerationStatus                                 domaintask.Status
}

type Execution struct {
	TaskRunID, GenerationTaskRunID string
	TenantID, ProjectID, CreatedBy string
	WorkspaceID                    *string
	SourceArtifactID               string
	SourceArtifactNamespace        string
	FirstFrameCheckpointID         string
	LastFrameCheckpointID          string
	FirstFrameCheckpointSizeBytes  int64
	LastFrameCheckpointSizeBytes   int64
}

type Result struct {
	FirstFrameArtifactID string `json:"FirstFrameArtifactID"`
	LastFrameArtifactID  string `json:"LastFrameArtifactID"`
	FirstFrameSizeBytes  int64  `json:"FirstFrameSizeBytes"`
	LastFrameSizeBytes   int64  `json:"LastFrameSizeBytes"`
}

type GenerationStore interface {
	GetByFirstLastFrameTaskRunID(context.Context, string) (Generation, error)
	GetByFirstLastFrameTaskRunIDForUpdate(context.Context, string) (Generation, error)
	RecordArtifactCheckpoint(context.Context, string, string, Result, time.Time) (bool, error)
	CommitAssets(context.Context, string, string, Result, string, string, time.Time) (bool, error)
}

type TaskStore interface {
	GetTaskRun(context.Context, string) (domaintask.TaskRun, error)
	GetTaskRunForUpdate(context.Context, string) (domaintask.TaskRun, error)
	UpdateTaskRun(context.Context, domaintask.TaskRun, applicationtask.TaskRunUpdate, time.Time) (bool, error)
}

type TransactionManager interface {
	WithinTransaction(context.Context, func(context.Context) error) error
}

type Clock interface{ Now() time.Time }

type AssetManager interface {
	LockOwner(context.Context, applicationasset.Scope, domainasset.OwnerType, string) error
	CreateFromOwnedArtifact(context.Context, applicationasset.CreateFromArtifactInput) (domainasset.Asset, error)
}

type AssetReferenceTracker interface {
	AcquireAssets(context.Context, applicationasset.AcquireAssetsInput) error
}

type TerminalCoordinator interface {
	OnTerminal(context.Context, domaintask.TaskRun, time.Time) (applicationtask.TerminalOutcome, error)
	AfterCommit(applicationtask.TerminalOutcome)
}

type Option func(*Service)

func WithAssets(assets AssetManager) Option {
	return func(service *Service) { service.assets = assets }
}

func WithAssetReferences(references AssetReferenceTracker) Option {
	return func(service *Service) { service.assetReferences = references }
}

func WithTerminalCoordinator(coordinator TerminalCoordinator) Option {
	return func(service *Service) { service.terminalCoordinator = coordinator }
}

type Service struct {
	generations         GenerationStore
	tasks               TaskStore
	transactions        TransactionManager
	clock               Clock
	assets              AssetManager
	assetReferences     AssetReferenceTracker
	terminalCoordinator TerminalCoordinator
}

func NewService(generations GenerationStore, tasks TaskStore, transactions TransactionManager, clock Clock, options ...Option) *Service {
	service := &Service{generations: generations, tasks: tasks, transactions: transactions, clock: clock}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) LoadExecution(ctx context.Context, taskRunID string) (Execution, error) {
	run, err := s.tasks.GetTaskRun(ctx, taskRunID)
	if err != nil {
		return Execution{}, err
	}
	if run.ID != taskRunID || !isFirstLastFrameRun(run) {
		return Execution{}, ErrExecutionTerminal
	}
	switch run.Status {
	case domaintask.StatusRunning:
	case domaintask.StatusQueued:
		return Execution{}, ErrExecutionNotReady
	case domaintask.StatusSucceeded:
		return Execution{}, ErrExecutionSucceeded
	default:
		return Execution{}, ErrExecutionTerminal
	}
	generation, err := s.generations.GetByFirstLastFrameTaskRunID(ctx, taskRunID)
	if err != nil {
		return Execution{}, err
	}
	if generation.GenerationStatus != domaintask.StatusSucceeded || strings.TrimSpace(generation.SourceArtifactID) == "" ||
		generation.FirstLastFrameTaskRunID != taskRunID {
		return Execution{}, ErrExecutionNotReady
	}
	return Execution{
		TaskRunID: taskRunID, GenerationTaskRunID: generation.GenerationTaskRunID,
		TenantID: generation.TenantID, WorkspaceID: generation.WorkspaceID,
		ProjectID: generation.ProjectID, CreatedBy: generation.CreatedBy,
		SourceArtifactID:              generation.SourceArtifactID,
		SourceArtifactNamespace:       generation.SourceArtifactNamespace,
		FirstFrameCheckpointID:        generation.FirstFrameCheckpointID,
		LastFrameCheckpointID:         generation.LastFrameCheckpointID,
		FirstFrameCheckpointSizeBytes: generation.FirstFrameCheckpointSizeBytes,
		LastFrameCheckpointSizeBytes:  generation.LastFrameCheckpointSizeBytes,
	}, nil
}

func (s *Service) RecordCheckpoint(ctx context.Context, taskRunID string, checkpoint Result) error {
	if !validCheckpoint(checkpoint) {
		return errors.New("at least one frame artifact ID is required")
	}
	now := s.clock.Now()
	return s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		run, err := s.tasks.GetTaskRun(txCtx, taskRunID)
		if err != nil {
			return err
		}
		if !isFirstLastFrameRun(run) {
			return ErrExecutionTerminal
		}
		if run.Status == domaintask.StatusSucceeded && isFirstLastFrameRun(run) {
			return nil
		}
		if run.Status != domaintask.StatusRunning {
			return ErrExecutionTerminal
		}
		generation, err := s.generations.GetByFirstLastFrameTaskRunID(txCtx, taskRunID)
		if err != nil {
			return err
		}
		recorded, err := s.generations.RecordArtifactCheckpoint(
			txCtx, generation.GenerationTaskRunID, taskRunID, checkpoint, now,
		)
		if err != nil {
			return err
		}
		if !recorded {
			return ErrLifecycleCASLost
		}
		return nil
	})
}

func (s *Service) CommitSuccess(ctx context.Context, taskRunID string, result Result) error {
	if strings.TrimSpace(result.FirstFrameArtifactID) == "" || result.FirstFrameSizeBytes <= 0 ||
		strings.TrimSpace(result.LastFrameArtifactID) == "" || result.LastFrameSizeBytes <= 0 {
		return errors.New("first and last frame artifact IDs are required")
	}
	if s.assets == nil {
		return errors.New("first last frame asset manager is not configured")
	}
	preflightRun, err := s.tasks.GetTaskRun(ctx, taskRunID)
	if err != nil {
		return err
	}
	if preflightRun.Status == domaintask.StatusSucceeded && isFirstLastFrameRun(preflightRun) {
		return nil
	}
	preflightGeneration, err := s.generations.GetByFirstLastFrameTaskRunID(ctx, taskRunID)
	if err != nil {
		return err
	}
	now := s.clock.Now()
	terminalOutcome := applicationtask.TerminalOutcome{}
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		scope := applicationasset.Scope{
			TenantID: preflightGeneration.TenantID, WorkspaceID: preflightGeneration.WorkspaceID,
			CallerID: preflightGeneration.CreatedBy,
		}
		if lockErr := s.assets.LockOwner(txCtx, scope, domainasset.OwnerProject, preflightGeneration.ProjectID); lockErr != nil {
			return lockErr
		}
		run, err := s.tasks.GetTaskRunForUpdate(txCtx, taskRunID)
		if err != nil {
			return err
		}
		if run.Status == domaintask.StatusSucceeded && isFirstLastFrameRun(run) {
			return nil
		}
		if run.Status != domaintask.StatusRunning || !isFirstLastFrameRun(run) {
			return ErrExecutionTerminal
		}
		generation, err := s.generations.GetByFirstLastFrameTaskRunIDForUpdate(txCtx, taskRunID)
		if err != nil {
			return err
		}
		if generation.ProjectID != preflightGeneration.ProjectID || generation.TenantID != preflightGeneration.TenantID ||
			!sameWorkspace(generation.WorkspaceID, preflightGeneration.WorkspaceID) {
			return ErrLifecycleCASLost
		}
		firstInput, err := frameAssetInput(scope, generation.ProjectID, "first.jpg", result.FirstFrameArtifactID, result.FirstFrameSizeBytes)
		if err != nil {
			return err
		}
		firstAsset, err := s.assets.CreateFromOwnedArtifact(txCtx, firstInput)
		if err != nil {
			return err
		}
		lastInput, err := frameAssetInput(scope, generation.ProjectID, "last.jpg", result.LastFrameArtifactID, result.LastFrameSizeBytes)
		if err != nil {
			return err
		}
		lastAsset, err := s.assets.CreateFromOwnedArtifact(txCtx, lastInput)
		if err != nil {
			return err
		}
		committed, err := s.generations.CommitAssets(
			txCtx, generation.GenerationTaskRunID, taskRunID, result,
			firstAsset.ID, lastAsset.ID, now,
		)
		if err != nil {
			return err
		}
		if !committed {
			return ErrLifecycleCASLost
		}
		finishedAt := now
		updated, err := s.tasks.UpdateTaskRun(txCtx, run, applicationtask.TaskRunUpdate{
			Status: domaintask.StatusSucceeded, FinishedAt: &finishedAt,
		}, now)
		if err != nil {
			return err
		}
		if !updated {
			return ErrLifecycleCASLost
		}
		if s.assetReferences != nil {
			referenceScope := applicationasset.ReferenceScope{TenantID: preflightGeneration.TenantID, WorkspaceID: preflightGeneration.WorkspaceID}
			if err = s.assetReferences.AcquireAssets(txCtx, applicationasset.AcquireAssetsInput{
				Scope:    referenceScope,
				Owner:    applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationFirstFrame, Key: preflightGeneration.GenerationTaskRunID},
				AssetIDs: []string{firstAsset.ID},
			}); err != nil {
				return err
			}
			if err = s.assetReferences.AcquireAssets(txCtx, applicationasset.AcquireAssetsInput{
				Scope:    referenceScope,
				Owner:    applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationLastFrame, Key: preflightGeneration.GenerationTaskRunID},
				AssetIDs: []string{lastAsset.ID},
			}); err != nil {
				return err
			}
		}
		terminalRun := run
		terminalRun.Status = domaintask.StatusSucceeded
		terminalRun.StateVersion++
		terminalRun.FinishedAt = &finishedAt
		terminalRun.UpdatedAt = now
		terminalOutcome, err = s.coordinateTerminal(txCtx, terminalRun, now)
		if err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.afterTerminalCommit(terminalOutcome)
	return nil
}

func frameAssetInput(scope applicationasset.Scope, projectID, fileName, artifactID string, sizeBytes int64) (applicationasset.CreateFromArtifactInput, error) {
	namespace, err := (artifactnamespace.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ProjectID: &projectID,
	}).Namespace()
	if err != nil {
		return applicationasset.CreateFromArtifactInput{}, err
	}
	return applicationasset.CreateFromArtifactInput{
		Scope: scope, OwnerType: domainasset.OwnerProject, OwnerID: projectID,
		ArtifactID: artifactID, ArtifactNamespace: namespace, FileName: fileName, MediaType: domainasset.MediaImage,
		ContentType: "image/jpeg", SizeBytes: sizeBytes,
	}, nil
}

func sameWorkspace(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func validCheckpoint(checkpoint Result) bool {
	firstPresent := strings.TrimSpace(checkpoint.FirstFrameArtifactID) != "" || checkpoint.FirstFrameSizeBytes != 0
	lastPresent := strings.TrimSpace(checkpoint.LastFrameArtifactID) != "" || checkpoint.LastFrameSizeBytes != 0
	firstValid := !firstPresent || strings.TrimSpace(checkpoint.FirstFrameArtifactID) != "" && checkpoint.FirstFrameSizeBytes > 0
	lastValid := !lastPresent || strings.TrimSpace(checkpoint.LastFrameArtifactID) != "" && checkpoint.LastFrameSizeBytes > 0
	return (firstPresent || lastPresent) && firstValid && lastValid
}

func (s *Service) CommitFailure(ctx context.Context, taskRunID string) error {
	now := s.clock.Now()
	terminalOutcome := applicationtask.TerminalOutcome{}
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		run, err := s.tasks.GetTaskRun(txCtx, taskRunID)
		if err != nil {
			return err
		}
		if run.Status == domaintask.StatusFailed {
			return nil
		}
		if (run.Status != domaintask.StatusQueued && run.Status != domaintask.StatusRunning) ||
			!isFirstLastFrameRun(run) {
			return ErrExecutionTerminal
		}
		finishedAt := now
		updated, err := s.tasks.UpdateTaskRun(txCtx, run, applicationtask.TaskRunUpdate{
			Status: domaintask.StatusFailed, ErrorCode: "FirstLastFrameExtractionFailed",
			ErrorMessage: "首尾帧提取失败", FinishedAt: &finishedAt,
		}, now)
		if err != nil {
			return err
		}
		if !updated {
			return ErrLifecycleCASLost
		}
		terminalRun := run
		terminalRun.Status = domaintask.StatusFailed
		terminalRun.StateVersion++
		terminalRun.FinishedAt = &finishedAt
		terminalRun.UpdatedAt = now
		terminalOutcome, err = s.coordinateTerminal(txCtx, terminalRun, now)
		return err
	})
	if err != nil {
		return err
	}
	s.afterTerminalCommit(terminalOutcome)
	return nil
}

func (s *Service) coordinateTerminal(ctx context.Context, run domaintask.TaskRun, now time.Time) (applicationtask.TerminalOutcome, error) {
	if run.ParentTaskID == nil {
		return applicationtask.TerminalOutcome{}, nil
	}
	if s.terminalCoordinator == nil {
		return applicationtask.TerminalOutcome{}, errors.New("task terminal coordinator is not configured")
	}
	return s.terminalCoordinator.OnTerminal(ctx, run, now)
}

func (s *Service) afterTerminalCommit(outcome applicationtask.TerminalOutcome) {
	if s.terminalCoordinator != nil && len(outcome.Parents) > 0 {
		s.terminalCoordinator.AfterCommit(outcome)
	}
}

func isFirstLastFrameRun(run domaintask.TaskRun) bool {
	return run.IsInternal && run.RunType == domaintask.RunTypeCanvasNodeVideoFirstLastFrameExtraction
}
