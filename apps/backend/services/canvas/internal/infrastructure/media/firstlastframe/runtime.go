package firstlastframe

import (
	"context"
	"errors"
	"io"
	"os"

	applicationfirstlastframe "github.com/example/monorepo/canvas/internal/application/firstlastframe"
	firstlastframecontract "github.com/example/monorepo/canvas/internal/contract/firstlastframe"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/assetclient"
	taskpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/task"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Runtime struct {
	service  *applicationfirstlastframe.Service
	runs     *taskpersistence.Repository
	tx       *persistencetransaction.Manager
	assets   *assetclient.Client
	clock    applicationfirstlastframe.Clock
	tempRoot string
}

type ExecutionResult struct {
	Status string `json:"status"`
}

func NewRuntime(
	service *applicationfirstlastframe.Service,
	runs *taskpersistence.Repository,
	tx *persistencetransaction.Manager,
	assets *assetclient.Client,
	clock applicationfirstlastframe.Clock,
	tempRoot string,
) *Runtime {
	return &Runtime{service: service, runs: runs, tx: tx, assets: assets, clock: clock, tempRoot: tempRoot}
}

func (runtime *Runtime) Execute(ctx context.Context, taskRunID string) (ExecutionResult, error) {
	if runtime.service == nil || runtime.runs == nil || runtime.tx == nil || runtime.assets == nil || runtime.clock == nil {
		return ExecutionResult{}, errors.New("first last frame runtime is not configured")
	}
	run, err := runtime.runs.GetTaskRun(ctx, taskRunID)
	if err != nil {
		return ExecutionResult{}, err
	}
	if run.RunType != domaintask.RunTypeCanvasNodeVideoFirstLastFrameExtraction || !run.IsInternal {
		return ExecutionResult{}, applicationfirstlastframe.ErrExecutionTerminal
	}
	if run.Status == domaintask.StatusSucceeded || run.Status == domaintask.StatusFailed || run.Status == domaintask.StatusCancelled {
		return ExecutionResult{Status: string(run.Status)}, nil
	}
	if run.Status == domaintask.StatusQueued {
		starter := applicationfirstlastframe.NewAsyncExecutionStarter(runtime.runs, runtime.tx)
		if err = starter.MarkStarted(ctx, run, domaintask.AsyncDispatch{}, runtime.clock.Now()); err != nil {
			return ExecutionResult{}, err
		}
	} else if run.Status != domaintask.StatusRunning {
		return ExecutionResult{}, applicationfirstlastframe.ErrExecutionTerminal
	}
	executor := NewExecutor(
		&executionControl{service: runtime.service},
		&artifactFiles{assets: runtime.assets},
		NewFFmpegExtractor(nil),
		runtime.tempRoot,
	)
	if err = executor.Execute(ctx, taskRunID); err != nil {
		return ExecutionResult{}, err
	}
	return ExecutionResult{Status: string(domaintask.StatusSucceeded)}, nil
}

type executionControl struct {
	service *applicationfirstlastframe.Service
}

func (control *executionControl) GetExecution(ctx context.Context, taskRunID string) (GetExecutionResponse, error) {
	execution, err := control.service.LoadExecution(ctx, taskRunID)
	switch {
	case errors.Is(err, applicationfirstlastframe.ErrExecutionNotReady):
		return GetExecutionResponse{State: StateRetry}, nil
	case errors.Is(err, applicationfirstlastframe.ErrExecutionSucceeded):
		return GetExecutionResponse{State: StateSucceeded}, nil
	case errors.Is(err, applicationfirstlastframe.ErrExecutionTerminal):
		return GetExecutionResponse{State: StateTerminal}, nil
	case err != nil:
		return GetExecutionResponse{}, err
	}
	return GetExecutionResponse{State: StateReady, Execution: &firstlastframecontract.Execution{
		TaskRunID: execution.TaskRunID, GenerationTaskRunID: execution.GenerationTaskRunID,
		TenantID: execution.TenantID, WorkspaceID: execution.WorkspaceID, ProjectID: execution.ProjectID,
		CreatedBy: execution.CreatedBy, SourceSourceAssetID: execution.SourceSourceAssetID,
		SourceSourceRevisionID:         execution.SourceSourceRevisionID,
		FirstFrameCheckpointAssetID:    execution.FirstFrameCheckpointAssetID,
		FirstFrameCheckpointRevisionID: execution.FirstFrameCheckpointRevisionID,
		LastFrameCheckpointAssetID:     execution.LastFrameCheckpointAssetID,
		LastFrameCheckpointRevisionID:  execution.LastFrameCheckpointRevisionID,
		FirstFrameCheckpointSizeBytes:  execution.FirstFrameCheckpointSizeBytes,
		LastFrameCheckpointSizeBytes:   execution.LastFrameCheckpointSizeBytes,
	}}, nil
}

func (control *executionControl) RecordCheckpoint(ctx context.Context, taskRunID string, result firstlastframecontract.Result) error {
	return control.service.RecordCheckpoint(ctx, taskRunID, applicationResult(result))
}

func (control *executionControl) CommitSuccess(ctx context.Context, taskRunID string, result firstlastframecontract.Result) error {
	return control.service.CommitSuccess(ctx, taskRunID, applicationResult(result))
}

func (control *executionControl) CommitFailure(ctx context.Context, taskRunID string) error {
	return control.service.CommitFailure(ctx, taskRunID)
}

func applicationResult(result firstlastframecontract.Result) applicationfirstlastframe.Result {
	return applicationfirstlastframe.Result{
		FirstFrameSourceAssetID: result.FirstFrameSourceAssetID, FirstFrameSourceRevisionID: result.FirstFrameSourceRevisionID,
		LastFrameSourceAssetID: result.LastFrameSourceAssetID, LastFrameSourceRevisionID: result.LastFrameSourceRevisionID,
		FirstFrameSizeBytes: result.FirstFrameSizeBytes, LastFrameSizeBytes: result.LastFrameSizeBytes,
	}
}

type artifactFiles struct {
	assets *assetclient.Client
}

func (files *artifactFiles) OpenArtifact(
	ctx context.Context,
	tenantID, _ string,
	sourceAssetID string,
	sourceRevisionID string,
) (io.ReadCloser, error) {
	return files.assets.Open(ctx, tenantID, "", assetclient.RevisionRef{AssetID: sourceAssetID, RevisionID: sourceRevisionID})
}

func (files *artifactFiles) SaveArtifact(
	ctx context.Context,
	tenantID string, workspaceID *string, userID string, filename string,
	path, idempotencyKey string,
) (SavedArtifact, error) {
	file, err := os.Open(path)
	if err != nil {
		return SavedArtifact{}, err
	}
	defer file.Close() //nolint:errcheck
	workspace := ""
	if workspaceID != nil {
		workspace = *workspaceID
	}
	stored, err := files.assets.Upload(ctx, assetclient.UploadInput{TenantID: tenantID, WorkspaceID: workspace, UserID: userID, Filename: filename, MediaType: "image/jpeg", Category: "generated_frame", IdempotencyKey: idempotencyKey, Body: file})
	if err != nil {
		return SavedArtifact{}, err
	}
	if !stored.Valid() || stored.SizeBytes <= 0 {
		return SavedArtifact{}, errors.New("save frame artifact returned an invalid result")
	}
	return SavedArtifact{SourceAssetID: stored.AssetID, SourceRevisionID: stored.RevisionID}, nil
}
