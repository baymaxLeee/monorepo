package imagegeneration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	applicationimagegeneration "github.com/example/monorepo/canvas/internal/application/imagegeneration"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Repository struct{ store *persistencetransaction.Store }

func NewRepository(store *persistencetransaction.Store) *Repository { return &Repository{store: store} }
func (repository *Repository) CreateRun(ctx context.Context, run domainimagegeneration.Run) error {
	row, inputs, err := runRowsFromDomain(run)
	if err != nil {
		return err
	}
	return repository.store.WithinTransaction(ctx, func(ctx context.Context) error {
		db := repository.store.Queries(ctx)
		if err := db.ImageRunCreate(ctx, row); err != nil {
			return err
		}
		for _, input := range inputs {
			if err := db.ImageRunCreateInput(ctx, sqlc.ImageRunCreateInputParams(input)); err != nil {
				return err
			}
		}
		return nil
	})
}

func (repository *Repository) GetRun(ctx context.Context, scope applicationimagegeneration.Scope, taskRunID string) (domainimagegeneration.Run, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return domainimagegeneration.Run{}, applicationimagegeneration.ErrNotFound
	}
	db := repository.store.Queries(ctx)
	row, err := db.ImageRunGet(ctx, sqlc.ImageRunGetParams{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ID: id.String()})
	if err != nil {
		return domainimagegeneration.Run{}, readError(err)
	}
	inputs, err := db.ImageRunInputs(ctx, []string{id.String()})
	if err != nil {
		return domainimagegeneration.Run{}, err
	}
	return runDomainFromRows(row, inputs)
}

func (repository *Repository) ListRuns(ctx context.Context, scope applicationimagegeneration.Scope, targetType domainimagegeneration.TargetType, targetID string) ([]domainimagegeneration.Run, error) {
	target, err := persistenceid.Parse(targetID)
	if err != nil {
		return nil, applicationimagegeneration.ErrNotFound
	}
	db := repository.store.Queries(ctx)
	rows, err := db.ImageRunHistory(ctx, sqlc.ImageRunHistoryParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		TargetType:  string(targetType),
		TargetID:    target.String(),
		CreatedBy:   scope.CallerID,
	})
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(rows))
	for _, item := range rows {
		ids = append(ids, item.TaskRunID)
	}
	var inputRows []runInputRow
	if len(ids) > 0 {
		if inputRows, err = db.ImageRunInputs(ctx, ids); err != nil {
			return nil, err
		}
	}
	inputsByRun := make(map[string][]runInputRow, len(rows))
	for _, input := range inputRows {
		inputsByRun[input.TaskRunID] = append(inputsByRun[input.TaskRunID], input)
	}
	result := make([]domainimagegeneration.Run, 0, len(rows))
	for _, item := range rows {
		run, err := runDomainFromRows(item, inputsByRun[item.TaskRunID])
		if err != nil {
			return nil, err
		}
		result = append(result, run)
	}
	return result, nil
}

func (repository *Repository) ListRunIDsByTargets(ctx context.Context, scope applicationimagegeneration.Scope, targetType domainimagegeneration.TargetType, targetIDs []string) ([]string, error) {
	targets := make([]string, 0, len(targetIDs))
	seen := make(map[string]struct{}, len(targetIDs))
	for _, targetID := range targetIDs {
		target, err := persistenceid.Parse(targetID)
		if err != nil {
			return nil, applicationimagegeneration.ErrNotFound
		}
		if _, exists := seen[target.String()]; exists {
			continue
		}
		seen[target.String()] = struct{}{}
		targets = append(targets, target.String())
	}
	if len(targets) == 0 {
		return []string{}, nil
	}
	return repository.store.Queries(ctx).ImageRunIDs(ctx, sqlc.ImageRunIDsParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		TargetType:  string(targetType),
		Ids:         targets,
	})
}

func (repository *Repository) ListLatestRuns(ctx context.Context, scope applicationimagegeneration.Scope, targetType domainimagegeneration.TargetType, targetIDs []string) ([]domainimagegeneration.Run, error) {
	targets := make([]string, 0, len(targetIDs))
	for _, targetID := range targetIDs {
		target, err := persistenceid.Parse(targetID)
		if err != nil {
			return nil, applicationimagegeneration.ErrNotFound
		}
		targets = append(targets, target.String())
	}
	rows, err := repository.store.Queries(ctx).ImageRunLatest(ctx, sqlc.ImageRunLatestParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		TargetType:  string(targetType),
		Ids:         targets,
		CreatedBy:   scope.CallerID,
	})
	if err != nil {
		return nil, err
	}
	latestByTarget := make(map[string]domainimagegeneration.Run, len(targets))
	for _, row := range rows {
		key := row.TargetID
		run, e := runDomainFromRows(row, nil)
		if e != nil {
			return nil, e
		}
		latestByTarget[key] = run
	}
	result := make([]domainimagegeneration.Run, 0, len(latestByTarget))
	for _, targetID := range targetIDs {
		if run, found := latestByTarget[targetID]; found {
			result = append(result, run)
		}
	}
	return result, nil
}

func (repository *Repository) SaveRun(ctx context.Context, run domainimagegeneration.Run) error {
	_, err := repository.saveRun(ctx, run, nil, time.Time{})
	return err
}

func (repository *Repository) SaveRunCheckpoint(ctx context.Context, run domainimagegeneration.Run, schedule domaintask.PollSchedule, now time.Time) (bool, error) {
	return repository.saveRun(ctx, run, &schedule, now)
}

func (repository *Repository) saveRun(ctx context.Context, run domainimagegeneration.Run, schedule *domaintask.PollSchedule, now time.Time) (bool, error) {
	id, err := persistenceid.Parse(run.TaskRunID)
	if err != nil {
		return false, fmt.Errorf("save image generation run: %w", err)
	}
	outputAssetID, err := persistenceid.ParseOptional(run.OutputAssetID)
	if err != nil {
		return false, fmt.Errorf("save image generation output Asset ID: %w", err)
	}
	var version int64
	if schedule != nil {
		version = schedule.StateVersion
	}
	affected, err := repository.store.Queries(ctx).ImageRunUpdate(ctx, sqlc.ImageRunUpdateParams{
		TaskRunID:         id.String(),
		Fenced:            schedule != nil,
		Version:           version,
		Now:               pgtype.Timestamptz{Time: now, Valid: true},
		OutputAssetID:     optionalString(outputAssetID),
		BindingOutcome:    string(run.BindingOutcome),
		Stage:             run.Stage,
		ProviderAttempt:   run.ProviderAttempt,
		ProviderImageUrl:  run.ProviderImageURL,
		SourceAssetID:     run.SourceAssetID,
		SourceRevisionID:  run.SourceRevisionID,
		ArtifactSizeBytes: run.ArtifactSizeBytes,
		ErrorCode:         run.ErrorCode,
		ErrorMessage:      run.ErrorMessage,
		UpdatedAt:         run.UpdatedAt,
		CompletedAt:       run.CompletedAt,
	})
	return affected == 1, err
}

func runRowsFromDomain(run domainimagegeneration.Run) (runRow, []runInputRow, error) {
	taskRunID, err := persistenceid.Parse(run.TaskRunID)
	if err != nil {
		return runRow{}, nil, fmt.Errorf("map image generation TaskRun ID: %w", err)
	}
	targetID, err := persistenceid.Parse(run.Target.ID)
	if err != nil {
		return runRow{}, nil, fmt.Errorf("map image generation target ID: %w", err)
	}
	ownerID, err := persistenceid.Parse(run.OutputOwner.ID)
	if err != nil {
		return runRow{}, nil, fmt.Errorf("map image generation output owner ID: %w", err)
	}
	outputAssetID, err := persistenceid.ParseOptional(run.OutputAssetID)
	if err != nil {
		return runRow{}, nil, fmt.Errorf("map image generation output Asset ID: %w", err)
	}
	snapshots, err := json.Marshal(run.InputSnapshots)
	if err != nil {
		return runRow{}, nil, err
	}
	row := runRow{
		TaskRunID: taskRunID.String(), TargetType: string(run.Target.Type), TargetID: targetID.String(), TargetRevision: run.Target.Revision,
		TenantID: run.TenantID, InvocationProjectID: run.ProjectID, WorkspaceID: run.WorkspaceID,
		Prompt: run.Config.Prompt, ModelID: run.Config.ModelID,
		Resolution: string(run.Config.Resolution), AspectRatio: string(run.Config.AspectRatio), Watermark: run.Config.Watermark,
		InputSnapshots:  snapshots,
		OutputOwnerType: int16(run.OutputOwner.Type), OutputOwnerID: ownerID.String(), BindingOutcome: string(run.BindingOutcome),
		Stage: run.Stage, ProviderAttempt: run.ProviderAttempt, ProviderImageUrl: run.ProviderImageURL,
		SourceAssetID: run.SourceAssetID, SourceRevisionID: run.SourceRevisionID, ArtifactSizeBytes: run.ArtifactSizeBytes, OutputAssetID: optionalString(outputAssetID),
		ErrorCode: run.ErrorCode, ErrorMessage: run.ErrorMessage,
		CreatedBy: run.CreatedBy, CreatedAt: run.CreatedAt, UpdatedAt: run.UpdatedAt, CompletedAt: run.CompletedAt,
	}
	inputs := make([]runInputRow, 0, len(run.Inputs))
	for _, input := range run.Inputs {
		assetID, parseErr := persistenceid.Parse(input.AssetID)
		if parseErr != nil {
			return runRow{}, nil, fmt.Errorf("map image generation run input Asset ID: %w", parseErr)
		}
		inputs = append(inputs, runInputRow{TaskRunID: taskRunID.String(), Position: input.Position, SourceType: string(input.SourceType), AssetID: assetID.String()})
	}
	return row, inputs, nil
}

func runDomainFromRows(row sqlc.ImageGenerationRun, inputs []runInputRow) (domainimagegeneration.Run, error) {
	var snapshots []domaingenerationinput.Input
	if len(row.InputSnapshots) > 0 {
		if err := json.Unmarshal(row.InputSnapshots, &snapshots); err != nil {
			return domainimagegeneration.Run{}, err
		}
	}
	run := domainimagegeneration.Run{
		TaskRunID: row.TaskRunID, TenantID: row.TenantID, ProjectID: row.InvocationProjectID, WorkspaceID: row.WorkspaceID,
		Target:         domainimagegeneration.TargetRef{Type: domainimagegeneration.TargetType(row.TargetType), ID: row.TargetID, Revision: row.TargetRevision},
		Config:         domainimagegeneration.Config{Prompt: row.Prompt, ModelID: row.ModelID, Resolution: domainimagegeneration.Resolution(row.Resolution), AspectRatio: domainimagegeneration.AspectRatio(row.AspectRatio), Watermark: row.Watermark},
		InputSnapshots: snapshots,
		OutputOwner:    domainimagegeneration.OutputAssetOwner{Type: domainasset.OwnerType(row.OutputOwnerType), ID: row.OutputOwnerID},
		BindingOutcome: domainimagegeneration.BindingOutcome(row.BindingOutcome), Stage: row.Stage,
		ProviderAttempt: row.ProviderAttempt, ProviderImageURL: row.ProviderImageUrl,
		SourceAssetID: row.SourceAssetID, SourceRevisionID: row.SourceRevisionID, ArtifactSizeBytes: row.ArtifactSizeBytes,
		ErrorCode: row.ErrorCode, ErrorMessage: row.ErrorMessage,
		CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, CompletedAt: row.CompletedAt,
	}
	if row.OutputAssetID != nil {
		run.OutputAssetID = *row.OutputAssetID
	}
	for _, input := range inputs {
		run.Inputs = append(run.Inputs, domainimagegeneration.ResolvedInput{Position: input.Position, SourceType: domainimagegeneration.InputSourceType(input.SourceType), AssetID: input.AssetID})
	}
	return run, nil
}

func optionalString(id *persistenceid.UUID) *string {
	if id == nil {
		return nil
	}
	s := id.String()
	return &s
}

func readError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return applicationimagegeneration.ErrNotFound
	}
	return err
}
