package canvasarchive

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	applicationquota "github.com/example/monorepo/canvas/internal/server/application/quota"
	applicationtask "github.com/example/monorepo/canvas/internal/server/application/task"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const initialStateVersion int64 = 1

const (
	archiveExportFailureCode    = "ARCHIVE_EXPORT_FAILED"
	archiveExportFailureMessage = "Canvas video archive export failed"
)

var (
	errReturnActiveExport = errors.New("return active canvas video archive export")
	errLifecycleCASLost   = errors.New("canvas video archive export lifecycle compare-and-swap lost")
)

type Service struct {
	repository     Repository
	snapshots      SelectedVideoSnapshotStore
	runs           TaskRunStore
	dispatches     AsyncDispatchStore
	transactions   TransactionManager
	ids            IDGenerator
	clock          Clock
	lifecycle      LifecycleStore
	cancelRuns     TaskRunCancellationStore
	deleteDispatch AsyncDispatchDeleteStore
	executions     ExecutionStore
	executionRuns  ExecutionTaskStore
	storageQuota   StorageQuota
	canvasAccess   CanvasAccessValidator
}

type Option func(*Service)

func WithStorageQuota(quota StorageQuota) Option {
	return func(service *Service) { service.storageQuota = quota }
}

func WithCanvasAccessValidator(validator CanvasAccessValidator) Option {
	return func(service *Service) { service.canvasAccess = validator }
}

func WithCancellation(runs TaskRunCancellationStore, dispatches AsyncDispatchDeleteStore) Option {
	return func(service *Service) {
		service.cancelRuns = runs
		service.deleteDispatch = dispatches
	}
}

type GetInput struct {
	Scope
	ProjectID, CanvasID, TaskRunID string
}

type BatchGetInput struct {
	Scope
	ProjectID, CanvasID string
	TaskRunIDs          []string
}

type ListInput struct {
	Scope
	ProjectID, CanvasID string
	SortDirection       SortDirection
	Page                Page
}

func NewService(
	repository Repository,
	snapshots SelectedVideoSnapshotStore,
	runs TaskRunStore,
	dispatches AsyncDispatchStore,
	transactions TransactionManager,
	ids IDGenerator,
	clock Clock,
	options ...Option,
) *Service {
	service := &Service{repository: repository, snapshots: snapshots, runs: runs, dispatches: dispatches, transactions: transactions, ids: ids, clock: clock}
	if lifecycle, ok := repository.(LifecycleStore); ok {
		service.lifecycle = lifecycle
	}
	if executions, ok := repository.(ExecutionStore); ok {
		service.executions = executions
	}
	if executionRuns, ok := runs.(ExecutionTaskStore); ok {
		service.executionRuns = executionRuns
	}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) Create(ctx context.Context, scope Scope, projectID, canvasID string) (Export, error) {
	if active, err := s.repository.FindActive(ctx, scope, projectID, canvasID); err == nil {
		return active, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Export{}, err
	}
	if s.storageQuota != nil {
		if err := s.storageQuota.CheckStorageAdmission(ctx, scope.TenantID); err != nil {
			return Export{}, classifyStorageQuotaError(err)
		}
	}
	taskRunID, err := s.ids.NewID()
	if err != nil {
		return Export{}, err
	}
	now := s.clock.Now()
	export := Export{
		TaskRunID: taskRunID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		ProjectID: projectID, CanvasID: canvasID, CreatedBy: scope.CallerID,
		Status:        domaintask.StatusQueued,
		CleanupStatus: CleanupStatusWaiting, CleanupStateVersion: initialStateVersion,
		CreatedAt: now, UpdatedAt: now,
	}
	run := domaintask.TaskRun{
		ID: taskRunID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		CreatedBy: scope.CallerID,
		RunType:   domaintask.RunTypeCanvasVideoArchiveExport, SubjectType: domaintask.SubjectTypeCanvas,
		SubjectID: canvasID, Status: domaintask.StatusQueued, StateVersion: initialStateVersion,
		CreatedAt: now, UpdatedAt: now,
	}
	dispatch := domaintask.AsyncDispatch{
		TaskRunID: taskRunID, RunType: domaintask.RunTypeCanvasVideoArchiveExport,
		DeliveryState: domaintask.AsyncDeliveryPending, ExecutionState: domaintask.AsyncExecutionWaiting,
		NextDispatchAt: now, DeliveryVersion: initialStateVersion, ExecutionVersion: initialStateVersion,
		CreatedAt: now, UpdatedAt: now,
	}

	var active Export
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		selected, snapshotErr := s.snapshots.SnapshotSelectedVideos(txCtx, scope, projectID, canvasID)
		if snapshotErr != nil {
			return snapshotErr
		}
		if len(selected) == 0 {
			return ErrNoSelectedVideos
		}
		export.OutputFilename = fmt.Sprintf("%s-%s.zip", archiveFilenameBase(selected[0].CanvasName, canvasID), now.UTC().Format("20060102"))
		if existing, activeErr := s.repository.FindActive(txCtx, scope, projectID, canvasID); activeErr == nil {
			active = existing
			return errReturnActiveExport
		} else if !errors.Is(activeErr, ErrNotFound) {
			return activeErr
		}
		inputs := make([]Input, 0, len(selected))
		for index := range selected {
			video := selected[index]
			if strings.TrimSpace(video.NodeID) == "" || strings.TrimSpace(video.OutputID) == "" || strings.TrimSpace(video.ArtifactID) == "" {
				return ErrSelectedVideoUnavailable
			}
			inputs = append(inputs, Input{
				TaskRunID: taskRunID, NodeID: video.NodeID, OutputID: video.OutputID,
				AssetID: video.AssetID, ArtifactID: video.ArtifactID, ArtifactNamespace: video.ArtifactNamespace,
				EntryName: fmt.Sprintf("S%03d.mp4", index+1), Ordinal: int32(index + 1), MediaSize: video.MediaSize, CreatedAt: now,
			})
		}
		export.InputCount = int32(len(inputs))
		if createErr := s.runs.Create(txCtx, run); createErr != nil {
			return createErr
		}
		if createErr := s.repository.Create(txCtx, export, inputs); createErr != nil {
			return createErr
		}
		return s.dispatches.CreateAsyncDispatch(txCtx, dispatch)
	})
	if errors.Is(err, errReturnActiveExport) {
		return active, nil
	}
	if err != nil {
		return Export{}, err
	}
	return export, nil
}

func archiveFilenameBase(name, canvasID string) string {
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r < 0x20, r == '/', r == '\\', r == ':', r == '*', r == '?', r == '"', r == '<', r == '>', r == '|':
			return '_'
		default:
			return r
		}
	}, strings.TrimSpace(name))
	cleaned = strings.Trim(strings.TrimSpace(cleaned), ".")
	if cleaned == "" {
		return canvasID
	}
	return cleaned
}

func (s *Service) Get(ctx context.Context, input GetInput) (Export, error) {
	if err := s.validateCanvasAccess(ctx, input.Scope, input.ProjectID, input.CanvasID); err != nil {
		return Export{}, err
	}
	return s.repository.Get(ctx, input.Scope, input.ProjectID, input.CanvasID, input.TaskRunID)
}

func (s *Service) BatchGet(ctx context.Context, input BatchGetInput) ([]Export, error) {
	if err := s.validateCanvasAccess(ctx, input.Scope, input.ProjectID, input.CanvasID); errors.Is(err, ErrNotFound) {
		return []Export{}, nil
	} else if err != nil {
		return nil, err
	}
	return s.repository.BatchGet(ctx, input.Scope, input.ProjectID, input.CanvasID, input.TaskRunIDs)
}

func (s *Service) List(ctx context.Context, input ListInput) ([]Export, int64, error) {
	if input.TenantID == "" || input.ProjectID == "" || input.CanvasID == "" ||
		input.Page.PageSize < 1 || input.Page.PageSize > 100 || input.Page.PageNum < 1 {
		return nil, 0, errno.New(errno.ErrInvalidArgument)
	}
	direction := input.SortDirection
	if direction == SortUnspecified {
		direction = SortDescending
	}
	if direction != SortAscending && direction != SortDescending {
		return nil, 0, errno.New(errno.ErrInvalidArgument)
	}
	if err := s.validateCanvasAccess(ctx, input.Scope, input.ProjectID, input.CanvasID); err != nil {
		return nil, 0, err
	}
	return s.repository.List(ctx, ListQuery{
		Scope: input.Scope, ProjectID: input.ProjectID, CanvasID: input.CanvasID,
		SortDirection: direction, PageSize: input.Page.PageSize, PageNum: input.Page.PageNum,
	})
}

func (s *Service) validateCanvasAccess(ctx context.Context, scope Scope, projectID, canvasID string) error {
	if s.canvasAccess == nil {
		return nil
	}
	return s.canvasAccess.Validate(ctx, scope, projectID, canvasID)
}

func (s *Service) LoadExecution(ctx context.Context, taskRunID string) (Execution, error) {
	if s.executions == nil || s.executionRuns == nil {
		return Execution{}, errors.New("canvas video archive execution is not configured")
	}
	run, err := s.executionRuns.GetTaskRun(ctx, taskRunID)
	if err != nil {
		return Execution{}, err
	}
	item, err := s.executions.GetByTaskRunID(ctx, taskRunID)
	if err != nil {
		return Execution{}, err
	}
	if run.RunType != domaintask.RunTypeCanvasVideoArchiveExport || run.SubjectType != domaintask.SubjectTypeCanvas || item.Status != run.Status || run.Status == domaintask.StatusQueued {
		return Execution{Export: item}, ErrExecutionNotReady
	}
	if run.Terminal() {
		return Execution{Export: item}, ErrExecutionTerminal
	}
	inputs, err := s.executions.ListInputs(ctx, taskRunID)
	if err != nil {
		return Execution{}, err
	}
	if int32(len(inputs)) != item.InputCount {
		return Execution{}, ErrSelectedVideoUnavailable
	}
	return Execution{Export: item, Inputs: inputs}, nil
}

func (s *Service) CommitSuccess(ctx context.Context, taskRunID string, result SuccessResult) error {
	if s.executions == nil || s.executionRuns == nil || result.Path == "" || result.SHA256 == "" || result.Size <= 0 || result.RetentionStartedAt.IsZero() {
		return errors.New("invalid canvas video archive success result")
	}
	run, err := s.executionRuns.GetTaskRun(ctx, taskRunID)
	if err != nil {
		return err
	}
	item, err := s.executions.GetByTaskRunID(ctx, taskRunID)
	if err != nil {
		return err
	}
	if run.RunType != domaintask.RunTypeCanvasVideoArchiveExport || run.SubjectType != domaintask.SubjectTypeCanvas {
		return ErrExecutionTerminal
	}
	if run.Status == domaintask.StatusSucceeded && item.Status == domaintask.StatusSucceeded && item.OutputPath == result.Path && item.OutputSHA256 == result.SHA256 {
		return nil
	}
	if run.Status != domaintask.StatusRunning || item.Status != domaintask.StatusRunning {
		return ErrExecutionTerminal
	}
	if item.OutputPath == "" || item.RetentionStartedAt == nil || item.OutputPath != result.Path ||
		item.OutputSHA256 != result.SHA256 || item.OutputSize != result.Size {
		return errors.New("canvas video archive success does not match persisted output checkpoint")
	}
	// Retention starts at the first checkpoint, never at a later retry supplied
	// by a Worker. Persisted upload facts are authoritative for the same reason.
	result.RetentionStartedAt = *item.RetentionStartedAt
	result.UploadID = item.UploadID
	result.PartSize = item.PartSize
	now := s.clock.Now()
	retentionUntil := result.RetentionStartedAt.Add(7 * 24 * time.Hour)
	finishedAt := now
	return s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		detailUpdated, updateErr := s.executions.CommitSuccess(txCtx, taskRunID, domaintask.StatusRunning, result, retentionUntil, now)
		if updateErr != nil {
			return updateErr
		}
		if !detailUpdated {
			return errLifecycleCASLost
		}
		runUpdated, updateErr := s.executionRuns.UpdateTaskRun(txCtx, run, applicationtask.TaskRunUpdate{Status: domaintask.StatusSucceeded, FinishedAt: &finishedAt}, now)
		if updateErr != nil {
			return updateErr
		}
		if !runUpdated {
			return errLifecycleCASLost
		}
		if s.storageQuota != nil {
			if updateErr = s.storageQuota.RecordAdmittedStorage(
				txCtx, archiveStorageObject(item, result),
			); updateErr != nil {
				return classifyStorageQuotaError(updateErr)
			}
		}
		return nil
	})
}

func (s *Service) RecordOutput(ctx context.Context, taskRunID string, result SuccessResult) error {
	if s.executions == nil || s.executionRuns == nil || result.Path == "" || result.SHA256 == "" || result.Size <= 0 || result.RetentionStartedAt.IsZero() {
		return errors.New("invalid canvas video archive output checkpoint")
	}
	run, err := s.executionRuns.GetTaskRun(ctx, taskRunID)
	if err != nil {
		return err
	}
	item, err := s.executions.GetByTaskRunID(ctx, taskRunID)
	if err != nil {
		return err
	}
	if run.RunType != domaintask.RunTypeCanvasVideoArchiveExport || run.SubjectType != domaintask.SubjectTypeCanvas ||
		run.Status != domaintask.StatusRunning || item.Status != domaintask.StatusRunning {
		return ErrExecutionTerminal
	}
	if item.OutputPath != "" {
		if item.OutputPath == result.Path && item.OutputSHA256 == result.SHA256 && item.OutputSize == result.Size {
			return nil
		}
		return errors.New("canvas video archive output checkpoint conflicts with persisted output")
	}
	return s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		updated, updateErr := s.executions.RecordOutput(
			txCtx, taskRunID, domaintask.StatusRunning, result, s.clock.Now(),
		)
		if updateErr != nil {
			return updateErr
		}
		if updated {
			return nil
		}
		current, readErr := s.executions.GetByTaskRunID(txCtx, taskRunID)
		if readErr == nil && current.Status == domaintask.StatusRunning &&
			current.OutputPath == result.Path && current.OutputSHA256 == result.SHA256 &&
			current.OutputSize == result.Size {
			return nil
		}
		return errLifecycleCASLost
	})
}

func (s *Service) CommitFailure(ctx context.Context, taskRunID string) error {
	if s.lifecycle == nil || s.executionRuns == nil {
		return errors.New("canvas video archive failure convergence is not configured")
	}
	run, err := s.executionRuns.GetTaskRun(ctx, taskRunID)
	if err != nil {
		return err
	}
	if run.RunType != domaintask.RunTypeCanvasVideoArchiveExport || run.SubjectType != domaintask.SubjectTypeCanvas {
		return ErrExecutionTerminal
	}
	if run.Terminal() {
		return nil
	}
	if run.Status != domaintask.StatusQueued && run.Status != domaintask.StatusRunning {
		return ErrExecutionNotReady
	}
	now := s.clock.Now()
	finishedAt := now
	update := LifecycleUpdate{
		Status: domaintask.StatusFailed, ErrorCode: archiveExportFailureCode,
		ErrorMessage: archiveExportFailureMessage, FinishedAt: &finishedAt,
	}
	return s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		detailUpdated, updateErr := s.lifecycle.UpdateLifecycle(txCtx, taskRunID, run.Status, update, now)
		if updateErr != nil {
			return updateErr
		}
		if !detailUpdated {
			return errLifecycleCASLost
		}
		runUpdated, updateErr := s.executionRuns.UpdateTaskRun(txCtx, run, applicationtask.TaskRunUpdate{
			Status: domaintask.StatusFailed, ErrorCode: archiveExportFailureCode,
			ErrorMessage: archiveExportFailureMessage, FinishedAt: &finishedAt,
		}, now)
		if updateErr != nil {
			return updateErr
		}
		if !runUpdated {
			return errLifecycleCASLost
		}
		return nil
	})
}

func (s *Service) Cancel(ctx context.Context, input GetInput) error {
	if s.lifecycle == nil || s.cancelRuns == nil || s.deleteDispatch == nil {
		return errors.New("canvas video archive cancellation is not configured")
	}
	if _, err := s.repository.Get(ctx, input.Scope, input.ProjectID, input.CanvasID, input.TaskRunID); err != nil {
		return err
	}
	// The scoped export read above establishes ownership. Cancellation must also
	// reach hidden runs after their parent was deleted.
	run, err := s.cancelRuns.GetTaskRun(ctx, input.TaskRunID)
	if err != nil {
		return err
	}
	if run.Terminal() {
		return nil
	}
	now := s.clock.Now()
	finishedAt := now
	update := applicationtask.TaskRunUpdate{Status: domaintask.StatusCancelled, FinishedAt: &finishedAt}
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		detailUpdated, updateErr := s.lifecycle.UpdateLifecycle(txCtx, run.ID, run.Status, LifecycleUpdate{Status: domaintask.StatusCancelled, FinishedAt: &finishedAt}, now)
		if updateErr != nil {
			return updateErr
		}
		if !detailUpdated {
			return errLifecycleCASLost
		}
		runUpdated, updateErr := s.cancelRuns.UpdateTaskRun(txCtx, run, update, now)
		if updateErr != nil {
			return updateErr
		}
		if !runUpdated {
			return errLifecycleCASLost
		}
		if updateErr := s.deleteDispatch.DeleteAsyncDispatch(txCtx, run.ID); updateErr != nil {
			return updateErr
		}
		return nil
	})
	return err
}

func archiveStorageObject(item Export, result SuccessResult) applicationquota.StorageObject {
	return applicationquota.StorageObject{
		TenantID: item.TenantID, WorkspaceID: item.WorkspaceID,
		ObjectType: "archive_path", ObjectKey: result.Path,
		Category: "archive_export", OwnerType: "canvas_archive", OwnerID: item.TaskRunID,
		SizeBytes: result.Size, BillingClass: applicationquota.BillingBillable,
	}
}

func classifyStorageQuotaError(err error) error {
	switch {
	case errors.Is(err, applicationquota.ErrExceeded):
		return errno.Wrap(errno.ErrStorageQuotaExceeded, err)
	case errors.Is(err, applicationquota.ErrUnavailable):
		return errno.Wrap(errno.ErrQuotaUnavailable, err)
	default:
		return err
	}
}
