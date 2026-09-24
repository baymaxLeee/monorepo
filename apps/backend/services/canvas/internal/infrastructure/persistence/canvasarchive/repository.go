package canvasarchive

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	app "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	"github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *gorm.DB }

const terminalAssociationCleanupGrace = 30 * time.Minute

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) dbFor(ctx context.Context) *gorm.DB {
	return persistencetransaction.DB(ctx, r.db)
}

func (r *Repository) Create(ctx context.Context, export app.Export, inputs []app.Input) error {
	row, err := exportToRow(export)
	if err != nil {
		return err
	}
	row.InputCount = int32(len(inputs))
	inputRow, err := inputsToRow(export.TaskRunID, inputs, export.CreatedAt)
	if err != nil {
		return err
	}
	return r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		return tx.Create(&inputRow).Error
	})
}

func (r *Repository) Get(
	ctx context.Context,
	scope app.Scope,
	projectID string,
	canvasID string,
	taskRunID string,
) (app.Export, error) {
	project, projectErr := persistenceid.Parse(projectID)
	canvas, canvasErr := persistenceid.Parse(canvasID)
	run, runErr := persistenceid.Parse(taskRunID)
	if projectErr != nil || canvasErr != nil || runErr != nil || scope.TenantID == "" {
		return app.Export{}, app.ErrNotFound
	}
	var row canvasVideoArchiveExportRow
	query := r.dbFor(ctx).Where(
		"task_run_id = ? AND tenant_id = ? AND project_id = ? AND canvas_id = ?",
		run, scope.TenantID, project, canvas,
	)
	query = applyWorkspaceScope(query, scope.WorkspaceID)
	if err := query.First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return app.Export{}, app.ErrNotFound
		}
		return app.Export{}, err
	}
	return exportFromRow(row), nil
}

func (r *Repository) GetByTaskRunID(ctx context.Context, taskRunID string) (app.Export, error) {
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return app.Export{}, app.ErrNotFound
	}
	var row canvasVideoArchiveExportRow
	if err = r.dbFor(ctx).Where("task_run_id = ?", run).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return app.Export{}, app.ErrNotFound
		}
		return app.Export{}, err
	}
	return exportFromRow(row), nil
}

func (r *Repository) BatchGet(ctx context.Context, scope app.Scope, projectID, canvasID string, taskRunIDs []string) ([]app.Export, error) {
	project, projectErr := persistenceid.Parse(projectID)
	canvas, canvasErr := persistenceid.Parse(canvasID)
	if projectErr != nil || canvasErr != nil || scope.TenantID == "" || len(taskRunIDs) == 0 {
		return []app.Export{}, nil
	}
	ids := make([]persistenceid.UUID, 0, len(taskRunIDs))
	order := make([]string, 0, len(taskRunIDs))
	seen := make(map[string]struct{}, len(taskRunIDs))
	for _, value := range taskRunIDs {
		id, err := persistenceid.Parse(value)
		if err != nil {
			continue
		}
		key := id.String()
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		ids = append(ids, id)
		order = append(order, key)
	}
	if len(ids) == 0 {
		return []app.Export{}, nil
	}
	var rows []canvasVideoArchiveExportRow
	query := r.dbFor(ctx).Where(
		"tenant_id = ? AND project_id = ? AND canvas_id = ? AND task_run_id IN ?", scope.TenantID, project, canvas, ids,
	)
	query = applyWorkspaceScope(query, scope.WorkspaceID)
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	byID := make(map[string]app.Export, len(rows))
	for index := range rows {
		item := exportFromRow(rows[index])
		byID[item.TaskRunID] = item
	}
	items := make([]app.Export, 0, len(rows))
	for _, id := range order {
		if item, exists := byID[id]; exists {
			items = append(items, item)
		}
	}
	return items, nil
}

func (r *Repository) List(ctx context.Context, query app.ListQuery) ([]app.Export, int64, error) {
	project, projectErr := persistenceid.Parse(query.ProjectID)
	canvas, canvasErr := persistenceid.Parse(query.CanvasID)
	if projectErr != nil || canvasErr != nil || query.TenantID == "" {
		return nil, 0, app.ErrNotFound
	}
	db := r.dbFor(ctx)
	base := db.Model(&canvasVideoArchiveExportRow{}).Where(
		"tenant_id = ? AND project_id = ? AND canvas_id = ?", query.TenantID, project, canvas,
	)
	base = applyWorkspaceScope(base, query.WorkspaceID)
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	direction := "DESC"
	if query.SortDirection == app.SortAscending {
		direction = "ASC"
	}
	var rows []canvasVideoArchiveExportRow
	offset := (query.PageNum - 1) * query.PageSize
	if err := base.Order("created_at " + direction).Order("task_run_id " + direction).
		Offset(offset).Limit(query.PageSize).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	items := make([]app.Export, 0, len(rows))
	for index := range rows {
		items = append(items, exportFromRow(rows[index]))
	}
	return items, total, nil
}

func (r *Repository) FindActive(ctx context.Context, scope app.Scope, projectID, canvasID string) (app.Export, error) {
	project, projectErr := persistenceid.Parse(projectID)
	canvas, canvasErr := persistenceid.Parse(canvasID)
	if projectErr != nil || canvasErr != nil || scope.TenantID == "" {
		return app.Export{}, app.ErrNotFound
	}
	var row canvasVideoArchiveExportRow
	query := r.dbFor(ctx).Where(
		"tenant_id = ? AND project_id = ? AND canvas_id = ? AND status IN ?",
		scope.TenantID, project, canvas, []string{string(task.StatusQueued), string(task.StatusRunning)},
	)
	query = applyWorkspaceScope(query, scope.WorkspaceID)
	if err := query.Order("created_at DESC").First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return app.Export{}, app.ErrNotFound
		}
		return app.Export{}, err
	}
	return exportFromRow(row), nil
}

func (r *Repository) SnapshotSelectedVideos(ctx context.Context, scope app.Scope, projectID, canvasID string) ([]app.SelectedVideo, error) {
	project, projectErr := persistenceid.Parse(projectID)
	canvas, canvasErr := persistenceid.Parse(canvasID)
	if projectErr != nil || canvasErr != nil || scope.TenantID == "" {
		return nil, app.ErrNotFound
	}
	db := r.dbFor(ctx)
	lock := db.Model(&archiveCanvasScopeRow{}).Clauses(clause.Locking{Strength: "UPDATE"}).Where(
		"id = ? AND tenant_id = ? AND project_id = ? AND deleted_at = 0", canvas, scope.TenantID, project,
	)
	lock = applyWorkspaceScope(lock, scope.WorkspaceID)
	var canvasRow archiveCanvasScopeRow
	if err := lock.First(&canvasRow).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, app.ErrNotFound
		}
		return nil, err
	}

	join := "LEFT JOIN canvas_node_generations AS generations ON generations.task_run_id = canvas_nodes.selected_output_id " +
		"AND generations.tenant_id = canvas_nodes.tenant_id AND generations.project_id = canvas_nodes.project_id " +
		"AND generations.canvas_id = canvas_nodes.canvas_id AND generations.node_id = canvas_nodes.id"
	joinArgs := make([]any, 0, 1)
	if scope.WorkspaceID == nil {
		join += " AND generations.workspace_id IS NULL"
	} else {
		join += " AND generations.workspace_id = ?"
		joinArgs = append(joinArgs, *scope.WorkspaceID)
	}
	assetJoin := "LEFT JOIN assets AS generation_assets ON generation_assets.id = generations.asset_id " +
		"AND generation_assets.id = canvas_nodes.selected_asset_id " +
		"AND generation_assets.tenant_id = generations.tenant_id " +
		"AND generation_assets.owner_type = ? AND generation_assets.owner_id = canvas_nodes.project_id " +
		"AND generation_assets.media_type = ? AND generation_assets.deleted_at = 0"
	assetJoinArgs := []any{domainasset.OwnerProject, domainasset.MediaVideo}
	if scope.WorkspaceID == nil {
		assetJoin += " AND generation_assets.workspace_id IS NULL"
	} else {
		assetJoin += " AND generation_assets.workspace_id = ?"
		assetJoinArgs = append(assetJoinArgs, *scope.WorkspaceID)
	}
	var rows []selectedVideoSnapshotRow
	query := db.Table("canvas_nodes").Select(
		"canvas_nodes.id AS node_id, canvas_nodes.selected_output_id AS output_id, "+
			"canvas_nodes.selected_asset_id AS asset_id, generation_assets.source_asset_id, "+
			"generation_assets.source_revision_id, generation_assets.size_bytes AS media_size, "+
			"generations.status AS generation_status",
	).Joins(
		join, joinArgs...,
	).Joins(assetJoin, assetJoinArgs...).Where(
		"canvas_nodes.tenant_id = ? AND canvas_nodes.project_id = ? AND canvas_nodes.canvas_id = ? AND canvas_nodes.type = ? AND canvas_nodes.deleted_at = 0 AND canvas_nodes.selected_output_id IS NOT NULL",
		scope.TenantID, project, canvas, domaincanvas.NodeTypeVideoGeneration,
	)
	if scope.WorkspaceID == nil {
		query = query.Where("canvas_nodes.workspace_id IS NULL")
	} else {
		query = query.Where("canvas_nodes.workspace_id = ?", *scope.WorkspaceID)
	}
	if err := query.Order("canvas_nodes.storyboard_rank ASC").Order("canvas_nodes.id ASC").Scan(&rows).Error; err != nil {
		return nil, err
	}
	selected := make([]app.SelectedVideo, 0, len(rows))
	for index := range rows {
		row := rows[index]
		if row.OutputID == nil || row.SourceAssetID == nil || *row.SourceAssetID == "" || row.GenerationStatus != string(task.StatusSucceeded) {
			return nil, app.ErrSelectedVideoUnavailable
		}
		selected = append(selected, app.SelectedVideo{
			CanvasName: canvasRow.Name, NodeID: row.NodeID.String(), OutputID: row.OutputID.String(),
			AssetID: optionalUUIDString(row.AssetID), SourceAssetID: *row.SourceAssetID,
			SourceRevisionID: nullableStringValue(row.SourceRevisionID), MediaSize: row.MediaSize,
		})
	}
	return selected, nil
}

func (r *Repository) UpdateLifecycle(ctx context.Context, taskRunID string, expectedStatus task.Status, update app.LifecycleUpdate, now time.Time) (bool, error) {
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return false, err
	}
	updates := map[string]any{
		"status": update.Status, "error_code": update.ErrorCode, "error_message": update.ErrorMessage,
		"updated_at": now,
	}
	if update.StartedAt != nil {
		updates["started_at"] = *update.StartedAt
	}
	if update.FinishedAt != nil {
		updates["finished_at"] = *update.FinishedAt
	}
	if update.Status == task.StatusFailed || update.Status == task.StatusCancelled {
		// A LongLive request may have succeeded before the worker could commit a
		// terminal result. Once the run stops retrying, any persisted association
		// checkpoint must become immediately eligible for release.
		updates["cleanup_status"] = gorm.Expr(
			"CASE WHEN output_sha256 <> '' THEN ? ELSE cleanup_status END", app.CleanupStatusPending,
		)
		updates["cleanup_next_at"] = gorm.Expr(
			"CASE WHEN output_sha256 <> '' THEN ? ELSE cleanup_next_at END", now.Add(terminalAssociationCleanupGrace),
		)
	}
	result := r.dbFor(ctx).Model(&canvasVideoArchiveExportRow{}).Where(
		"task_run_id = ? AND status = ?", run, string(expectedStatus),
	).Updates(updates)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *Repository) RecordOutput(ctx context.Context, taskRunID string, expectedStatus task.Status, result app.SuccessResult, now time.Time) (bool, error) {
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return false, err
	}
	update := r.dbFor(ctx).Model(&canvasVideoArchiveExportRow{}).Where(
		"task_run_id = ? AND status = ? AND output_asset_id = '' AND output_revision_id = ''", run, string(expectedStatus),
	).Updates(map[string]any{
		"output_asset_id": result.AssetID, "output_revision_id": result.RevisionID, "output_size": result.Size, "output_sha256": result.SHA256,
		"upload_id": result.UploadID, "part_size": result.PartSize,
		"retention_started_at": result.RetentionStartedAt, "updated_at": now,
	})
	if update.Error != nil {
		return false, update.Error
	}
	return update.RowsAffected == 1, nil
}

func (r *Repository) CommitSuccess(ctx context.Context, taskRunID string, expectedStatus task.Status, result app.SuccessResult, retentionUntil, now time.Time) (bool, error) {
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return false, err
	}
	update := r.dbFor(ctx).Model(&canvasVideoArchiveExportRow{}).Where(
		"task_run_id = ? AND status = ?", run, string(expectedStatus),
	).Updates(map[string]any{
		"status": task.StatusSucceeded, "output_asset_id": result.AssetID, "output_revision_id": result.RevisionID, "output_size": result.Size,
		"output_sha256": result.SHA256, "upload_id": result.UploadID, "part_size": result.PartSize,
		"retention_started_at": result.RetentionStartedAt, "retention_guaranteed_until": retentionUntil,
		"cleanup_status": app.CleanupStatusPending, "cleanup_next_at": retentionUntil,
		"finished_at": now, "updated_at": now,
	})
	if update.Error != nil {
		return false, update.Error
	}
	return update.RowsAffected == 1, nil
}

func (r *Repository) ClaimCleanupDue(ctx context.Context, now, leaseUntil time.Time, limit int) ([]app.Export, error) {
	if limit <= 0 {
		return []app.Export{}, nil
	}
	db := r.dbFor(ctx)
	var candidates []canvasVideoArchiveExportRow
	if err := db.Where(
		"cleanup_status = ? AND cleanup_next_at <= ? AND (cleanup_lease_until IS NULL OR cleanup_lease_until <= ?)",
		string(app.CleanupStatusPending), now, now,
	).Order("cleanup_next_at ASC").Order("task_run_id ASC").Limit(limit).Find(&candidates).Error; err != nil {
		return nil, err
	}
	claimed := make([]app.Export, 0, len(candidates))
	for index := range candidates {
		row := candidates[index]
		update := db.Model(&canvasVideoArchiveExportRow{}).Where(
			"task_run_id = ? AND cleanup_state_version = ? AND cleanup_status = ? AND (cleanup_lease_until IS NULL OR cleanup_lease_until <= ?)",
			row.TaskRunID, row.CleanupStateVersion, string(app.CleanupStatusPending), now,
		).Updates(map[string]any{"cleanup_lease_until": leaseUntil, "cleanup_state_version": row.CleanupStateVersion + 1, "updated_at": now})
		if update.Error != nil {
			return nil, update.Error
		}
		if update.RowsAffected != 1 {
			continue
		}
		row.CleanupLeaseUntil = &leaseUntil
		row.CleanupStateVersion++
		row.UpdatedAt = now
		claimed = append(claimed, exportFromRow(row))
	}
	return claimed, nil
}

func (r *Repository) CompleteCleanup(ctx context.Context, item app.Export, now time.Time) (bool, error) {
	run, err := persistenceid.Parse(item.TaskRunID)
	if err != nil {
		return false, err
	}
	update := r.dbFor(ctx).Model(&canvasVideoArchiveExportRow{}).Where(
		"task_run_id = ? AND cleanup_state_version = ? AND cleanup_status = ?", run, item.CleanupStateVersion, string(app.CleanupStatusPending),
	).Updates(map[string]any{"cleanup_status": app.CleanupStatusCompleted, "cleanup_lease_until": nil, "cleanup_state_version": item.CleanupStateVersion + 1, "updated_at": now})
	if update.Error != nil {
		return false, update.Error
	}
	return update.RowsAffected == 1, nil
}

func (r *Repository) RescheduleCleanup(ctx context.Context, item app.Export, next time.Time, message string, now time.Time) (bool, error) {
	run, err := persistenceid.Parse(item.TaskRunID)
	if err != nil {
		return false, err
	}
	update := r.dbFor(ctx).Model(&canvasVideoArchiveExportRow{}).Where(
		"task_run_id = ? AND cleanup_state_version = ? AND cleanup_status = ?", run, item.CleanupStateVersion, string(app.CleanupStatusPending),
	).Updates(map[string]any{
		"cleanup_next_at": next, "cleanup_lease_until": nil, "cleanup_state_version": item.CleanupStateVersion + 1,
		"cleanup_attempts": item.CleanupAttempts + 1, "cleanup_last_error": message, "updated_at": now,
	})
	if update.Error != nil {
		return false, update.Error
	}
	return update.RowsAffected == 1, nil
}

func (r *Repository) ListInputs(ctx context.Context, taskRunID string) ([]app.Input, error) {
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return []app.Input{}, nil
	}
	var row canvasVideoArchiveExportInputRow
	if err := r.dbFor(ctx).Where("task_run_id = ?", run).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return []app.Input{}, nil
		}
		return nil, err
	}
	return inputsFromRow(row)
}

func applyWorkspaceScope(query *gorm.DB, workspaceID *string) *gorm.DB {
	if workspaceID == nil {
		return query.Where("workspace_id IS NULL")
	}
	return query.Where("workspace_id = ?", *workspaceID)
}

func exportToRow(item app.Export) (canvasVideoArchiveExportRow, error) {
	run, err := persistenceid.Parse(item.TaskRunID)
	if err != nil {
		return canvasVideoArchiveExportRow{}, err
	}
	project, err := persistenceid.Parse(item.ProjectID)
	if err != nil {
		return canvasVideoArchiveExportRow{}, err
	}
	canvas, err := persistenceid.Parse(item.CanvasID)
	if err != nil {
		return canvasVideoArchiveExportRow{}, err
	}
	return canvasVideoArchiveExportRow{
		TaskRunID: run, TenantID: item.TenantID, WorkspaceID: item.WorkspaceID,
		ProjectID: project, CanvasID: canvas, Status: string(item.Status),
		ErrorCode: item.ErrorCode, ErrorMessage: item.ErrorMessage, InputCount: item.InputCount,
		OutputFilename: item.OutputFilename, OutputAssetID: item.OutputAssetID, OutputRevisionID: item.OutputRevisionID, OutputSize: item.OutputSize,
		OutputSHA256: item.OutputSHA256, UploadID: item.UploadID, PartSize: item.PartSize,
		CreatedBy: item.CreatedBy, RetentionStartedAt: item.RetentionStartedAt,
		RetentionGuaranteedUntil: item.RetentionGuaranteedUntil, CleanupStatus: string(item.CleanupStatus),
		CleanupNextAt: item.CleanupNextAt, CleanupLeaseUntil: item.CleanupLeaseUntil,
		CleanupStateVersion: item.CleanupStateVersion, CleanupAttempts: item.CleanupAttempts,
		CleanupLastError: item.CleanupLastError, StartedAt: item.StartedAt, FinishedAt: item.FinishedAt,
		CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt,
	}, nil
}

func exportFromRow(row canvasVideoArchiveExportRow) app.Export {
	return app.Export{
		TaskRunID: row.TaskRunID.String(), TenantID: row.TenantID, WorkspaceID: row.WorkspaceID,
		ProjectID: row.ProjectID.String(), CanvasID: row.CanvasID.String(), Status: task.Status(row.Status),
		ErrorCode: row.ErrorCode, ErrorMessage: row.ErrorMessage, InputCount: row.InputCount,
		OutputFilename: row.OutputFilename, OutputAssetID: row.OutputAssetID, OutputRevisionID: row.OutputRevisionID, OutputSize: row.OutputSize,
		OutputSHA256: row.OutputSHA256, UploadID: row.UploadID, PartSize: row.PartSize,
		CreatedBy: row.CreatedBy, RetentionStartedAt: row.RetentionStartedAt,
		RetentionGuaranteedUntil: row.RetentionGuaranteedUntil, CleanupStatus: app.CleanupStatus(row.CleanupStatus),
		CleanupNextAt: row.CleanupNextAt, CleanupLeaseUntil: row.CleanupLeaseUntil,
		CleanupStateVersion: row.CleanupStateVersion, CleanupAttempts: row.CleanupAttempts,
		CleanupLastError: row.CleanupLastError, StartedAt: row.StartedAt, FinishedAt: row.FinishedAt,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

type archiveInputSnapshot struct {
	Ordinal          int32     `json:"ordinal"`
	NodeID           string    `json:"node_id"`
	OutputID         string    `json:"output_id"`
	AssetID          string    `json:"asset_id,omitempty"`
	SourceAssetID    string    `json:"source_asset_id"`
	SourceRevisionID string    `json:"source_revision_id"`
	EntryName        string    `json:"entry_name"`
	MediaSize        int64     `json:"media_size"`
	CreatedAt        time.Time `json:"created_at"`
}

func inputsToRow(taskRunID string, inputs []app.Input, createdAt time.Time) (canvasVideoArchiveExportInputRow, error) {
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return canvasVideoArchiveExportInputRow{}, err
	}
	snapshots := make([]archiveInputSnapshot, 0, len(inputs))
	ordinals := make(map[int32]struct{}, len(inputs))
	for index := range inputs {
		item := inputs[index]
		if item.TaskRunID != taskRunID {
			return canvasVideoArchiveExportInputRow{}, fmt.Errorf("archive input task run %q does not match %q", item.TaskRunID, taskRunID)
		}
		if _, exists := ordinals[item.Ordinal]; exists {
			return canvasVideoArchiveExportInputRow{}, fmt.Errorf("archive input task run %q has duplicate ordinal %d", taskRunID, item.Ordinal)
		}
		ordinals[item.Ordinal] = struct{}{}
		nodeID, parseErr := persistenceid.Parse(item.NodeID)
		if parseErr != nil {
			return canvasVideoArchiveExportInputRow{}, parseErr
		}
		outputID, parseErr := persistenceid.Parse(item.OutputID)
		if parseErr != nil {
			return canvasVideoArchiveExportInputRow{}, parseErr
		}
		assetID, parseErr := persistenceid.ParseOptional(item.AssetID)
		if parseErr != nil {
			return canvasVideoArchiveExportInputRow{}, parseErr
		}
		snapshots = append(snapshots, archiveInputSnapshot{
			Ordinal: item.Ordinal, NodeID: nodeID.String(), OutputID: outputID.String(),
			AssetID: optionalUUIDString(assetID), SourceAssetID: item.SourceAssetID, SourceRevisionID: item.SourceRevisionID,
			EntryName: item.EntryName, MediaSize: item.MediaSize, CreatedAt: item.CreatedAt,
		})
	}
	sort.Slice(snapshots, func(left, right int) bool { return snapshots[left].Ordinal < snapshots[right].Ordinal })
	payload, err := json.Marshal(snapshots)
	if err != nil {
		return canvasVideoArchiveExportInputRow{}, fmt.Errorf("encode archive input snapshot: %w", err)
	}
	return canvasVideoArchiveExportInputRow{TaskRunID: run, Inputs: payload, CreatedAt: createdAt}, nil
}

func inputsFromRow(row canvasVideoArchiveExportInputRow) ([]app.Input, error) {
	var snapshots []archiveInputSnapshot
	if err := json.Unmarshal(row.Inputs, &snapshots); err != nil {
		return nil, fmt.Errorf("decode archive input snapshot for task run %s: %w", row.TaskRunID.String(), err)
	}
	if snapshots == nil {
		return nil, fmt.Errorf("decode archive input snapshot for task run %s: expected JSON array", row.TaskRunID.String())
	}
	items := make([]app.Input, 0, len(snapshots))
	ordinals := make(map[int32]struct{}, len(snapshots))
	sort.Slice(snapshots, func(left, right int) bool { return snapshots[left].Ordinal < snapshots[right].Ordinal })
	for index := range snapshots {
		snapshot := snapshots[index]
		if _, exists := ordinals[snapshot.Ordinal]; exists {
			return nil, fmt.Errorf("decode archive input snapshot for task run %s: duplicate ordinal %d", row.TaskRunID.String(), snapshot.Ordinal)
		}
		ordinals[snapshot.Ordinal] = struct{}{}
		nodeID, err := persistenceid.Parse(snapshot.NodeID)
		if err != nil {
			return nil, fmt.Errorf("decode archive input snapshot for task run %s: invalid node ID: %w", row.TaskRunID.String(), err)
		}
		outputID, err := persistenceid.Parse(snapshot.OutputID)
		if err != nil {
			return nil, fmt.Errorf("decode archive input snapshot for task run %s: invalid output ID: %w", row.TaskRunID.String(), err)
		}
		assetID, err := persistenceid.ParseOptional(snapshot.AssetID)
		if err != nil {
			return nil, fmt.Errorf("decode archive input snapshot for task run %s: invalid asset ID: %w", row.TaskRunID.String(), err)
		}
		items = append(items, app.Input{
			TaskRunID: row.TaskRunID.String(), Ordinal: snapshot.Ordinal,
			NodeID: nodeID.String(), OutputID: outputID.String(), AssetID: optionalUUIDString(assetID),
			SourceAssetID: snapshot.SourceAssetID, SourceRevisionID: snapshot.SourceRevisionID, EntryName: snapshot.EntryName,
			MediaSize: snapshot.MediaSize, CreatedAt: snapshot.CreatedAt,
		})
	}
	return items, nil
}

func optionalUUIDString(value *persistenceid.UUID) string {
	if value == nil {
		return ""
	}
	return value.String()
}

func nullableStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

type archiveCanvasScopeRow struct {
	ID   persistenceid.UUID
	Name string
}

func (archiveCanvasScopeRow) TableName() string { return "canvases" }

type selectedVideoSnapshotRow struct {
	NodeID           persistenceid.UUID
	OutputID         *persistenceid.UUID
	AssetID          *persistenceid.UUID
	SourceAssetID    *string
	SourceRevisionID *string
	MediaSize        int64
	GenerationStatus string
}
