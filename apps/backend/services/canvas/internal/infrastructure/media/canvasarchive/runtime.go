package canvasarchive

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	applicationcanvasarchive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/artifact"
	canvasarchivepersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvasarchive"
	taskpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/task"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	artifactnamespace "github.com/example/monorepo/canvas/internal/infrastructure/storage/namespace"
)

type Runtime struct {
	service  *applicationcanvasarchive.Service
	repo     *canvasarchivepersistence.Repository
	runs     *taskpersistence.Repository
	tx       *persistencetransaction.Manager
	storage  *storage.Client
	clock    applicationcanvasarchive.Clock
	tempRoot string
}

func NewRuntime(
	service *applicationcanvasarchive.Service,
	repo *canvasarchivepersistence.Repository,
	runs *taskpersistence.Repository,
	tx *persistencetransaction.Manager,
	storageClient *storage.Client,
	clock applicationcanvasarchive.Clock,
	tempRoot string,
) *Runtime {
	return &Runtime{service: service, repo: repo, runs: runs, tx: tx, storage: storageClient, clock: clock, tempRoot: tempRoot}
}

func (runtime *Runtime) Execute(ctx context.Context, taskRunID string) (applicationcanvasarchive.Export, error) {
	item, err := runtime.repo.GetByTaskRunID(ctx, taskRunID)
	if err != nil {
		return applicationcanvasarchive.Export{}, err
	}
	if item.Status == domaintask.StatusSucceeded {
		return item, nil
	}
	if item.Status == domaintask.StatusQueued {
		run, readErr := runtime.runs.GetTaskRun(ctx, taskRunID)
		if readErr != nil {
			return applicationcanvasarchive.Export{}, readErr
		}
		if err = applicationcanvasarchive.NewAsyncExecutionStarter(runtime.repo, runtime.runs, runtime.tx).MarkStarted(
			ctx, run, domaintask.AsyncDispatch{}, runtime.clock.Now(),
		); err != nil {
			return applicationcanvasarchive.Export{}, err
		}
	}
	execution, err := runtime.service.LoadExecution(ctx, taskRunID)
	if err != nil {
		return applicationcanvasarchive.Export{}, err
	}
	result := applicationcanvasarchive.SuccessResult{
		Path: execution.Export.OutputPath, SHA256: execution.Export.OutputSHA256, Size: execution.Export.OutputSize,
		UploadID: execution.Export.UploadID, PartSize: execution.Export.PartSize,
	}
	if execution.Export.RetentionStartedAt != nil {
		result.RetentionStartedAt = *execution.Export.RetentionStartedAt
	}
	if result.Path == "" {
		result, err = runtime.build(ctx, execution)
		if err != nil {
			return applicationcanvasarchive.Export{}, err
		}
		if err = runtime.service.RecordOutput(ctx, taskRunID, result); err != nil {
			return applicationcanvasarchive.Export{}, err
		}
	}
	if err = ctx.Err(); err != nil {
		return applicationcanvasarchive.Export{}, err
	}
	if err = runtime.service.CommitSuccess(ctx, taskRunID, result); err != nil {
		return applicationcanvasarchive.Export{}, err
	}
	return runtime.repo.GetByTaskRunID(ctx, taskRunID)
}

func (runtime *Runtime) build(ctx context.Context, execution applicationcanvasarchive.Execution) (applicationcanvasarchive.SuccessResult, error) {
	directory, err := os.MkdirTemp(runtime.tempRoot, "canvas-archive-")
	if err != nil {
		return applicationcanvasarchive.SuccessResult{}, err
	}
	defer os.RemoveAll(directory)
	inputs := make([]Input, 0, len(execution.Inputs))
	for index := range execution.Inputs {
		input := execution.Inputs[index]
		inputs = append(inputs, Input{
			EntryName: input.EntryName, ArtifactID: input.ArtifactID, ExpectedSize: input.MediaSize,
			Open: func(openCtx context.Context) (io.ReadCloser, error) {
				return runtime.storage.Get(openCtx, artifact.KnowledgeNamespace(input.ArtifactNamespace), input.ArtifactID)
			},
		})
	}
	archive, err := NewBuilder(NewFFprobeProber(nil)).Build(
		ctx, filepath.Join(directory, "archive.zip"), execution.Export.CreatedAt,
		strings.TrimSuffix(execution.Export.OutputFilename, ".zip")+".fcpxml", inputs,
	)
	if err != nil {
		return applicationcanvasarchive.SuccessResult{}, err
	}
	file, err := os.Open(archive.Path)
	if err != nil {
		return applicationcanvasarchive.SuccessResult{}, err
	}
	defer file.Close()
	logicalNamespace, err := (artifactnamespace.Scope{
		TenantID: execution.Export.TenantID, WorkspaceID: execution.Export.WorkspaceID, ProjectID: &execution.Export.ProjectID,
	}).Namespace()
	if err != nil {
		return applicationcanvasarchive.SuccessResult{}, err
	}
	stored, err := runtime.storage.PutObject(ctx, artifact.KnowledgeNamespace(logicalNamespace), file)
	if err != nil {
		return applicationcanvasarchive.SuccessResult{}, err
	}
	if stored.Size != archive.Size || stored.SHA256 != "" && stored.SHA256 != archive.SHA256 {
		return applicationcanvasarchive.SuccessResult{}, errors.New("Knowledge archive upload checksum mismatch")
	}
	return applicationcanvasarchive.SuccessResult{
		Path: stored.ArtifactID, SHA256: archive.SHA256, Size: archive.Size, RetentionStartedAt: runtime.clock.Now(),
	}, nil
}

func (runtime *Runtime) Open(ctx context.Context, item applicationcanvasarchive.Export) (io.ReadCloser, error) {
	logicalNamespace, err := (artifactnamespace.Scope{
		TenantID: item.TenantID, WorkspaceID: item.WorkspaceID, ProjectID: &item.ProjectID,
	}).Namespace()
	if err != nil {
		return nil, err
	}
	return runtime.storage.Get(ctx, artifact.KnowledgeNamespace(logicalNamespace), item.OutputPath)
}
