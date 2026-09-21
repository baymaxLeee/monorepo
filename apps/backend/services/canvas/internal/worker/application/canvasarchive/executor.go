package canvasarchive

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	archivecontract "github.com/example/monorepo/canvas/internal/contract/canvasarchive"
	"github.com/example/monorepo/canvas/internal/worker/application/executiondiagnostic"
)

var (
	ErrExecutionNotReady   = errors.New("canvas video archive execution is not ready")
	ErrExecutionTerminal   = errors.New("canvas video archive execution is terminal")
	ErrArtifactUnavailable = errors.New("canvas video archive input artifact is unavailable")
)

type ExecutionControl interface {
	GetExecution(context.Context, string) (archivecontract.GetExecutionResponse, error)
	RecordOutput(context.Context, string, archivecontract.Output) error
	CommitSuccess(context.Context, string, archivecontract.Output) error
	CommitFailure(context.Context, string) error
}

type FileStore interface {
	OpenArtifact(context.Context, string, string, string, string) (io.ReadCloser, error)
	Multipart(string, string) MultipartClient
}

type WorkerClock interface{ Now() time.Time }

type Executor struct {
	control  ExecutionControl
	files    FileStore
	clock    WorkerClock
	tempRoot string
	builder  Builder
}

func NewExecutor(control ExecutionControl, files FileStore, prober MediaProber, clock WorkerClock, tempRoot string) *Executor {
	return &Executor{control: control, files: files, clock: clock, tempRoot: tempRoot, builder: NewBuilder(prober)}
}

func (executor *Executor) Execute(ctx context.Context, taskRunID string) error {
	response, err := executor.control.GetExecution(ctx, taskRunID)
	if err != nil {
		return executiondiagnostic.Wrap("load_execution", err)
	}
	switch response.State {
	case archivecontract.StateSucceeded:
		return nil
	case archivecontract.StateRetry:
		return ErrExecutionNotReady
	case archivecontract.StateTerminal:
		return ErrExecutionTerminal
	case archivecontract.StateReady:
	default:
		return fmt.Errorf("unknown canvas video archive execution state %q", response.State)
	}
	if response.Execution == nil || response.Execution.TaskRunID != taskRunID || len(response.Execution.Inputs) == 0 {
		return errors.New("canvas video archive execution payload is incomplete")
	}
	execution := response.Execution
	multipart := executor.files.Multipart(execution.TenantID, execution.CreatedBy)
	if execution.Output != nil {
		return executor.retainAndCommit(ctx, execution.TaskRunID, multipart, *execution.Output)
	}

	tempDir, err := os.MkdirTemp(executor.tempRoot, "agentframe-canvas-archive-")
	if err != nil {
		return executiondiagnostic.Wrap("prepare_workspace", fmt.Errorf("create canvas video archive temporary directory: %w", err))
	}
	defer os.RemoveAll(tempDir) //nolint:errcheck
	archivePath := filepath.Join(tempDir, "archive.zip")
	inputs := make([]Input, 0, len(execution.Inputs))
	for index := range execution.Inputs {
		input := execution.Inputs[index]
		artifactID := input.ArtifactID
		artifactNamespace := input.ArtifactNamespace
		inputs = append(inputs, Input{
			EntryName: input.EntryName, ArtifactID: artifactID, ExpectedSize: input.MediaSize,
			Open: func(openCtx context.Context) (io.ReadCloser, error) {
				return executor.files.OpenArtifact(openCtx, execution.TenantID, execution.CreatedBy, artifactID, artifactNamespace)
			},
		})
	}
	fcpxmlName := strings.TrimSuffix(execution.OutputFilename, ".zip") + ".fcpxml"
	archive, err := executor.builder.Build(ctx, archivePath, execution.SnapshotAt, fcpxmlName, inputs)
	if err != nil {
		return executiondiagnostic.Wrap("build_archive", fmt.Errorf("build canvas video archive: %w", err))
	}
	filename := execution.OutputFilename
	if filename == "" {
		filename = "canvas-videos.zip"
	}
	upload, err := NewMultipartUploader(multipart, DefaultMultipartPartSize).Upload(ctx, UploadFile{
		Path: archive.Path, Filename: filename, SHA256: archive.SHA256, Size: archive.Size,
	})
	if err != nil {
		return executiondiagnostic.Wrap("upload_output", fmt.Errorf("upload canvas video archive: %w", err))
	}
	output := archivecontract.Output{
		Path: upload.Path, SHA256: archive.SHA256, UploadID: upload.UploadID,
		Size: archive.Size, PartSize: upload.PartSize, RetentionStartedAt: executor.clock.Now(),
	}
	if err = executor.control.RecordOutput(ctx, taskRunID, output); err != nil {
		return executiondiagnostic.Wrap("record_checkpoint", fmt.Errorf("checkpoint canvas video archive output: %w", err))
	}
	return executor.retainAndCommit(ctx, taskRunID, multipart, output)
}

func (executor *Executor) retainAndCommit(
	ctx context.Context,
	taskRunID string,
	multipart MultipartClient,
	output archivecontract.Output,
) error {
	if err := multipart.LongLive(ctx, output.Path, taskRunID); err != nil {
		return executiondiagnostic.Wrap("retain_output", err)
	}
	if err := executor.control.CommitSuccess(ctx, taskRunID, output); err != nil {
		return executiondiagnostic.Wrap("commit_success", fmt.Errorf("commit canvas video archive success: %w", err))
	}
	return nil
}

func (executor *Executor) ConvergeFailure(ctx context.Context, taskRunID string) error {
	return executiondiagnostic.Wrap("commit_failure", executor.control.CommitFailure(ctx, taskRunID))
}
