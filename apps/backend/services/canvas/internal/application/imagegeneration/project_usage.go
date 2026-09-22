package imagegeneration

import (
	"context"
	"errors"

	applicationprojectusage "github.com/example/monorepo/canvas/internal/application/projectusage"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domainprojectusage "github.com/example/monorepo/canvas/internal/domain/projectusage"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

type usageIntegration struct {
	calls     *applicationprojectusage.CallRecorder
	finalizer *applicationprojectusage.Finalizer
}

// Option keeps project usage accounting optional so existing deployments and
// tests preserve their behavior until both ledger dependencies are wired.
type Option func(*usageIntegration)

func WithProjectUsage(
	calls *applicationprojectusage.CallRecorder,
	finalizer *applicationprojectusage.Finalizer,
) Option {
	return func(integration *usageIntegration) {
		integration.calls = calls
		integration.finalizer = finalizer
	}
}

func projectUsageIntegration(options []Option) usageIntegration {
	integration := usageIntegration{}
	for _, option := range options {
		if option != nil {
			option(&integration)
		}
	}
	return integration
}

func beginImageUsageCall(
	ctx context.Context,
	recorder *applicationprojectusage.CallRecorder,
	run domainimagegeneration.Run,
) (domainprojectusage.CallRef, error) {
	return recorder.BeginRelated(
		ctx, run.TaskRunID, 1, string(domaintask.RunTypeImageGeneration), run.Config.ModelID,
	)
}

func imageUsagePlanInput(taskRunID, projectID, modelID, modelName, modelSource string) applicationprojectusage.BeginCallInput {
	return applicationprojectusage.BeginCallInput{
		TaskRunID: taskRunID, CallOrdinal: 1, CallType: string(domaintask.RunTypeImageGeneration),
		ProjectID: projectID, ModelID: modelID, ModelName: modelName, ModelSource: modelSource,
	}
}

func markInterruptedImageUsageCall(
	ctx context.Context,
	recorder *applicationprojectusage.CallRecorder,
	run domainimagegeneration.Run,
) error {
	if recorder == nil {
		return nil
	}
	_, err := recorder.MarkInterruptedIfPresent(ctx, domainprojectusage.CallRef{
		TaskRunID: run.TaskRunID, CallOrdinal: 1,
	}, "image generation execution was interrupted after an AIGW call began")
	return err
}

func (processor *Processor) generateProvider(
	ctx context.Context,
	run domainimagegeneration.Run,
	input ProviderInput,
) (ProviderResult, error) {
	if processor.usage.calls == nil {
		return processor.provider.Generate(ctx, input)
	}
	ref, err := beginImageUsageCall(ctx, processor.usage.calls, run)
	if err != nil {
		return ProviderResult{}, err
	}
	result, providerErr := processor.provider.Generate(ctx, input)
	recordErr := processor.usage.calls.RecordProviderResult(
		context.WithoutCancel(ctx), ref, result.Call.RequestID, result.Call.RequestAttempted,
	)
	return result, errors.Join(providerErr, recordErr)
}

func closeImageUsage(
	ctx context.Context,
	finalizer *applicationprojectusage.Finalizer,
	taskRunID string,
) error {
	if finalizer == nil {
		return nil
	}
	return finalizer.Close(ctx, applicationprojectusage.CloseInput{TaskRunID: taskRunID})
}

func triggerImageUsageAfterCommit(finalizer *applicationprojectusage.Finalizer, taskRunID string) {
	if finalizer != nil {
		finalizer.TriggerAfterCommit(taskRunID)
	}
}
