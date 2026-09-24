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
	"github.com/example/monorepo/canvas/internal/infrastructure/assetclient"
	canvasarchivepersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvasarchive"
	taskpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/task"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Runtime struct {
	service  *applicationcanvasarchive.Service
	repo     *canvasarchivepersistence.Repository
	runs     *taskpersistence.Repository
	tx       *persistencetransaction.Manager
	assets   *assetclient.Client
	clock    applicationcanvasarchive.Clock
	tempRoot string
}

func NewRuntime(service *applicationcanvasarchive.Service, repo *canvasarchivepersistence.Repository, runs *taskpersistence.Repository, tx *persistencetransaction.Manager, assets *assetclient.Client, clock applicationcanvasarchive.Clock, tempRoot string) *Runtime {
	return &Runtime{service: service, repo: repo, runs: runs, tx: tx, assets: assets, clock: clock, tempRoot: tempRoot}
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
		if err = applicationcanvasarchive.NewAsyncExecutionStarter(runtime.repo, runtime.runs, runtime.tx).MarkStarted(ctx, run, domaintask.AsyncDispatch{}, runtime.clock.Now()); err != nil {
			return applicationcanvasarchive.Export{}, err
		}
	}
	execution, err := runtime.service.LoadExecution(ctx, taskRunID)
	if err != nil {
		return applicationcanvasarchive.Export{}, err
	}
	result := applicationcanvasarchive.SuccessResult{AssetID: execution.Export.OutputAssetID, RevisionID: execution.Export.OutputRevisionID, SHA256: execution.Export.OutputSHA256, Size: execution.Export.OutputSize}
	if execution.Export.RetentionStartedAt != nil {
		result.RetentionStartedAt = *execution.Export.RetentionStartedAt
	}
	if result.AssetID == "" || result.RevisionID == "" {
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
	defer os.RemoveAll(directory) //nolint:errcheck
	inputs := make([]Input, 0, len(execution.Inputs))
	for index := range execution.Inputs {
		input := execution.Inputs[index]
		inputs = append(inputs, Input{EntryName: input.EntryName, SourceAssetID: input.SourceAssetID, ExpectedSize: input.MediaSize, Open: func(openCtx context.Context) (io.ReadCloser, error) {
			return runtime.assets.Open(openCtx, execution.Export.TenantID, workspaceValue(execution.Export.WorkspaceID), assetclient.RevisionRef{AssetID: input.SourceAssetID, RevisionID: input.SourceRevisionID})
		}})
	}
	archive, err := NewBuilder(NewFFprobeProber(nil)).Build(ctx, filepath.Join(directory, "archive.zip"), execution.Export.CreatedAt, strings.TrimSuffix(execution.Export.OutputFilename, ".zip")+".fcpxml", inputs)
	if err != nil {
		return applicationcanvasarchive.SuccessResult{}, err
	}
	file, err := os.Open(archive.Path)
	if err != nil {
		return applicationcanvasarchive.SuccessResult{}, err
	}
	defer file.Close() //nolint:errcheck
	revision, err := runtime.assets.Upload(ctx, assetclient.UploadInput{TenantID: execution.Export.TenantID, WorkspaceID: workspaceValue(execution.Export.WorkspaceID), UserID: execution.Export.CreatedBy, Filename: execution.Export.OutputFilename, MediaType: "application/zip", Category: "canvas_archive", IdempotencyKey: "canvas-archive:" + execution.Export.TaskRunID, Body: file})
	if err != nil {
		return applicationcanvasarchive.SuccessResult{}, err
	}
	if revision.SizeBytes != archive.Size || !strings.EqualFold(revision.SHA256, archive.SHA256) {
		return applicationcanvasarchive.SuccessResult{}, errors.New("asset archive upload checksum mismatch")
	}
	retentionStartedAt := runtime.clock.Now()
	return applicationcanvasarchive.SuccessResult{AssetID: revision.AssetID, RevisionID: revision.RevisionID, SHA256: archive.SHA256, Size: archive.Size, RetentionStartedAt: retentionStartedAt}, nil
}

func (runtime *Runtime) Open(ctx context.Context, item applicationcanvasarchive.Export) (io.ReadCloser, error) {
	return runtime.assets.Open(ctx, item.TenantID, workspaceValue(item.WorkspaceID), assetclient.RevisionRef{AssetID: item.OutputAssetID, RevisionID: item.OutputRevisionID})
}

func workspaceValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
