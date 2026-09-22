package firstlastframe

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	firstlastframecontract "github.com/example/monorepo/canvas/internal/contract/firstlastframe"
	"github.com/example/monorepo/canvas/internal/infrastructure/media/executiondiagnostic"
	artifactnamespace "github.com/example/monorepo/canvas/internal/infrastructure/storage/namespace"
)

const (
	StateReady     = "READY"
	StateRetry     = "RETRY"
	StateSucceeded = "SUCCEEDED"
	StateTerminal  = "TERMINAL"
)

var (
	ErrExecutionNotReady = errors.New("first last frame execution is not ready")
	ErrExecutionTerminal = errors.New("first last frame execution is terminal")
)

type GetExecutionResponse struct {
	State     string
	Execution *firstlastframecontract.Execution
}

type ExecutionControl interface {
	GetExecution(context.Context, string) (GetExecutionResponse, error)
	RecordCheckpoint(context.Context, string, firstlastframecontract.Result) error
	CommitSuccess(context.Context, string, firstlastframecontract.Result) error
	CommitFailure(context.Context, string) error
}

type FileStore interface {
	OpenArtifact(context.Context, string, string, string, string) (io.ReadCloser, error)
	SaveArtifact(context.Context, string, string, string, string, string) (string, error)
}

type Extractor interface {
	Extract(context.Context, string, string, string) error
}

type Executor struct {
	control   ExecutionControl
	files     FileStore
	extractor Extractor
	tempRoot  string
}

func NewExecutor(control ExecutionControl, files FileStore, extractor Extractor, tempRoot string) *Executor {
	return &Executor{control: control, files: files, extractor: extractor, tempRoot: tempRoot}
}

func (executor *Executor) Execute(ctx context.Context, taskRunID string) error {
	response, err := executor.control.GetExecution(ctx, taskRunID)
	if err != nil {
		return executiondiagnostic.Wrap("load_execution", err)
	}
	switch response.State {
	case StateSucceeded:
		return nil
	case StateRetry:
		return ErrExecutionNotReady
	case StateTerminal:
		return ErrExecutionTerminal
	case StateReady:
	default:
		return fmt.Errorf("unknown first last frame execution state %q", response.State)
	}
	if response.Execution == nil || response.Execution.TaskRunID != taskRunID || response.Execution.SourceArtifactID == "" {
		return errors.New("first last frame execution payload is incomplete")
	}
	execution := response.Execution
	firstID := execution.FirstFrameCheckpointID
	lastID := execution.LastFrameCheckpointID
	firstSize := execution.FirstFrameCheckpointSizeBytes
	lastSize := execution.LastFrameCheckpointSizeBytes
	if !validCheckpointPair(firstID, firstSize) || !validCheckpointPair(lastID, lastSize) {
		return errors.New("first last frame checkpoint is incomplete")
	}
	if firstID != "" && lastID != "" {
		return executiondiagnostic.Wrap("commit_success", executor.control.CommitSuccess(ctx, taskRunID, firstlastframecontract.Result{
			FirstFrameArtifactID: firstID, LastFrameArtifactID: lastID,
			FirstFrameSizeBytes: firstSize, LastFrameSizeBytes: lastSize,
		}))
	}
	tempDir, err := os.MkdirTemp(executor.tempRoot, "canvas-first-last-frame-")
	if err != nil {
		return executiondiagnostic.Wrap("prepare_workspace", fmt.Errorf("create first last frame temporary directory: %w", err))
	}
	defer os.RemoveAll(tempDir) //nolint:errcheck

	videoPath := filepath.Join(tempDir, "video")
	if err = executor.download(ctx, execution, videoPath); err != nil {
		return executiondiagnostic.Wrap("download_source", err)
	}
	firstPath := filepath.Join(tempDir, "first.jpg")
	lastPath := filepath.Join(tempDir, "last.jpg")
	if err = executor.extractor.Extract(ctx, videoPath, firstPath, lastPath); err != nil {
		return executiondiagnostic.Wrap("extract_frames", err)
	}
	namespace, err := (artifactnamespace.Scope{
		TenantID: execution.TenantID, WorkspaceID: execution.WorkspaceID, ProjectID: &execution.ProjectID,
	}).Namespace()
	if err != nil {
		return executiondiagnostic.Wrap("derive_namespace", err)
	}
	if firstID == "" {
		firstSize, err = fileSize(firstPath)
		if err != nil {
			return executiondiagnostic.Wrap("inspect_first_frame", err)
		}
		firstID, err = executor.files.SaveArtifact(ctx, execution.TenantID, execution.CreatedBy, namespace, "first.jpg", firstPath)
		if err != nil {
			return executiondiagnostic.Wrap("upload_first_frame", fmt.Errorf("save first frame artifact: %w", err))
		}
		firstID, firstSize, err = executor.recordCheckpoint(ctx, taskRunID, firstlastframecontract.Result{
			FirstFrameArtifactID: firstID, FirstFrameSizeBytes: firstSize,
		}, true)
		if err != nil {
			return executiondiagnostic.Wrap("record_first_checkpoint", fmt.Errorf("checkpoint first frame artifact: %w", err))
		}
	}
	if lastID == "" {
		lastSize, err = fileSize(lastPath)
		if err != nil {
			return executiondiagnostic.Wrap("inspect_last_frame", err)
		}
		lastID, err = executor.files.SaveArtifact(ctx, execution.TenantID, execution.CreatedBy, namespace, "last.jpg", lastPath)
		if err != nil {
			return executiondiagnostic.Wrap("upload_last_frame", fmt.Errorf("save last frame artifact: %w", err))
		}
		lastID, lastSize, err = executor.recordCheckpoint(ctx, taskRunID, firstlastframecontract.Result{
			LastFrameArtifactID: lastID, LastFrameSizeBytes: lastSize,
		}, false)
		if err != nil {
			return executiondiagnostic.Wrap("record_last_checkpoint", fmt.Errorf("checkpoint last frame artifact: %w", err))
		}
	}
	return executiondiagnostic.Wrap("commit_success", executor.control.CommitSuccess(ctx, taskRunID, firstlastframecontract.Result{
		FirstFrameArtifactID: firstID, LastFrameArtifactID: lastID,
		FirstFrameSizeBytes: firstSize, LastFrameSizeBytes: lastSize,
	}))
}

func validCheckpointPair(artifactID string, sizeBytes int64) bool {
	return artifactID == "" && sizeBytes == 0 || artifactID != "" && sizeBytes > 0
}

func (executor *Executor) recordCheckpoint(
	ctx context.Context,
	taskRunID string,
	checkpoint firstlastframecontract.Result,
	first bool,
) (string, int64, error) {
	candidate := checkpoint.LastFrameArtifactID
	size := checkpoint.LastFrameSizeBytes
	if first {
		candidate = checkpoint.FirstFrameArtifactID
		size = checkpoint.FirstFrameSizeBytes
	}
	if err := executor.control.RecordCheckpoint(ctx, taskRunID, checkpoint); err == nil {
		return candidate, size, nil
	} else {
		response, reloadErr := executor.control.GetExecution(ctx, taskRunID)
		if reloadErr != nil || response.State != StateReady || response.Execution == nil {
			return "", 0, err
		}
		canonical := response.Execution.LastFrameCheckpointID
		canonicalSize := response.Execution.LastFrameCheckpointSizeBytes
		if first {
			canonical = response.Execution.FirstFrameCheckpointID
			canonicalSize = response.Execution.FirstFrameCheckpointSizeBytes
		}
		if canonical == "" || canonicalSize <= 0 {
			return "", 0, err
		}
		return canonical, canonicalSize, nil
	}
}

func fileSize(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, fmt.Errorf("stat frame JPEG: %w", err)
	}
	if info.Size() <= 0 {
		return 0, errors.New("frame JPEG is empty")
	}
	return info.Size(), nil
}

func (executor *Executor) download(ctx context.Context, execution *firstlastframecontract.Execution, target string) error {
	reader, err := executor.files.OpenArtifact(
		ctx, execution.TenantID, execution.CreatedBy, execution.SourceArtifactID, execution.SourceArtifactNamespace,
	)
	if err != nil {
		return fmt.Errorf("open source video artifact: %w", err)
	}
	defer reader.Close() //nolint:errcheck
	file, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(file, reader)
	closeErr := file.Close()
	if copyErr != nil {
		return fmt.Errorf("download source video artifact: %w", copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close source video file: %w", closeErr)
	}
	return nil
}

func (executor *Executor) ConvergeFailure(ctx context.Context, taskRunID string) error {
	return executiondiagnostic.Wrap("commit_failure", executor.control.CommitFailure(ctx, taskRunID))
}
