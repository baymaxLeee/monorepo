package imagegeneration

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"

	applicationimagegeneration "github.com/example/monorepo/canvas/internal/application/imagegeneration"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *gorm.DB }

const maxHistoryItems = 100

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (repository *Repository) CreateRun(ctx context.Context, run domainimagegeneration.Run) error {
	row, inputs, err := runRowsFromDomain(run)
	if err != nil {
		return err
	}
	return persistencetransaction.DB(ctx, repository.db).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		if len(inputs) > 0 {
			return tx.Create(&inputs).Error
		}
		return nil
	})
}

func (repository *Repository) GetRun(ctx context.Context, scope applicationimagegeneration.Scope, taskRunID string) (domainimagegeneration.Run, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return domainimagegeneration.Run{}, applicationimagegeneration.ErrNotFound
	}
	db := persistencetransaction.DB(ctx, repository.db)
	var row runRow
	if err = scopedRunQuery(db, scope).Where("task_run_id = ?", id).First(&row).Error; err != nil {
		return domainimagegeneration.Run{}, readError(err)
	}
	var inputs []runInputRow
	if err = db.Where("task_run_id = ?", id).Order("position").Find(&inputs).Error; err != nil {
		return domainimagegeneration.Run{}, err
	}
	return runDomainFromRows(row, inputs), nil
}

func (repository *Repository) ListRuns(ctx context.Context, scope applicationimagegeneration.Scope, targetType domainimagegeneration.TargetType, targetID string) ([]domainimagegeneration.Run, error) {
	target, err := persistenceid.Parse(targetID)
	if err != nil {
		return nil, applicationimagegeneration.ErrNotFound
	}
	db := persistencetransaction.DB(ctx, repository.db)
	var rows []runRow
	if err = scopedRunQuery(db, scope).Where("target_type = ? AND target_id = ? AND created_by = ?", targetType, target, scope.CallerID).Order("created_at DESC, task_run_id DESC").Limit(maxHistoryItems).Find(&rows).Error; err != nil {
		return nil, err
	}
	ids := make([]persistenceid.UUID, 0, len(rows))
	for _, item := range rows {
		ids = append(ids, item.TaskRunID)
	}
	var inputRows []runInputRow
	if len(ids) > 0 {
		if err = db.Where("task_run_id IN ?", ids).Order("task_run_id, position").Find(&inputRows).Error; err != nil {
			return nil, err
		}
	}
	inputsByRun := make(map[persistenceid.UUID][]runInputRow, len(rows))
	for _, input := range inputRows {
		inputsByRun[input.TaskRunID] = append(inputsByRun[input.TaskRunID], input)
	}
	result := make([]domainimagegeneration.Run, 0, len(rows))
	for _, item := range rows {
		result = append(result, runDomainFromRows(item, inputsByRun[item.TaskRunID]))
	}
	return result, nil
}

func (repository *Repository) ListRunIDsByTargets(ctx context.Context, scope applicationimagegeneration.Scope, targetType domainimagegeneration.TargetType, targetIDs []string) ([]string, error) {
	targets := make([]persistenceid.UUID, 0, len(targetIDs))
	seen := make(map[persistenceid.UUID]struct{}, len(targetIDs))
	for _, targetID := range targetIDs {
		target, err := persistenceid.Parse(targetID)
		if err != nil {
			return nil, applicationimagegeneration.ErrNotFound
		}
		if _, exists := seen[target]; exists {
			continue
		}
		seen[target] = struct{}{}
		targets = append(targets, target)
	}
	if len(targets) == 0 {
		return []string{}, nil
	}
	var ids []persistenceid.UUID
	if err := scopedRunQuery(persistencetransaction.DB(ctx, repository.db), scope).
		Model(&runRow{}).Where("target_type = ? AND target_id IN ?", targetType, targets).
		Order("task_run_id ASC").Pluck("task_run_id", &ids).Error; err != nil {
		return nil, err
	}
	result := make([]string, len(ids))
	for index := range ids {
		result[index] = ids[index].String()
	}
	return result, nil
}

func (repository *Repository) ListLatestRuns(ctx context.Context, scope applicationimagegeneration.Scope, targetType domainimagegeneration.TargetType, targetIDs []string) ([]domainimagegeneration.Run, error) {
	targets := make([]persistenceid.UUID, 0, len(targetIDs))
	for _, targetID := range targetIDs {
		target, err := persistenceid.Parse(targetID)
		if err != nil {
			return nil, applicationimagegeneration.ErrNotFound
		}
		targets = append(targets, target)
	}
	var rows []runRow
	if err := scopedRunQuery(persistencetransaction.DB(ctx, repository.db), scope).
		Where("target_type = ? AND target_id IN ? AND created_by = ?", targetType, targets, scope.CallerID).
		Order("created_at DESC, task_run_id DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	latestByTarget := make(map[string]domainimagegeneration.Run, len(targets))
	for _, row := range rows {
		key := row.TargetID.String()
		if _, exists := latestByTarget[key]; !exists {
			latestByTarget[key] = runDomainFromRows(row, nil)
		}
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
	query := persistencetransaction.DB(ctx, repository.db).Model(&runRow{}).Where("task_run_id = ?", id)
	if schedule != nil {
		query = query.Where("EXISTS (SELECT 1 FROM poll_schedules WHERE poll_schedules.task_run_id = image_generation_runs.task_run_id AND poll_schedules.state_version = ? AND poll_schedules.lease_until > ?)", schedule.StateVersion, now)
	}
	result := query.Updates(map[string]any{
		"binding_outcome": run.BindingOutcome, "stage": run.Stage, "provider_attempt": run.ProviderAttempt,
		"provider_image_url": run.ProviderImageURL, "source_asset_id": run.SourceAssetID, "source_revision_id": run.SourceRevisionID,
		"artifact_size_bytes": run.ArtifactSizeBytes, "output_asset_id": outputAssetID,
		"error_code": run.ErrorCode, "error_message": run.ErrorMessage,
		"updated_at": run.UpdatedAt, "completed_at": run.CompletedAt,
	})
	return result.RowsAffected == 1, result.Error
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
	row := runRow{
		TaskRunID: taskRunID, TargetType: string(run.Target.Type), TargetID: targetID, TargetRevision: run.Target.Revision,
		TenantID: run.TenantID, InvocationProjectID: run.ProjectID, WorkspaceID: run.WorkspaceID,
		Prompt: run.Config.Prompt, ModelID: run.Config.ModelID,
		Resolution: string(run.Config.Resolution), AspectRatio: string(run.Config.AspectRatio), Watermark: run.Config.Watermark,
		InputSnapshots:  run.InputSnapshots,
		OutputOwnerType: int16(run.OutputOwner.Type), OutputOwnerID: ownerID, BindingOutcome: string(run.BindingOutcome),
		Stage: run.Stage, ProviderAttempt: run.ProviderAttempt, ProviderImageURL: run.ProviderImageURL,
		SourceAssetID: run.SourceAssetID, SourceRevisionID: run.SourceRevisionID, ArtifactSizeBytes: run.ArtifactSizeBytes, OutputAssetID: outputAssetID,
		ErrorCode: run.ErrorCode, ErrorMessage: run.ErrorMessage,
		CreatedBy: run.CreatedBy, CreatedAt: run.CreatedAt, UpdatedAt: run.UpdatedAt, CompletedAt: run.CompletedAt,
	}
	inputs := make([]runInputRow, 0, len(run.Inputs))
	for _, input := range run.Inputs {
		assetID, parseErr := persistenceid.Parse(input.AssetID)
		if parseErr != nil {
			return runRow{}, nil, fmt.Errorf("map image generation run input Asset ID: %w", parseErr)
		}
		inputs = append(inputs, runInputRow{TaskRunID: taskRunID, Position: input.Position, SourceType: string(input.SourceType), AssetID: assetID})
	}
	return row, inputs, nil
}

func runDomainFromRows(row runRow, inputs []runInputRow) domainimagegeneration.Run {
	run := domainimagegeneration.Run{
		TaskRunID: row.TaskRunID.String(), TenantID: row.TenantID, ProjectID: row.InvocationProjectID, WorkspaceID: row.WorkspaceID,
		Target:         domainimagegeneration.TargetRef{Type: domainimagegeneration.TargetType(row.TargetType), ID: row.TargetID.String(), Revision: row.TargetRevision},
		Config:         domainimagegeneration.Config{Prompt: row.Prompt, ModelID: row.ModelID, Resolution: domainimagegeneration.Resolution(row.Resolution), AspectRatio: domainimagegeneration.AspectRatio(row.AspectRatio), Watermark: row.Watermark},
		InputSnapshots: append([]domaingenerationinput.Input(nil), row.InputSnapshots...),
		OutputOwner:    domainimagegeneration.OutputAssetOwner{Type: domainasset.OwnerType(row.OutputOwnerType), ID: row.OutputOwnerID.String()},
		BindingOutcome: domainimagegeneration.BindingOutcome(row.BindingOutcome), Stage: row.Stage,
		ProviderAttempt: row.ProviderAttempt, ProviderImageURL: row.ProviderImageURL,
		SourceAssetID: row.SourceAssetID, SourceRevisionID: row.SourceRevisionID, ArtifactSizeBytes: row.ArtifactSizeBytes,
		ErrorCode: row.ErrorCode, ErrorMessage: row.ErrorMessage,
		CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, CompletedAt: row.CompletedAt,
	}
	if row.OutputAssetID != nil {
		run.OutputAssetID = row.OutputAssetID.String()
	}
	for _, input := range inputs {
		run.Inputs = append(run.Inputs, domainimagegeneration.ResolvedInput{Position: input.Position, SourceType: domainimagegeneration.InputSourceType(input.SourceType), AssetID: input.AssetID.String()})
	}
	return run
}

func scopedRunQuery(db *gorm.DB, scope applicationimagegeneration.Scope) *gorm.DB {
	query := db.Where("tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return query.Where("workspace_id IS NULL")
	}
	return query.Where("workspace_id = ?", *scope.WorkspaceID)
}

func readError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return applicationimagegeneration.ErrNotFound
	}
	return err
}
