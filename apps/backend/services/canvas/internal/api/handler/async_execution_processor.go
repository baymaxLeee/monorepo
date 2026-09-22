package http

import (
	"context"
	"encoding/json"
	"errors"

	applicationcanvasarchive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	applicationfirstlastframe "github.com/example/monorepo/canvas/internal/application/firstlastframe"
	archivecontract "github.com/example/monorepo/canvas/internal/contract/canvasarchive"
	firstlastframecontract "github.com/example/monorepo/canvas/internal/contract/firstlastframe"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

const (
	asyncExecutionStateReady     = "READY"
	asyncExecutionStateRetry     = "RETRY"
	asyncExecutionStateSucceeded = "SUCCEEDED"
	asyncExecutionStateTerminal  = "TERMINAL"
)

type archiveExecutionService interface {
	LoadExecution(context.Context, string) (applicationcanvasarchive.Execution, error)
}

type firstLastFrameExecutionService interface {
	LoadExecution(context.Context, string) (applicationfirstlastframe.Execution, error)
}

type asyncExecutionProcessor interface {
	RunType() string
	Get(context.Context, string) (string, json.RawMessage, error)
}

type archiveAsyncExecutionProcessor struct {
	service archiveExecutionService
}

type firstLastFrameAsyncExecutionProcessor struct {
	service firstLastFrameExecutionService
}

func (*firstLastFrameAsyncExecutionProcessor) RunType() string {
	return string(domaintask.RunTypeCanvasNodeVideoFirstLastFrameExtraction)
}

func (processor *firstLastFrameAsyncExecutionProcessor) Get(
	ctx context.Context,
	taskRunID string,
) (string, json.RawMessage, error) {
	execution, err := processor.service.LoadExecution(ctx, taskRunID)
	switch {
	case errors.Is(err, applicationfirstlastframe.ErrExecutionNotReady):
		return asyncExecutionStateRetry, nil, nil
	case errors.Is(err, applicationfirstlastframe.ErrExecutionSucceeded):
		return asyncExecutionStateSucceeded, nil, nil
	case errors.Is(err, applicationfirstlastframe.ErrExecutionTerminal):
		return asyncExecutionStateTerminal, nil, nil
	case err != nil:
		return "", nil, err
	}
	payload, err := json.Marshal(firstlastframecontract.Execution{
		TaskRunID: execution.TaskRunID, GenerationTaskRunID: execution.GenerationTaskRunID,
		TenantID: execution.TenantID, WorkspaceID: execution.WorkspaceID, ProjectID: execution.ProjectID,
		CreatedBy: execution.CreatedBy, SourceArtifactID: execution.SourceArtifactID,
		SourceArtifactNamespace: execution.SourceArtifactNamespace,
		FirstFrameCheckpointID:  execution.FirstFrameCheckpointID, LastFrameCheckpointID: execution.LastFrameCheckpointID,
		FirstFrameCheckpointSizeBytes: execution.FirstFrameCheckpointSizeBytes,
		LastFrameCheckpointSizeBytes:  execution.LastFrameCheckpointSizeBytes,
	})
	return asyncExecutionStateReady, payload, err
}

func (*archiveAsyncExecutionProcessor) RunType() string {
	return archivecontract.RunType
}

func (processor *archiveAsyncExecutionProcessor) Get(
	ctx context.Context,
	taskRunID string,
) (string, json.RawMessage, error) {
	execution, err := processor.service.LoadExecution(ctx, taskRunID)
	switch {
	case errors.Is(err, applicationcanvasarchive.ErrExecutionNotReady):
		return asyncExecutionStateRetry, nil, nil
	case errors.Is(err, applicationcanvasarchive.ErrExecutionTerminal):
		if execution.Export.Status == domaintask.StatusSucceeded {
			return asyncExecutionStateSucceeded, nil, nil
		}
		return asyncExecutionStateTerminal, nil, nil
	case err != nil:
		return "", nil, err
	}
	payload, err := json.Marshal(executionToContract(execution))
	return asyncExecutionStateReady, payload, err
}

func executionToContract(execution applicationcanvasarchive.Execution) *archivecontract.Execution {
	result := &archivecontract.Execution{
		TaskRunID: execution.Export.TaskRunID, TenantID: execution.Export.TenantID,
		CreatedBy: execution.Export.CreatedBy, OutputFilename: execution.Export.OutputFilename,
		SnapshotAt: execution.Export.CreatedAt, Inputs: make([]archivecontract.Input, 0, len(execution.Inputs)),
	}
	for index := range execution.Inputs {
		input := execution.Inputs[index]
		result.Inputs = append(result.Inputs, archivecontract.Input{
			ArtifactID: input.ArtifactID, ArtifactNamespace: input.ArtifactNamespace,
			EntryName: input.EntryName, Ordinal: input.Ordinal, MediaSize: input.MediaSize,
		})
	}
	if execution.Export.OutputPath != "" {
		startedAt := execution.Export.CreatedAt
		if execution.Export.RetentionStartedAt != nil {
			startedAt = *execution.Export.RetentionStartedAt
		}
		result.Output = &archivecontract.Output{
			Path: execution.Export.OutputPath, SHA256: execution.Export.OutputSHA256,
			UploadID: execution.Export.UploadID, Size: execution.Export.OutputSize,
			PartSize: execution.Export.PartSize, RetentionStartedAt: startedAt,
		}
	}
	return result
}
