package videogeneration

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	applicationfirstlastframe "github.com/example/monorepo/canvas/internal/application/firstlastframe"
	app "github.com/example/monorepo/canvas/internal/application/videogeneration"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

func (r *Repository) CreateGeneration(ctx context.Context, generation domainvideo.Generation) error {
	row, err := toCanvasNodeVideoGenerationRow(generation)
	if err != nil {
		return err
	}
	return r.dbFor(ctx).Create(&row).Error
}

func (r *Repository) GetGeneration(ctx context.Context, scope app.Scope, taskRunID string) (domainvideo.Generation, error) {
	return r.getCanvasNodeVideoGeneration(ctx, scope, taskRunID, false)
}

func (r *Repository) GetVisibleGeneration(ctx context.Context, scope app.Scope, taskRunID string) (domainvideo.Generation, error) {
	return r.getCanvasNodeVideoGeneration(ctx, scope, taskRunID, true)
}

// BatchGetProviderStatuses reads provider observations independently of TaskRun status.
func (r *Repository) BatchGetProviderStatuses(ctx context.Context, scope app.Scope, taskRunIDs []string) (map[string]domainvideo.ProviderStatus, error) {
	ids := persistenceid.ParseValid(taskRunIDs)
	result := make(map[string]domainvideo.ProviderStatus, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var rows []struct {
		TaskRunID      persistenceid.UUID
		ProviderStatus domainvideo.ProviderStatus
	}
	if err := scopeQuery(r.dbFor(ctx).Model(&canvasnodeVideoGenerationRow{}), scope).
		Select("task_run_id", "provider_status").Where("task_run_id IN ? AND hidden_at IS NULL", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.TaskRunID.String()] = row.ProviderStatus
	}
	return result, nil
}

func (r *Repository) BatchGetFailedProviderFacts(
	ctx context.Context,
	scope app.Scope,
	generationTaskRunIDs []string,
) (map[string]app.FailedProviderFacts, error) {
	ids := persistenceid.ParseValid(generationTaskRunIDs)
	result := make(map[string]app.FailedProviderFacts, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var rows []struct {
		TaskRunID         persistenceid.UUID
		ProviderErrorCode string
		RealTaskID        *string
	}
	query := scopeQuery(r.dbFor(ctx).Model(&canvasnodeVideoGenerationRow{}), scope)
	if err := query.
		Select("task_run_id", "provider_error_code", "real_task_id").
		Where("task_run_id IN ? AND hidden_at IS NULL AND provider_status = ?", ids, domainvideo.ProviderStatusFailed).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.TaskRunID.String()] = app.FailedProviderFacts{
			ErrorCode: strings.TrimSpace(row.ProviderErrorCode), SeedanceTaskID: strings.TrimSpace(nullableStringValue(row.RealTaskID)),
		}
	}
	return result, nil
}

func (r *Repository) GetByFirstLastFrameTaskRunID(ctx context.Context, taskRunID string) (applicationfirstlastframe.Generation, error) {
	return r.getByFirstLastFrameTaskRunID(ctx, taskRunID, false)
}

func (r *Repository) GetByFirstLastFrameTaskRunIDForUpdate(ctx context.Context, taskRunID string) (applicationfirstlastframe.Generation, error) {
	return r.getByFirstLastFrameTaskRunID(ctx, taskRunID, true)
}

func (r *Repository) getByFirstLastFrameTaskRunID(ctx context.Context, taskRunID string, lock bool) (applicationfirstlastframe.Generation, error) {
	if _, err := persistenceid.Parse(taskRunID); err != nil {
		return applicationfirstlastframe.Generation{}, app.ErrNotFound
	}
	var row canvasnodeVideoGenerationRow
	query := r.dbFor(ctx).Where("first_last_frame_task_run_id = ? AND hidden_at IS NULL", taskRunID)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.First(&row).Error; err != nil {
		return applicationfirstlastframe.Generation{}, canvasnodeVideoGenerationReadErr(err)
	}
	assetLocator := struct {
		ArtifactID        string
		ArtifactNamespace *string
	}{}
	if row.AssetID == nil {
		return applicationfirstlastframe.Generation{}, app.ErrNotFound
	}
	assetQuery := r.dbFor(ctx).Table("assets").Select("artifact_id, artifact_namespace").Where(
		"id = ? AND tenant_id = ? AND owner_type = ? AND owner_id = ? AND media_type = ? AND deleted_at = 0",
		*row.AssetID, row.TenantID, domainasset.OwnerProject, row.ProjectID, domainasset.MediaVideo,
	)
	if row.WorkspaceID == nil {
		assetQuery = assetQuery.Where("workspace_id IS NULL")
	} else {
		assetQuery = assetQuery.Where("workspace_id = ?", *row.WorkspaceID)
	}
	result := assetQuery.Scan(&assetLocator)
	if result.Error != nil {
		return applicationfirstlastframe.Generation{}, result.Error
	}
	if strings.TrimSpace(assetLocator.ArtifactID) == "" {
		return applicationfirstlastframe.Generation{}, app.ErrNotFound
	}
	generation := applicationfirstlastframe.Generation{
		GenerationTaskRunID: row.TaskRunID.String(), TenantID: row.TenantID, ProjectID: row.ProjectID.String(),
		WorkspaceID: row.WorkspaceID, CreatedBy: row.CreatedBy,
		SourceArtifactID: assetLocator.ArtifactID, SourceArtifactNamespace: nullableStringValue(assetLocator.ArtifactNamespace),
		FirstLastFrameTaskRunID: nullableStringValue(row.FirstLastFrameTaskRunID),
		FirstFrameCheckpointID:  nullableStringValue(row.FirstFrameCheckpointID), LastFrameCheckpointID: nullableStringValue(row.LastFrameCheckpointID),
		FirstFrameCheckpointSizeBytes: row.FirstFrameCheckpointSizeBytes, LastFrameCheckpointSizeBytes: row.LastFrameCheckpointSizeBytes,
		FirstFrameAssetID: nullableUUIDValue(row.FirstFrameAssetID), LastFrameAssetID: nullableUUIDValue(row.LastFrameAssetID),
		GenerationStatus: domaintask.Status(row.Status),
	}
	return generation, nil
}

func (r *Repository) RecordArtifactCheckpoint(ctx context.Context, generationTaskRunID, firstLastFrameTaskRunID string, checkpoint applicationfirstlastframe.Result, updatedAt time.Time) (bool, error) {
	generationID, err := persistenceid.Parse(generationTaskRunID)
	if err != nil {
		return false, app.ErrNotFound
	}
	updates := map[string]any{"updated_at": updatedAt}
	query := r.dbFor(ctx).Model(&canvasnodeVideoGenerationRow{}).
		Where("task_run_id = ? AND first_last_frame_task_run_id = ? AND hidden_at IS NULL AND first_frame_asset_id IS NULL AND last_frame_asset_id IS NULL", generationID, firstLastFrameTaskRunID)
	if checkpoint.FirstFrameArtifactID != "" {
		query = query.Where("first_frame_checkpoint_id IS NULL OR (first_frame_checkpoint_id = ? AND first_frame_checkpoint_size_bytes = ?)", checkpoint.FirstFrameArtifactID, checkpoint.FirstFrameSizeBytes)
		updates["first_frame_checkpoint_id"] = checkpoint.FirstFrameArtifactID
		updates["first_frame_checkpoint_size_bytes"] = checkpoint.FirstFrameSizeBytes
	}
	if checkpoint.LastFrameArtifactID != "" {
		query = query.Where("last_frame_checkpoint_id IS NULL OR (last_frame_checkpoint_id = ? AND last_frame_checkpoint_size_bytes = ?)", checkpoint.LastFrameArtifactID, checkpoint.LastFrameSizeBytes)
		updates["last_frame_checkpoint_id"] = checkpoint.LastFrameArtifactID
		updates["last_frame_checkpoint_size_bytes"] = checkpoint.LastFrameSizeBytes
	}
	result := query.Updates(updates)
	affected := result.RowsAffected
	if result.Error != nil || affected == 1 {
		return affected == 1, result.Error
	}
	var row canvasnodeVideoGenerationRow
	if err = r.dbFor(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("task_run_id = ? AND first_last_frame_task_run_id = ?", generationID, firstLastFrameTaskRunID).
		First(&row).Error; err != nil {
		return false, canvasnodeVideoGenerationReadErr(err)
	}
	return (checkpoint.FirstFrameArtifactID == "" || nullableStringValue(row.FirstFrameCheckpointID) == checkpoint.FirstFrameArtifactID) &&
		(checkpoint.FirstFrameArtifactID == "" || row.FirstFrameCheckpointSizeBytes == checkpoint.FirstFrameSizeBytes) &&
		(checkpoint.LastFrameArtifactID == "" || nullableStringValue(row.LastFrameCheckpointID) == checkpoint.LastFrameArtifactID) &&
		(checkpoint.LastFrameArtifactID == "" || row.LastFrameCheckpointSizeBytes == checkpoint.LastFrameSizeBytes) &&
		row.FirstFrameAssetID == nil && row.LastFrameAssetID == nil, nil
}

func (r *Repository) CommitAssets(ctx context.Context, generationTaskRunID, firstLastFrameTaskRunID string, result applicationfirstlastframe.Result, firstAssetID, lastAssetID string, updatedAt time.Time) (bool, error) {
	generationID, err := persistenceid.Parse(generationTaskRunID)
	if err != nil {
		return false, app.ErrNotFound
	}
	firstID, err := persistenceid.Parse(firstAssetID)
	if err != nil {
		return false, err
	}
	lastID, err := persistenceid.Parse(lastAssetID)
	if err != nil {
		return false, err
	}
	update := r.dbFor(ctx).Model(&canvasnodeVideoGenerationRow{}).
		Where("task_run_id = ? AND first_last_frame_task_run_id = ? AND hidden_at IS NULL AND first_frame_checkpoint_id = ? AND first_frame_checkpoint_size_bytes = ? AND last_frame_checkpoint_id = ? AND last_frame_checkpoint_size_bytes = ? AND first_frame_asset_id IS NULL AND last_frame_asset_id IS NULL", generationID, firstLastFrameTaskRunID, result.FirstFrameArtifactID, result.FirstFrameSizeBytes, result.LastFrameArtifactID, result.LastFrameSizeBytes).
		Updates(map[string]any{
			"first_frame_asset_id": firstID,
			"last_frame_asset_id":  lastID,
			"updated_at":           updatedAt,
		})
	return update.RowsAffected == 1, update.Error
}

func (r *Repository) getCanvasNodeVideoGeneration(ctx context.Context, scope app.Scope, taskRunID string, visibleOnly bool) (domainvideo.Generation, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return domainvideo.Generation{}, app.ErrNotFound
	}
	var row canvasnodeVideoGenerationRow
	query := scopeQuery(r.dbFor(ctx), scope).Where("task_run_id = ?", id)
	if visibleOnly {
		query = query.Where("hidden_at IS NULL")
	}
	if err = query.First(&row).Error; err != nil {
		return domainvideo.Generation{}, canvasnodeVideoGenerationReadErr(err)
	}
	return fromCanvasNodeVideoGenerationRow(row), nil
}

func (r *Repository) HideGenerations(ctx context.Context, scope app.Scope, canvasnodeIDs []string, hiddenAt time.Time) ([]string, error) {
	if hiddenAt.IsZero() {
		return nil, errors.New("invalid canvasnode video generation visibility update")
	}
	ids := make([]persistenceid.UUID, 0, len(canvasnodeIDs))
	seen := make(map[persistenceid.UUID]struct{}, len(canvasnodeIDs))
	for _, raw := range canvasnodeIDs {
		id, err := persistenceid.Parse(raw)
		if err != nil {
			return nil, err
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil, nil
	}
	var hiddenRunIDs []string
	err := r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []canvasnodeVideoGenerationRow
		if err := scopeQuery(tx, scope).
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("node_id IN ? AND hidden_at IS NULL", ids).
			Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		rowIDs := make([]persistenceid.UUID, 0, len(rows))
		for index := range rows {
			rowIDs = append(rowIDs, rows[index].TaskRunID)
			hiddenRunIDs = append(hiddenRunIDs, rows[index].TaskRunID.String())
		}
		return tx.Model(&canvasnodeVideoGenerationRow{}).
			Where("task_run_id IN ? AND hidden_at IS NULL", rowIDs).
			Update("hidden_at", hiddenAt).Error
	})
	if err != nil {
		return nil, err
	}
	return hiddenRunIDs, nil
}

func (r *Repository) MarkGenerationSubmitted(ctx context.Context, taskRunID, taskID string, updatedAt time.Time) error {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return app.ErrNotFound
	}
	result := r.dbFor(ctx).Model(&canvasnodeVideoGenerationRow{}).Where("task_run_id = ?", id).Updates(map[string]any{
		"provider_task_id": nullableString(taskID), "provider_status": domainvideo.ProviderStatusQueued, "updated_at": updatedAt,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return r.ensureCanvasNodeVideoGenerationExists(ctx, id)
	}
	return nil
}

func (r *Repository) AttachFirstLastFrameTask(ctx context.Context, generationTaskRunID, firstLastFrameTaskRunID string, updatedAt time.Time) (bool, error) {
	generationID, err := persistenceid.Parse(generationTaskRunID)
	if err != nil {
		return false, app.ErrNotFound
	}
	if _, err = persistenceid.Parse(firstLastFrameTaskRunID); err != nil {
		return false, err
	}
	result := r.dbFor(ctx).Model(&canvasnodeVideoGenerationRow{}).
		Where("task_run_id = ? AND first_last_frame_task_run_id IS NULL", generationID).
		Updates(map[string]any{"first_last_frame_task_run_id": firstLastFrameTaskRunID, "updated_at": updatedAt})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) UpdateGenerationProviderObservation(
	ctx context.Context,
	taskRunID string,
	status domainvideo.ProviderStatus,
	videoURL string,
	outputDurationSeconds *int32,
	errorCode, errorMessage, seedanceTaskID string,
	updatedAt time.Time,
) error {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return app.ErrNotFound
	}
	updates := map[string]any{
		"provider_status": status, "provider_error_code": errorCode,
		"provider_error_message": errorMessage, "updated_at": updatedAt,
	}
	if videoURL != "" {
		updates["provider_video_url"] = videoURL
	}
	if outputDurationSeconds != nil {
		updates["output_duration_seconds"] = *outputDurationSeconds
	}
	if seedanceTaskID = strings.TrimSpace(seedanceTaskID); seedanceTaskID != "" {
		updates["real_task_id"] = seedanceTaskID
	}
	result := r.dbFor(ctx).Model(&canvasnodeVideoGenerationRow{}).Where("task_run_id = ?", id).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return r.ensureCanvasNodeVideoGenerationExists(ctx, id)
	}
	return nil
}

func (r *Repository) ensureCanvasNodeVideoGenerationExists(ctx context.Context, id persistenceid.UUID) error {
	var count int64
	if err := r.dbFor(ctx).Model(&canvasnodeVideoGenerationRow{}).
		Where("task_run_id = ?", id).
		Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return app.ErrNotFound
	}
	return nil
}

func toCanvasNodeVideoGenerationRow(generation domainvideo.Generation) (canvasnodeVideoGenerationRow, error) {
	taskRunID, err := persistenceid.Parse(generation.TaskRunID)
	if err != nil {
		return canvasnodeVideoGenerationRow{}, err
	}
	projectID, canvasID, canvasnodeID, err := parseHistoryScopeIDs(generation.ProjectID, generation.CanvasID, generation.NodeID)
	if err != nil {
		return canvasnodeVideoGenerationRow{}, err
	}
	if generation.AIGWTraceWorkspaceID == "" {
		return canvasnodeVideoGenerationRow{}, errors.New("aigw trace workspace is required")
	}
	assetID, err := nullableUUID(generation.AssetID)
	if err != nil {
		return canvasnodeVideoGenerationRow{}, err
	}
	firstFrameAssetID, err := nullableUUID(generation.FirstFrameAssetID)
	if err != nil {
		return canvasnodeVideoGenerationRow{}, err
	}
	lastFrameAssetID, err := nullableUUID(generation.LastFrameAssetID)
	if err != nil {
		return canvasnodeVideoGenerationRow{}, err
	}
	return canvasnodeVideoGenerationRow{
		TaskRunID: taskRunID, TenantID: generation.TenantID, WorkspaceID: generation.WorkspaceID,
		ProjectID: projectID, CanvasID: canvasID, NodeID: canvasnodeID,
		Status:         generation.Status,
		ProviderStatus: string(generation.ProviderStatus),
		ModelServiceID: generation.ModelServiceID,
		Resolution:     int16(generation.Resolution), AspectRatio: int16(generation.AspectRatio),
		DurationSeconds: generation.DurationSeconds, GenerateAudio: generation.GenerateAudio, Watermark: generation.Watermark,
		OutputDurationSeconds: generation.OutputDurationSeconds,
		Prompt:                generation.Prompt, AIGWTraceWorkspaceID: generation.AIGWTraceWorkspaceID,
		ProviderTaskID: nullableString(generation.ProviderTaskID), SeedanceTaskID: nullableString(generation.SeedanceTaskID),
		ProviderVideoURL:  generation.ProviderVideoURL,
		ProviderErrorCode: generation.ProviderErrorCode, ProviderErrorMessage: generation.ProviderErrorMessage,
		AssetID:                 assetID,
		FirstLastFrameTaskRunID: nullableString(generation.FirstLastFrameTaskRunID),
		FirstFrameCheckpointID:  nullableString(generation.FirstFrameCheckpointID), LastFrameCheckpointID: nullableString(generation.LastFrameCheckpointID),
		FirstFrameCheckpointSizeBytes: generation.FirstFrameCheckpointSizeBytes,
		LastFrameCheckpointSizeBytes:  generation.LastFrameCheckpointSizeBytes,
		FirstFrameAssetID:             firstFrameAssetID, LastFrameAssetID: lastFrameAssetID,
		Inputs:       generation.Inputs,
		ErrorMessage: generation.ErrorMessage,
		CreatedBy:    generation.CreatedBy, CompletedAt: generation.CompletedAt,
		CreatedAt: generation.CreatedAt, UpdatedAt: generation.UpdatedAt,
	}, nil
}

func fromCanvasNodeVideoGenerationRow(row canvasnodeVideoGenerationRow) domainvideo.Generation {
	generation := domainvideo.Generation{
		TaskRunID: row.TaskRunID.String(), TenantID: row.TenantID, WorkspaceID: row.WorkspaceID,
		ProjectID: row.ProjectID.String(), CanvasID: row.CanvasID.String(), NodeID: row.NodeID.String(),
		Status:         row.Status,
		ProviderStatus: domainvideo.ProviderStatus(row.ProviderStatus),
		ModelServiceID: row.ModelServiceID,
		Prompt:         row.Prompt, Resolution: domainvideo.Resolution(row.Resolution), AspectRatio: domainvideo.AspectRatio(row.AspectRatio),
		DurationSeconds: row.DurationSeconds, GenerateAudio: row.GenerateAudio, Watermark: row.Watermark,
		OutputDurationSeconds: row.OutputDurationSeconds,
		AIGWTraceWorkspaceID:  row.AIGWTraceWorkspaceID, ProviderVideoURL: row.ProviderVideoURL,
		ProviderErrorCode: row.ProviderErrorCode, ProviderErrorMessage: row.ProviderErrorMessage,
		ErrorMessage: row.ErrorMessage, CreatedBy: row.CreatedBy, CompletedAt: row.CompletedAt,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
	if row.ProviderTaskID != nil {
		generation.ProviderTaskID = *row.ProviderTaskID
	}
	if row.SeedanceTaskID != nil {
		generation.SeedanceTaskID = *row.SeedanceTaskID
	}
	generation.AssetID = nullableUUIDValue(row.AssetID)
	if row.FirstLastFrameTaskRunID != nil {
		generation.FirstLastFrameTaskRunID = *row.FirstLastFrameTaskRunID
	}
	if row.FirstFrameCheckpointID != nil {
		generation.FirstFrameCheckpointID = *row.FirstFrameCheckpointID
	}
	if row.LastFrameCheckpointID != nil {
		generation.LastFrameCheckpointID = *row.LastFrameCheckpointID
	}
	generation.FirstFrameCheckpointSizeBytes = row.FirstFrameCheckpointSizeBytes
	generation.LastFrameCheckpointSizeBytes = row.LastFrameCheckpointSizeBytes
	generation.FirstFrameAssetID = nullableUUIDValue(row.FirstFrameAssetID)
	generation.LastFrameAssetID = nullableUUIDValue(row.LastFrameAssetID)
	generation.Inputs = append([]domaingenerationinput.Input(nil), row.Inputs...)
	return generation
}

func nullableUUID(value string) (*persistenceid.UUID, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := persistenceid.Parse(value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func nullableUUIDValue(value *persistenceid.UUID) string {
	if value == nil {
		return ""
	}
	return value.String()
}

func canvasnodeVideoGenerationReadErr(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return app.ErrNotFound
	}
	return err
}

func nullableStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
