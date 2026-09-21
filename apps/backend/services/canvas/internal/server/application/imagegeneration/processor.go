package imagegeneration

import (
	"context"
	"errors"
	"time"

	"github.com/example/monorepo/canvas/internal/platform/artifactnamespace"
	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
	applicationtask "github.com/example/monorepo/canvas/internal/server/application/task"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/server/domain/imagegeneration"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
)

type PersistImageInput struct {
	TaskRunID, TenantID, CallerID, ProjectID, SourceURL string
	WorkspaceID                                         *string
}
type PersistedImage struct {
	ArtifactID        string
	ArtifactNamespace string
	SizeBytes         int64
}
type ImageResultStore interface {
	PersistImage(context.Context, PersistImageInput) (PersistedImage, error)
}

type ProcessorRunStore interface {
	GetRun(context.Context, Scope, string) (domainimagegeneration.Run, error)
	SaveRun(context.Context, domainimagegeneration.Run) error
	SaveRunCheckpoint(context.Context, domainimagegeneration.Run, domaintask.PollSchedule, time.Time) (bool, error)
}
type ProcessorTaskStore interface {
	GetTaskRunForUpdate(context.Context, string) (domaintask.TaskRun, error)
	UpdateTaskRun(context.Context, domaintask.TaskRun, applicationtask.TaskRunUpdate, time.Time) (bool, error)
	CompletePollSchedule(context.Context, domaintask.PollSchedule) (bool, error)
	RenewPollSchedule(context.Context, domaintask.PollSchedule, time.Time, time.Time) (bool, error)
}
type ProcessorAssetManager interface {
	BypassBatchGet(context.Context, applicationasset.BypassBatchGetInput) ([]domainasset.Asset, error)
	CreateFromOwnedArtifact(context.Context, applicationasset.CreateFromArtifactInput) (domainasset.Asset, error)
}
type ReferenceResolver interface {
	PlatformReferenceURL(context.Context, string, string, domainasset.Asset) (string, error)
}

type Processor struct {
	runs         ProcessorRunStore
	tasks        ProcessorTaskStore
	assets       ProcessorAssetManager
	resolver     ReferenceResolver
	provider     Provider
	results      ImageResultStore
	transactions TransactionManager
	clock        Clock
	references   AssetReferenceTracker
	targets      *TargetRegistry
	usage        usageIntegration
}

func NewProcessor(runs ProcessorRunStore, tasks ProcessorTaskStore, assets ProcessorAssetManager, resolver ReferenceResolver, provider Provider, results ImageResultStore, transactions TransactionManager, clock Clock, references AssetReferenceTracker, targets *TargetRegistry, options ...Option) *Processor {
	return &Processor{
		runs: runs, tasks: tasks, assets: assets, resolver: resolver, provider: provider, results: results,
		transactions: transactions, clock: clock, references: references, targets: targets,
		usage: projectUsageIntegration(options),
	}
}

func (*Processor) RunType() domaintask.RunType { return domaintask.RunTypeImageGeneration }

func (processor *Processor) ProcessPollClaim(ctx context.Context, task domaintask.TaskRun, schedule domaintask.PollSchedule) error {
	if processor == nil || processor.runs == nil || processor.tasks == nil || processor.assets == nil || processor.resolver == nil || processor.provider == nil || processor.results == nil || processor.transactions == nil || processor.clock == nil || processor.targets == nil || task.RunType != processor.RunType() || schedule.TaskRunID != task.ID {
		return errors.New("image generation processor dependencies or claim are invalid")
	}
	scope := Scope{TenantID: task.TenantID, WorkspaceID: task.WorkspaceID, CallerID: task.CreatedBy}
	run, err := processor.runs.GetRun(ctx, scope, task.ID)
	if err != nil {
		return err
	}
	if task.SubjectType != domaintask.SubjectTypeImageGeneration || task.SubjectID != run.Target.ID {
		return ErrRunConflict
	}
	handler, err := processor.targets.Handler(run.Target.Type)
	if err != nil {
		return err
	}
	if !schedule.DeadlineAt.IsZero() && !processor.clock.Now().Before(schedule.DeadlineAt) {
		return processor.fail(context.WithoutCancel(ctx), run, task, schedule, handler, errors.New("image generation deadline exceeded"))
	}
	now := processor.clock.Now()
	if task.Status == domaintask.StatusQueued {
		started := now
		won, updateErr := processor.tasks.UpdateTaskRun(ctx, task, applicationtask.TaskRunUpdate{Status: domaintask.StatusRunning, StartedAt: &started}, now)
		if updateErr != nil || !won {
			return errors.Join(updateErr, errors.New("image generation task start fencing lost"))
		}
		task.Status, task.StartedAt, task.StateVersion = domaintask.StatusRunning, &started, task.StateVersion+1
	}
	assetIDs := make([]string, len(run.Inputs))
	for index, input := range run.Inputs {
		assetIDs[index] = input.AssetID
	}
	referenceURLs := []string{}
	if len(assetIDs) > 0 {
		assets, getErr := processor.assets.BypassBatchGet(ctx, applicationasset.BypassBatchGetInput{
			Scope:    applicationasset.Scope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy},
			AssetIDs: assetIDs,
		})
		if getErr != nil {
			return processor.fail(ctx, run, task, schedule, handler, getErr)
		}
		if len(assets) != len(assetIDs) {
			return processor.fail(ctx, run, task, schedule, handler, errors.New("image generation reference count mismatch"))
		}
		for index, item := range assets {
			if item.ID != assetIDs[index] {
				return processor.fail(ctx, run, task, schedule, handler, errors.New("image generation reference unavailable"))
			}
			if item.MediaType != domainasset.MediaImage {
				return processor.fail(ctx, run, task, schedule, handler, errors.New("image generation reference is not an image"))
			}
			referenceURL, resolveErr := processor.resolver.PlatformReferenceURL(ctx, run.TenantID, run.CreatedBy, item)
			if resolveErr != nil || referenceURL == "" {
				return processor.fail(ctx, run, task, schedule, handler, errors.Join(resolveErr, errors.New("image generation reference unavailable")))
			}
			referenceURLs = append(referenceURLs, referenceURL)
		}
	}
	if run.Stage == "PROVIDER_REQUESTING" && run.ProviderAttempt > 0 && run.ProviderImageURL == "" {
		if err = markInterruptedImageUsageCall(context.WithoutCancel(ctx), processor.usage.calls, run); err != nil {
			return err
		}
		return processor.fail(context.WithoutCancel(ctx), run, task, schedule, handler, errors.New("image generation provider result is uncertain"))
	}
	if run.ProviderImageURL == "" {
		if err = processor.ensureLease(ctx, schedule); err != nil {
			return err
		}
		run.Stage, run.ProviderAttempt, run.UpdatedAt = "PROVIDER_REQUESTING", run.ProviderAttempt+1, processor.clock.Now()
		if err = processor.saveCheckpoint(ctx, run, schedule); err != nil {
			return err
		}
		providerResult, providerErr := processor.generateProvider(ctx, run, ProviderInput{
			TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy,
			TaskRunID: run.TaskRunID, CallOrdinal: 1,
			ProjectID: run.ProjectID,
			ModelID:   run.Config.ModelID, Prompt: run.Config.Prompt, Resolution: run.Config.Resolution,
			AspectRatio: run.Config.AspectRatio, Watermark: run.Config.Watermark, ReferenceURLs: referenceURLs,
		})
		run.ProviderImageURL, err = providerResult.SourceURL, providerErr
		if err != nil {
			return processor.fail(context.WithoutCancel(ctx), run, task, schedule, handler, err)
		}
		run.Stage, run.UpdatedAt = "PROVIDER_SUCCEEDED", processor.clock.Now()
		if err = processor.ensureLease(ctx, schedule); err != nil {
			return err
		}
		if err = processor.saveCheckpoint(ctx, run, schedule); err != nil {
			return err
		}
	}
	if run.ArtifactID == "" {
		if err = processor.ensureLease(ctx, schedule); err != nil {
			return err
		}
		persisted, persistErr := processor.results.PersistImage(ctx, PersistImageInput{
			TaskRunID: run.TaskRunID, TenantID: run.TenantID, WorkspaceID: run.WorkspaceID,
			ProjectID: run.ProjectID, CallerID: run.CreatedBy, SourceURL: run.ProviderImageURL,
		})
		if persistErr != nil {
			return persistErr
		}
		run.ArtifactID, run.ArtifactSizeBytes, run.Stage, run.UpdatedAt = persisted.ArtifactID, persisted.SizeBytes, "ARTIFACT_SAVED", processor.clock.Now()
		if err = processor.saveCheckpoint(ctx, run, schedule); err != nil {
			return err
		}
	}
	if run.OutputAssetID == "" {
		if err = processor.ensureLease(ctx, schedule); err != nil {
			return err
		}
		artifactNamespace, namespaceErr := imageArtifactNamespace(run)
		if namespaceErr != nil {
			return namespaceErr
		}
		output, createErr := processor.assets.CreateFromOwnedArtifact(ctx, applicationasset.CreateFromArtifactInput{
			Scope:     applicationasset.Scope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy},
			OwnerType: run.OutputOwner.Type, OwnerID: run.OutputOwner.ID, CreationKey: "image-generation:" + run.TaskRunID,
			ArtifactID: run.ArtifactID, ArtifactNamespace: artifactNamespace, FileName: run.TaskRunID + ".png", MediaType: domainasset.MediaImage,
			ContentType: "image/png", SizeBytes: run.ArtifactSizeBytes,
		})
		if createErr != nil {
			return createErr
		}
		run.OutputAssetID, run.Stage, run.UpdatedAt = output.ID, "ASSET_SAVED", processor.clock.Now()
		if err = processor.saveCheckpoint(ctx, run, schedule); err != nil {
			return err
		}
	}
	committed, _, err := processor.succeed(context.WithoutCancel(ctx), run, task, schedule, handler)
	if err == nil && committed {
		triggerImageUsageAfterCommit(processor.usage.finalizer, task.ID)
	}
	return err
}

func imageArtifactNamespace(run domainimagegeneration.Run) (string, error) {
	return (artifactnamespace.Scope{
		TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, ProjectID: &run.ProjectID,
	}).Namespace()
}

func (processor *Processor) ensureLease(ctx context.Context, schedule domaintask.PollSchedule) error {
	now := processor.clock.Now()
	won, err := processor.tasks.RenewPollSchedule(ctx, schedule, now, now.Add(12*time.Minute))
	if err != nil || !won {
		return errors.Join(err, errors.New("image generation schedule lease lost"))
	}
	return nil
}

func (processor *Processor) saveCheckpoint(ctx context.Context, run domainimagegeneration.Run, schedule domaintask.PollSchedule) error {
	won, err := processor.runs.SaveRunCheckpoint(ctx, run, schedule, processor.clock.Now())
	if err != nil || !won {
		return errors.Join(err, errors.New("image generation checkpoint fencing lost"))
	}
	return nil
}

func (processor *Processor) succeed(ctx context.Context, run domainimagegeneration.Run, task domaintask.TaskRun, schedule domaintask.PollSchedule, handler TargetHandler) (bool, domainimagegeneration.BindingOutcome, error) {
	now := processor.clock.Now()
	committed := false
	err := processor.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		current, err := processor.tasks.GetTaskRunForUpdate(tx, task.ID)
		if err != nil || current.Terminal() {
			return err
		}
		run.UpdatedAt = now
		outcome := domainimagegeneration.BindingTargetInvalidated
		// Hiding a deleted target revokes retention as well as write-back. A
		// superseded but visible run still retains its independent history.
		if current.HiddenAt == nil {
			outcome, err = handler.BindResult(tx, run, run.OutputAssetID)
			if err != nil {
				return err
			}
		}
		finished := now
		won, err := processor.tasks.UpdateTaskRun(tx, current, applicationtask.TaskRunUpdate{Status: domaintask.StatusSucceeded, FinishedAt: &finished}, now)
		if err != nil || !won {
			return errors.Join(err, errors.New("image generation completion fencing lost"))
		}
		run.BindingOutcome, run.Stage, run.UpdatedAt, run.CompletedAt = outcome, "SUCCEEDED", now, &now
		if err = processor.runs.SaveRun(tx, run); err != nil {
			return err
		}
		if processor.references != nil {
			referenceScope := applicationasset.ReferenceScope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID}
			if current.HiddenAt != nil {
				if err = processor.references.ReleaseAllAssets(tx, applicationasset.ReleaseAllAssetsInput{
					Scope: referenceScope,
					Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerImageGenerationOutput, Key: run.TaskRunID},
				}); err != nil {
					return err
				}
			} else if run.OutputAssetID != "" {
				if err = processor.references.AcquireAssets(tx, applicationasset.AcquireAssetsInput{
					Scope:    referenceScope,
					Owner:    applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerImageGenerationOutput, Key: run.TaskRunID},
					AssetIDs: []string{run.OutputAssetID},
				}); err != nil {
					return err
				}
			}
		}
		completed, err := processor.tasks.CompletePollSchedule(tx, schedule)
		if err != nil || !completed {
			return errors.Join(err, errors.New("image generation schedule fencing lost"))
		}
		if err = closeImageUsage(tx, processor.usage.finalizer, current.ID); err != nil {
			return err
		}
		committed = true
		return nil
	})
	return committed, run.BindingOutcome, err
}

func (processor *Processor) fail(ctx context.Context, run domainimagegeneration.Run, task domaintask.TaskRun, schedule domaintask.PollSchedule, handler TargetHandler, cause error) error {
	now := processor.clock.Now()
	errorCode, errorMessage := "IMAGE_GENERATION_FAILED", "image generation failed"
	var providerFailure *ProviderFailure
	if errors.As(cause, &providerFailure) {
		if providerFailure.Code != "" {
			errorCode = providerFailure.Code
		}
		if providerFailure.Message != "" {
			errorMessage = providerFailure.Message
		}
	}
	run.Stage, run.ErrorCode, run.ErrorMessage, run.UpdatedAt, run.CompletedAt = "FAILED", errorCode, errorMessage, now, &now
	persistErr := processor.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		current, err := processor.tasks.GetTaskRunForUpdate(tx, task.ID)
		if err != nil || current.Terminal() {
			return err
		}
		if err = handler.FailRun(tx, run); err != nil {
			return err
		}
		finished := now
		won, err := processor.tasks.UpdateTaskRun(tx, current, applicationtask.TaskRunUpdate{Status: domaintask.StatusFailed, ErrorCode: run.ErrorCode, ErrorMessage: run.ErrorMessage, FinishedAt: &finished}, now)
		if err != nil || !won {
			return errors.Join(err, cause)
		}
		if err = processor.runs.SaveRun(tx, run); err != nil {
			return err
		}
		completed, err := processor.tasks.CompletePollSchedule(tx, schedule)
		if err != nil || !completed {
			return errors.Join(err, errors.New("image generation schedule fencing lost"))
		}
		return closeImageUsage(tx, processor.usage.finalizer, current.ID)
	})
	if persistErr == nil {
		triggerImageUsageAfterCommit(processor.usage.finalizer, task.ID)
	}
	return errors.Join(persistErr, cause)
}

var _ applicationtask.PollProcessor = (*Processor)(nil)
