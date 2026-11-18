package videogeneration

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	applicationfirstlastframe "github.com/example/monorepo/canvas/internal/application/firstlastframe"
	app "github.com/example/monorepo/canvas/internal/application/videogeneration"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"
)

func (r *Repository) CreateGeneration(ctx context.Context, generation domainvideo.Generation) (err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error { return r.createGenerationInTransaction(ctx, generation) })
	return
}

func (r *Repository) createGenerationInTransaction(ctx context.Context, generation domainvideo.Generation) error {
	row, err := toCanvasNodeVideoGenerationRow(generation)
	if err != nil {
		return err
	}
	return r.store.Queries(ctx).VideoGenCreate(ctx, sqlc.VideoGenCreateParams(row))
}

func (r *Repository) GetGeneration(ctx context.Context, scope app.Scope, taskRunID string) (domainvideo.Generation, error) {
	return r.getCanvasNodeVideoGeneration(ctx, scope, taskRunID, false)
}

func (r *Repository) GetVisibleGeneration(ctx context.Context, scope app.Scope, taskRunID string) (domainvideo.Generation, error) {
	return r.getCanvasNodeVideoGeneration(ctx, scope, taskRunID, true)
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
	var err error
	if lock {
		row, err = r.store.Queries(ctx).VideoGenByFrameLocked(ctx, &taskRunID)
	} else {
		row, err = r.store.Queries(ctx).VideoGenByFrame(ctx, &taskRunID)
	}
	if err != nil {
		return applicationfirstlastframe.Generation{}, canvasnodeVideoGenerationReadErr(err)
	}
	if row.AssetID == nil {
		return applicationfirstlastframe.Generation{}, app.ErrNotFound
	}
	assetLocator, err := r.store.Queries(ctx).VideoGenLocator(ctx, sqlc.VideoGenLocatorParams{
		TenantID:    row.TenantID,
		WorkspaceID: row.WorkspaceID,
		ID:          *row.AssetID,
		OwnerType:   int16(domainasset.OwnerProject),
		OwnerID:     row.ProjectID,
		MediaType:   int16(domainasset.MediaVideo),
	})
	if err != nil {
		return applicationfirstlastframe.Generation{}, canvasnodeVideoGenerationReadErr(err)
	}
	if strings.TrimSpace(assetLocator.SourceAssetID) == "" {
		return applicationfirstlastframe.Generation{}, app.ErrNotFound
	}
	generation := applicationfirstlastframe.Generation{
		GenerationTaskRunID: row.TaskRunID, TenantID: row.TenantID, ProjectID: row.ProjectID,
		WorkspaceID: row.WorkspaceID, CreatedBy: row.CreatedBy,
		SourceSourceAssetID: assetLocator.SourceAssetID, SourceSourceRevisionID: assetLocator.SourceRevisionID,
		FirstLastFrameTaskRunID:        nullableStringValue(row.FirstLastFrameTaskRunID),
		FirstFrameCheckpointAssetID:    nullableStringValue(row.FirstFrameCheckpointAssetID),
		FirstFrameCheckpointRevisionID: nullableStringValue(row.FirstFrameCheckpointRevisionID),
		LastFrameCheckpointAssetID:     nullableStringValue(row.LastFrameCheckpointAssetID),
		LastFrameCheckpointRevisionID:  nullableStringValue(row.LastFrameCheckpointRevisionID),
		FirstFrameCheckpointSizeBytes:  row.FirstFrameCheckpointSizeBytes, LastFrameCheckpointSizeBytes: row.LastFrameCheckpointSizeBytes,
		FirstFrameAssetID: nullableStringValue(row.FirstFrameAssetID), LastFrameAssetID: nullableStringValue(row.LastFrameAssetID),
		GenerationStatus: domaintask.Status(row.Status),
	}
	return generation, nil
}

func (r *Repository) RecordArtifactCheckpoint(ctx context.Context, generationTaskRunID, firstLastFrameTaskRunID string, checkpoint applicationfirstlastframe.Result, updatedAt time.Time) (matched bool, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		matched, err = r.recordArtifactCheckpointInTransaction(ctx, generationTaskRunID, firstLastFrameTaskRunID, checkpoint, updatedAt)
		return err
	})
	return
}

func (r *Repository) recordArtifactCheckpointInTransaction(ctx context.Context, generationTaskRunID, firstLastFrameTaskRunID string, checkpoint applicationfirstlastframe.Result, updatedAt time.Time) (bool, error) {
	generationID, err := persistenceid.Parse(generationTaskRunID)
	if err != nil {
		return false, app.ErrNotFound
	}
	affected, err := r.store.Queries(ctx).VideoGenCheckpoint(ctx, sqlc.VideoGenCheckpointParams{
		UpdatedAt:     updatedAt,
		FirstAsset:    nullableString(checkpoint.FirstFrameSourceAssetID),
		FirstRevision: &checkpoint.FirstFrameSourceRevisionID,
		FirstSize:     checkpoint.FirstFrameSizeBytes,
		LastAsset:     nullableString(checkpoint.LastFrameSourceAssetID),
		LastRevision:  &checkpoint.LastFrameSourceRevisionID,
		LastSize:      checkpoint.LastFrameSizeBytes,
		ID:            generationID.String(),
		FrameTaskID:   &firstLastFrameTaskRunID,
	})
	if err != nil || affected == 1 {
		return affected == 1, err
	}
	row, err := r.store.Queries(ctx).VideoGenCheckpointLocked(ctx, sqlc.VideoGenCheckpointLockedParams{ID: generationID.String(), FrameTaskID: &firstLastFrameTaskRunID})
	if err != nil {
		return false, canvasnodeVideoGenerationReadErr(err)
	}
	return (checkpoint.FirstFrameSourceAssetID == "" || nullableStringValue(row.FirstFrameCheckpointAssetID) == checkpoint.FirstFrameSourceAssetID) &&
		(checkpoint.FirstFrameSourceAssetID == "" || nullableStringValue(row.FirstFrameCheckpointRevisionID) == checkpoint.FirstFrameSourceRevisionID) &&
		(checkpoint.FirstFrameSourceAssetID == "" || row.FirstFrameCheckpointSizeBytes == checkpoint.FirstFrameSizeBytes) &&
		(checkpoint.LastFrameSourceAssetID == "" || nullableStringValue(row.LastFrameCheckpointAssetID) == checkpoint.LastFrameSourceAssetID) &&
		(checkpoint.LastFrameSourceAssetID == "" || nullableStringValue(row.LastFrameCheckpointRevisionID) == checkpoint.LastFrameSourceRevisionID) &&
		(checkpoint.LastFrameSourceAssetID == "" || row.LastFrameCheckpointSizeBytes == checkpoint.LastFrameSizeBytes) &&
		row.FirstFrameAssetID == nil && row.LastFrameAssetID == nil, nil
}

func (r *Repository) CommitAssets(ctx context.Context, generationTaskRunID, firstLastFrameTaskRunID string, result applicationfirstlastframe.Result, firstAssetID, lastAssetID string, updatedAt time.Time) (matched bool, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		matched, err = r.commitAssetsInTransaction(ctx, generationTaskRunID, firstLastFrameTaskRunID, result, firstAssetID, lastAssetID, updatedAt)
		return err
	})
	return
}

func (r *Repository) commitAssetsInTransaction(ctx context.Context, generationTaskRunID, firstLastFrameTaskRunID string, result applicationfirstlastframe.Result, firstAssetID, lastAssetID string, updatedAt time.Time) (bool, error) {
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
	affected, err := r.store.Queries(ctx).VideoGenCommitFrames(ctx, sqlc.VideoGenCommitFramesParams{
		FirstID:       nullableString(firstID.String()),
		LastID:        nullableString(lastID.String()),
		UpdatedAt:     updatedAt,
		ID:            generationID.String(),
		FrameTaskID:   &firstLastFrameTaskRunID,
		FirstAsset:    nullableString(result.FirstFrameSourceAssetID),
		FirstRevision: &result.FirstFrameSourceRevisionID,
		FirstSize:     result.FirstFrameSizeBytes,
		LastAsset:     nullableString(result.LastFrameSourceAssetID),
		LastRevision:  &result.LastFrameSourceRevisionID,
		LastSize:      result.LastFrameSizeBytes,
	})
	return affected == 1, err
}

func (r *Repository) getCanvasNodeVideoGeneration(ctx context.Context, scope app.Scope, taskRunID string, visibleOnly bool) (domainvideo.Generation, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return domainvideo.Generation{}, app.ErrNotFound
	}
	row, err := r.store.Queries(ctx).VideoGenGet(ctx, sqlc.VideoGenGetParams{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ID: id.String(), VisibleOnly: visibleOnly})
	if err != nil {
		return domainvideo.Generation{}, canvasnodeVideoGenerationReadErr(err)
	}
	return fromCanvasNodeVideoGenerationRow(row)
}

func (r *Repository) HideGenerations(ctx context.Context, scope app.Scope, canvasnodeIDs []string, hiddenAt time.Time) (ids []string, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		ids, err = r.hideGenerationsInTransaction(ctx, scope, canvasnodeIDs, hiddenAt)
		return err
	})
	return
}

func (r *Repository) hideGenerationsInTransaction(ctx context.Context, scope app.Scope, canvasnodeIDs []string, hiddenAt time.Time) ([]string, error) {
	if hiddenAt.IsZero() {
		return nil, errors.New("invalid canvasnode video generation visibility update")
	}
	ids := make([]string, 0, len(canvasnodeIDs))
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
		ids = append(ids, id.String())
	}
	if len(ids) == 0 {
		return nil, nil
	}
	return r.store.Queries(ctx).VideoGenHide(ctx, sqlc.VideoGenHideParams{HiddenAt: &hiddenAt, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, Ids: ids})
}

func (r *Repository) MarkGenerationSubmitted(ctx context.Context, taskRunID, taskID string, updatedAt time.Time) (err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		return r.markGenerationSubmittedInTransaction(ctx, taskRunID, taskID, updatedAt)
	})
	return
}

func (r *Repository) markGenerationSubmittedInTransaction(ctx context.Context, taskRunID, taskID string, updatedAt time.Time) error {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return app.ErrNotFound
	}
	affected, err := r.store.Queries(ctx).VideoGenSubmit(ctx, sqlc.VideoGenSubmitParams{
		ProviderTaskID: nullableString(taskID),
		ProviderStatus: string(domainvideo.ProviderStatusQueued),
		UpdatedAt:      updatedAt,
		ID:             id.String(),
	})
	if err != nil {
		return err
	}
	if affected == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repository) AttachFirstLastFrameTask(ctx context.Context, generationTaskRunID, firstLastFrameTaskRunID string, updatedAt time.Time) (matched bool, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		matched, err = r.attachFirstLastFrameTaskInTransaction(ctx, generationTaskRunID, firstLastFrameTaskRunID, updatedAt)
		return err
	})
	return
}

func (r *Repository) attachFirstLastFrameTaskInTransaction(ctx context.Context, generationTaskRunID, firstLastFrameTaskRunID string, updatedAt time.Time) (bool, error) {
	generationID, err := persistenceid.Parse(generationTaskRunID)
	if err != nil {
		return false, app.ErrNotFound
	}
	if _, err = persistenceid.Parse(firstLastFrameTaskRunID); err != nil {
		return false, err
	}
	affected, err := r.store.Queries(ctx).VideoGenAttach(ctx, sqlc.VideoGenAttachParams{FrameTaskID: &firstLastFrameTaskRunID, UpdatedAt: updatedAt, ID: generationID.String()})
	return affected == 1, err
}

func (r *Repository) UpdateGenerationProviderObservation(
	ctx context.Context,
	taskRunID string,
	status domainvideo.ProviderStatus,
	videoURL string,
	outputDurationSeconds *int32,
	errorCode, errorMessage, seedanceTaskID string,
	updatedAt time.Time,
) (err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		return r.updateGenerationProviderObservationInTransaction(ctx, taskRunID, status, videoURL, outputDurationSeconds, errorCode, errorMessage, seedanceTaskID, updatedAt)
	})
	return
}

func (r *Repository) updateGenerationProviderObservationInTransaction(
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
	affected, err := r.store.Queries(ctx).VideoGenObserve(ctx, sqlc.VideoGenObserveParams{
		Status:       string(status),
		ErrorCode:    errorCode,
		ErrorMessage: errorMessage,
		UpdatedAt:    updatedAt,
		Url:          nullableString(videoURL),
		Duration:     outputDurationSeconds,
		RealTaskID:   nullableString(strings.TrimSpace(seedanceTaskID)),
		ID:           id.String(),
	})
	if err != nil {
		return err
	}
	if affected == 0 {
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
	if generation.ProviderWorkspaceID == "" {
		return canvasnodeVideoGenerationRow{}, errors.New("provider trace workspace is required")
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
	inputs, err := json.Marshal(generation.Inputs)
	if err != nil {
		return canvasnodeVideoGenerationRow{}, err
	}
	return canvasnodeVideoGenerationRow{
		TaskRunID: taskRunID.String(), TenantID: generation.TenantID, WorkspaceID: generation.WorkspaceID,
		ProjectID: projectID.String(), CanvasID: canvasID.String(), NodeID: canvasnodeID.String(),
		Status:         generation.Status,
		ProviderStatus: string(generation.ProviderStatus),
		ModelServiceID: generation.ModelServiceID,
		Resolution:     int16(generation.Resolution), AspectRatio: int16(generation.AspectRatio),
		DurationSeconds: generation.DurationSeconds, GenerateAudio: generation.GenerateAudio, Watermark: generation.Watermark,
		OutputDurationSeconds: generation.OutputDurationSeconds,
		Prompt:                generation.Prompt, ProviderWorkspaceID: generation.ProviderWorkspaceID,
		ProviderTaskID: nullableString(generation.ProviderTaskID), RealTaskID: nullableString(generation.SeedanceTaskID),
		ProviderVideoUrl:  generation.ProviderVideoURL,
		ProviderErrorCode: generation.ProviderErrorCode, ProviderErrorMessage: generation.ProviderErrorMessage,
		AssetID:                        assetID,
		FirstLastFrameTaskRunID:        nullableString(generation.FirstLastFrameTaskRunID),
		FirstFrameCheckpointAssetID:    nullableString(generation.FirstFrameCheckpointAssetID),
		FirstFrameCheckpointRevisionID: nullableString(generation.FirstFrameCheckpointRevisionID),
		LastFrameCheckpointAssetID:     nullableString(generation.LastFrameCheckpointAssetID),
		LastFrameCheckpointRevisionID:  nullableString(generation.LastFrameCheckpointRevisionID),
		FirstFrameCheckpointSizeBytes:  generation.FirstFrameCheckpointSizeBytes,
		LastFrameCheckpointSizeBytes:   generation.LastFrameCheckpointSizeBytes,
		FirstFrameAssetID:              firstFrameAssetID, LastFrameAssetID: lastFrameAssetID,
		Inputs:       inputs,
		ErrorMessage: generation.ErrorMessage,
		CreatedBy:    generation.CreatedBy, CompletedAt: generation.CompletedAt,
		CreatedAt: generation.CreatedAt, UpdatedAt: generation.UpdatedAt,
	}, nil
}

func fromCanvasNodeVideoGenerationRow(row canvasnodeVideoGenerationRow) (domainvideo.Generation, error) {
	generation := domainvideo.Generation{
		TaskRunID: row.TaskRunID, TenantID: row.TenantID, WorkspaceID: row.WorkspaceID,
		ProjectID: row.ProjectID, CanvasID: row.CanvasID, NodeID: row.NodeID,
		Status:         row.Status,
		ProviderStatus: domainvideo.ProviderStatus(row.ProviderStatus),
		ModelServiceID: row.ModelServiceID,
		Prompt:         row.Prompt, Resolution: domainvideo.Resolution(row.Resolution), AspectRatio: domainvideo.AspectRatio(row.AspectRatio),
		DurationSeconds: row.DurationSeconds, GenerateAudio: row.GenerateAudio, Watermark: row.Watermark,
		OutputDurationSeconds: row.OutputDurationSeconds,
		ProviderWorkspaceID:   row.ProviderWorkspaceID, ProviderVideoURL: row.ProviderVideoUrl,
		ProviderErrorCode: row.ProviderErrorCode, ProviderErrorMessage: row.ProviderErrorMessage,
		ErrorMessage: row.ErrorMessage, CreatedBy: row.CreatedBy, CompletedAt: row.CompletedAt,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
	if row.ProviderTaskID != nil {
		generation.ProviderTaskID = *row.ProviderTaskID
	}
	if row.RealTaskID != nil {
		generation.SeedanceTaskID = *row.RealTaskID
	}
	generation.AssetID = nullableStringValue(row.AssetID)
	if row.FirstLastFrameTaskRunID != nil {
		generation.FirstLastFrameTaskRunID = *row.FirstLastFrameTaskRunID
	}
	if row.FirstFrameCheckpointAssetID != nil {
		generation.FirstFrameCheckpointAssetID = *row.FirstFrameCheckpointAssetID
	}
	if row.FirstFrameCheckpointRevisionID != nil {
		generation.FirstFrameCheckpointRevisionID = *row.FirstFrameCheckpointRevisionID
	}
	if row.LastFrameCheckpointAssetID != nil {
		generation.LastFrameCheckpointAssetID = *row.LastFrameCheckpointAssetID
	}
	if row.LastFrameCheckpointRevisionID != nil {
		generation.LastFrameCheckpointRevisionID = *row.LastFrameCheckpointRevisionID
	}
	generation.FirstFrameCheckpointSizeBytes = row.FirstFrameCheckpointSizeBytes
	generation.LastFrameCheckpointSizeBytes = row.LastFrameCheckpointSizeBytes
	generation.FirstFrameAssetID = nullableStringValue(row.FirstFrameAssetID)
	generation.LastFrameAssetID = nullableStringValue(row.LastFrameAssetID)
	if len(row.Inputs) > 0 {
		if err := json.Unmarshal(row.Inputs, &generation.Inputs); err != nil {
			return domainvideo.Generation{}, err
		}
	}
	return generation, nil
}

func nullableUUID(value string) (*string, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := persistenceid.Parse(value)
	if err != nil {
		return nil, err
	}
	return nullableString(parsed.String()), nil
}

func canvasnodeVideoGenerationReadErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
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
