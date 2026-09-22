package asyncexecution

import (
	"context"
	"encoding/json"
	"fmt"

	applicationcanvasarchive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	applicationfirstlastframe "github.com/example/monorepo/canvas/internal/application/firstlastframe"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	archivecontract "github.com/example/monorepo/canvas/internal/contract/canvasarchive"
	firstlastframecontract "github.com/example/monorepo/canvas/internal/contract/firstlastframe"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

type ArchiveService interface {
	RecordOutput(context.Context, string, applicationcanvasarchive.SuccessResult) error
	CommitSuccess(context.Context, string, applicationcanvasarchive.SuccessResult) error
	CommitFailure(context.Context, string) error
}

type FirstLastFrameService interface {
	RecordCheckpoint(context.Context, string, applicationfirstlastframe.Result) error
	CommitSuccess(context.Context, string, applicationfirstlastframe.Result) error
	CommitFailure(context.Context, string) error
}

type ArchiveProcessor struct {
	service ArchiveService
}

func NewArchiveProcessor(service ArchiveService) *ArchiveProcessor {
	return &ArchiveProcessor{service: service}
}

func (*ArchiveProcessor) RunType() string { return archivecontract.RunType }

func (processor *ArchiveProcessor) RecordCheckpoint(
	ctx context.Context,
	taskRunID string,
	payload json.RawMessage,
) error {
	result, err := decodeArchiveOutput(payload)
	if err != nil {
		return err
	}
	return processor.service.RecordOutput(ctx, taskRunID, result)
}

func (processor *ArchiveProcessor) CommitSuccess(
	ctx context.Context,
	taskRunID string,
	payload json.RawMessage,
) error {
	result, err := decodeArchiveOutput(payload)
	if err != nil {
		return err
	}
	return processor.service.CommitSuccess(ctx, taskRunID, result)
}

func (processor *ArchiveProcessor) CommitFailure(ctx context.Context, taskRunID string) error {
	return processor.service.CommitFailure(ctx, taskRunID)
}

func decodeArchiveOutput(payload json.RawMessage) (applicationcanvasarchive.SuccessResult, error) {
	var output archivecontract.Output
	if len(payload) == 0 || json.Unmarshal(payload, &output) != nil {
		return applicationcanvasarchive.SuccessResult{}, fmt.Errorf(
			"%w: decode archive result",
			applicationtask.ErrInvalidAsyncExecutionEventPayload,
		)
	}
	return applicationcanvasarchive.SuccessResult{
		Path: output.Path, SHA256: output.SHA256, UploadID: output.UploadID,
		Size: output.Size, PartSize: output.PartSize, RetentionStartedAt: output.RetentionStartedAt,
	}, nil
}

type FirstLastFrameProcessor struct {
	service FirstLastFrameService
}

func NewFirstLastFrameProcessor(service FirstLastFrameService) *FirstLastFrameProcessor {
	return &FirstLastFrameProcessor{service: service}
}

func (*FirstLastFrameProcessor) RunType() string {
	return string(domaintask.RunTypeCanvasNodeVideoFirstLastFrameExtraction)
}

func (processor *FirstLastFrameProcessor) RecordCheckpoint(
	ctx context.Context,
	taskRunID string,
	payload json.RawMessage,
) error {
	result, err := decodeFrameResult(payload)
	if err != nil {
		return err
	}
	return processor.service.RecordCheckpoint(ctx, taskRunID, result)
}

func (processor *FirstLastFrameProcessor) CommitSuccess(
	ctx context.Context,
	taskRunID string,
	payload json.RawMessage,
) error {
	result, err := decodeFrameResult(payload)
	if err != nil {
		return err
	}
	return processor.service.CommitSuccess(ctx, taskRunID, result)
}

func (processor *FirstLastFrameProcessor) CommitFailure(ctx context.Context, taskRunID string) error {
	return processor.service.CommitFailure(ctx, taskRunID)
}

func decodeFrameResult(payload json.RawMessage) (applicationfirstlastframe.Result, error) {
	var result firstlastframecontract.Result
	if len(payload) == 0 || json.Unmarshal(payload, &result) != nil {
		return applicationfirstlastframe.Result{}, fmt.Errorf(
			"%w: decode first last frame result",
			applicationtask.ErrInvalidAsyncExecutionEventPayload,
		)
	}
	return applicationfirstlastframe.Result{
		FirstFrameArtifactID: result.FirstFrameArtifactID,
		LastFrameArtifactID:  result.LastFrameArtifactID,
		FirstFrameSizeBytes:  result.FirstFrameSizeBytes,
		LastFrameSizeBytes:   result.LastFrameSizeBytes,
	}, nil
}
