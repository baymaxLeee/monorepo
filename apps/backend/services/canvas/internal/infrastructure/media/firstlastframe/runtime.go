package firstlastframe

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"

	applicationfirstlastframe "github.com/example/monorepo/canvas/internal/application/firstlastframe"
	firstlastframecontract "github.com/example/monorepo/canvas/internal/contract/firstlastframe"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/artifact"
	taskpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/task"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
)

type Runtime struct {
	service  *applicationfirstlastframe.Service
	runs     *taskpersistence.Repository
	tx       *persistencetransaction.Manager
	storage  *storage.Client
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
	storageClient *storage.Client,
	clock applicationfirstlastframe.Clock,
	tempRoot string,
) *Runtime {
	return &Runtime{service: service, runs: runs, tx: tx, storage: storageClient, clock: clock, tempRoot: tempRoot}
}

func (runtime *Runtime) Execute(ctx context.Context, taskRunID string) (ExecutionResult, error) {
	if runtime.service == nil || runtime.runs == nil || runtime.tx == nil || runtime.storage == nil || runtime.clock == nil {
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
		&artifactFiles{storage: runtime.storage},
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
		CreatedBy: execution.CreatedBy, SourceArtifactID: execution.SourceArtifactID,
		SourceArtifactNamespace: execution.SourceArtifactNamespace,
		FirstFrameCheckpointID:  execution.FirstFrameCheckpointID, LastFrameCheckpointID: execution.LastFrameCheckpointID,
		FirstFrameCheckpointSizeBytes: execution.FirstFrameCheckpointSizeBytes,
		LastFrameCheckpointSizeBytes:  execution.LastFrameCheckpointSizeBytes,
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
		FirstFrameArtifactID: result.FirstFrameArtifactID, LastFrameArtifactID: result.LastFrameArtifactID,
		FirstFrameSizeBytes: result.FirstFrameSizeBytes, LastFrameSizeBytes: result.LastFrameSizeBytes,
	}
}

type artifactFiles struct {
	storage *storage.Client
}

func (files *artifactFiles) OpenArtifact(
	ctx context.Context,
	_, _ string,
	artifactID string,
	artifactNamespace string,
) (io.ReadCloser, error) {
	return files.storage.Get(ctx, artifact.KnowledgeNamespace(artifactNamespace), artifactID)
}

func (files *artifactFiles) SaveArtifact(
	ctx context.Context,
	_, _ string,
	artifactNamespace string,
	_ string,
	path string,
) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close() //nolint:errcheck
	stored, err := files.storage.PutObject(ctx, artifact.KnowledgeNamespace(strings.TrimSpace(artifactNamespace)), file)
	if err != nil {
		return "", err
	}
	if stored.ArtifactID == "" || stored.Size <= 0 {
		return "", errors.New("save frame artifact returned an invalid result")
	}
	return stored.ArtifactID, nil
}
