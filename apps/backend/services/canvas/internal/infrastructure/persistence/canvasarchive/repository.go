package canvasarchive

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	app "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	"github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Repository struct{ store *persistencetransaction.Store }

const terminalAssociationCleanupGrace = 30 * time.Minute

func NewRepository(store *persistencetransaction.Store) *Repository { return &Repository{store: store} }
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
	return r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		db := r.store.Queries(ctx)
		if err := db.ArchiveCreate(ctx, sqlc.ArchiveCreateParams(row)); err != nil {
			return err
		}
		return db.ArchiveCreateInputs(ctx, sqlc.ArchiveCreateInputsParams(inputRow))
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
	row, err := r.store.Queries(ctx).ArchiveGet(ctx, sqlc.ArchiveGetParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   project.String(),
		CanvasID:    canvas.String(),
		ID:          run.String(),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
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
	row, err := r.store.Queries(ctx).ArchiveByID(ctx, run.String())
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
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
	ids := make([]string, 0, len(taskRunIDs))
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
		ids = append(ids, key)
		order = append(order, key)
	}
	if len(ids) == 0 {
		return []app.Export{}, nil
	}
	rows, err := r.store.Queries(ctx).ArchiveBatch(ctx, sqlc.ArchiveBatchParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   project.String(),
		CanvasID:    canvas.String(),
		Ids:         ids,
	})
	if err != nil {
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
	total, err := r.store.Queries(ctx).ArchiveCount(ctx, sqlc.ArchiveCountParams{
		TenantID:    query.TenantID,
		WorkspaceID: query.WorkspaceID,
		ProjectID:   project.String(),
		CanvasID:    canvas.String(),
	})
	if err != nil {
		return nil, 0, err
	}
	args := sqlc.ArchiveListAscParams{
		TenantID:    query.TenantID,
		WorkspaceID: query.WorkspaceID,
		ProjectID:   project.String(),
		CanvasID:    canvas.String(),
		PageSize:    int32(query.PageSize),
		PageOffset:  int32((query.PageNum - 1) * query.PageSize),
	}
	var rows []canvasVideoArchiveExportRow
	if query.SortDirection == app.SortAscending {
		rows, err = r.store.Queries(ctx).ArchiveListAsc(ctx, args)
	} else {
		rows, err = r.store.Queries(ctx).ArchiveListDesc(ctx, sqlc.ArchiveListDescParams(args))
	}
	if err != nil {
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
	row, err := r.store.Queries(ctx).ArchiveActive(ctx, sqlc.ArchiveActiveParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   project.String(),
		CanvasID:    canvas.String(),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return app.Export{}, app.ErrNotFound
		}
		return app.Export{}, err
	}
	return exportFromRow(row), nil
}

func (r *Repository) SnapshotSelectedVideos(ctx context.Context, scope app.Scope, projectID, canvasID string) (selected []app.SelectedVideo, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		selected, err = r.snapshotSelectedVideosInTransaction(ctx, scope, projectID, canvasID)
		return err
	})
	return
}

func (r *Repository) snapshotSelectedVideosInTransaction(ctx context.Context, scope app.Scope, projectID, canvasID string) ([]app.SelectedVideo, error) {
	project, projectErr := persistenceid.Parse(projectID)
	canvas, canvasErr := persistenceid.Parse(canvasID)
	if projectErr != nil || canvasErr != nil || scope.TenantID == "" {
		return nil, app.ErrNotFound
	}
	canvasName, err := r.store.Queries(ctx).ArchiveLockCanvas(ctx, sqlc.ArchiveLockCanvasParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   project.String(),
		ID:          canvas.String(),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, app.ErrNotFound
		}
		return nil, err
	}
	rows, err := r.store.Queries(ctx).ArchiveSnapshot(ctx, sqlc.ArchiveSnapshotParams{
		OwnerType:   int16(domainasset.OwnerProject),
		MediaType:   int16(domainasset.MediaVideo),
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   project.String(),
		CanvasID:    canvas.String(),
		Type:        int16(domaincanvas.NodeTypeVideoGeneration),
	})
	if err != nil {
		return nil, err
	}
	selected := make([]app.SelectedVideo, 0, len(rows))
	for index := range rows {
		row := rows[index]
		if row.OutputID == nil || row.SourceAssetID == nil || *row.SourceAssetID == "" || row.GenerationStatus != string(task.StatusSucceeded) {
			return nil, app.ErrSelectedVideoUnavailable
		}
		selected = append(selected, app.SelectedVideo{
			CanvasName: canvasName, NodeID: row.NodeID, OutputID: *row.OutputID,
			AssetID: nullableStringValue(row.AssetID), SourceAssetID: *row.SourceAssetID,
			SourceRevisionID: nullableStringValue(row.SourceRevisionID), MediaSize: row.MediaSize,
		})
	}
	return selected, nil
}

func (r *Repository) UpdateLifecycle(ctx context.Context, taskRunID string, expectedStatus task.Status, update app.LifecycleUpdate, now time.Time) (matched bool, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		matched, err = r.updateLifecycleInTransaction(ctx, taskRunID, expectedStatus, update, now)
		return err
	})
	return
}

func (r *Repository) updateLifecycleInTransaction(ctx context.Context, taskRunID string, expectedStatus task.Status, update app.LifecycleUpdate, now time.Time) (bool, error) {
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return false, err
	}
	cleanupNext := now.Add(terminalAssociationCleanupGrace)
	affected, err := r.store.Queries(ctx).ArchiveLifecycle(ctx, sqlc.ArchiveLifecycleParams{
		Status:        string(update.Status),
		ErrorCode:     update.ErrorCode,
		ErrorMessage:  update.ErrorMessage,
		UpdatedAt:     now,
		StartedAt:     optionalTime(update.StartedAt),
		FinishedAt:    optionalTime(update.FinishedAt),
		CleanupNextAt: &cleanupNext,
		ID:            run.String(),
		Expected:      string(expectedStatus),
	})
	return affected == 1, err
}

func (r *Repository) RecordOutput(ctx context.Context, taskRunID string, expectedStatus task.Status, result app.SuccessResult, now time.Time) (matched bool, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		matched, err = r.recordOutputInTransaction(ctx, taskRunID, expectedStatus, result, now)
		return err
	})
	return
}

func (r *Repository) recordOutputInTransaction(ctx context.Context, taskRunID string, expectedStatus task.Status, result app.SuccessResult, now time.Time) (bool, error) {
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return false, err
	}
	affected, err := r.store.Queries(ctx).ArchiveOutput(ctx, sqlc.ArchiveOutputParams{
		OutputAssetID:      result.AssetID,
		OutputRevisionID:   result.RevisionID,
		OutputSize:         result.Size,
		OutputSha256:       result.SHA256,
		UploadID:           result.UploadID,
		PartSize:           result.PartSize,
		RetentionStartedAt: &result.RetentionStartedAt,
		UpdatedAt:          now,
		ID:                 run.String(),
		Expected:           string(expectedStatus),
	})
	return affected == 1, err
}

func (r *Repository) CommitSuccess(ctx context.Context, taskRunID string, expectedStatus task.Status, result app.SuccessResult, retentionUntil, now time.Time) (matched bool, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		matched, err = r.commitSuccessInTransaction(ctx, taskRunID, expectedStatus, result, retentionUntil, now)
		return err
	})
	return
}

func (r *Repository) commitSuccessInTransaction(ctx context.Context, taskRunID string, expectedStatus task.Status, result app.SuccessResult, retentionUntil, now time.Time) (bool, error) {
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return false, err
	}
	affected, err := r.store.Queries(ctx).ArchiveSuccess(ctx, sqlc.ArchiveSuccessParams{
		OutputAssetID:      result.AssetID,
		OutputRevisionID:   result.RevisionID,
		OutputSize:         result.Size,
		OutputSha256:       result.SHA256,
		UploadID:           result.UploadID,
		PartSize:           result.PartSize,
		RetentionStartedAt: &result.RetentionStartedAt,
		UpdatedAt:          now,
		Until:              &retentionUntil,
		ID:                 run.String(),
		Expected:           string(expectedStatus),
	})
	return affected == 1, err
}

func (r *Repository) ClaimCleanupDue(ctx context.Context, now, leaseUntil time.Time, limit int) (claimed []app.Export, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		claimed, err = r.claimCleanupDueInTransaction(ctx, now, leaseUntil, limit)
		return err
	})
	return
}

func (r *Repository) claimCleanupDueInTransaction(ctx context.Context, now, leaseUntil time.Time, limit int) ([]app.Export, error) {
	if limit <= 0 {
		return []app.Export{}, nil
	}
	candidates, err := r.store.Queries(ctx).ArchiveDue(ctx, sqlc.ArchiveDueParams{Now: &now, PageSize: int32(limit)})
	if err != nil {
		return nil, err
	}
	claimed := make([]app.Export, 0, len(candidates))
	for index := range candidates {
		row := candidates[index]
		affected, err := r.store.Queries(ctx).ArchiveClaim(ctx, sqlc.ArchiveClaimParams{LeaseUntil: &leaseUntil, UpdatedAt: now, ID: row.TaskRunID, Version: row.CleanupStateVersion})
		if err != nil {
			return nil, err
		}
		if affected != 1 {
			continue
		}
		row.CleanupLeaseUntil = &leaseUntil
		row.CleanupStateVersion++
		row.UpdatedAt = now
		claimed = append(claimed, exportFromRow(row))
	}
	return claimed, nil
}

func (r *Repository) CompleteCleanup(ctx context.Context, item app.Export, now time.Time) (matched bool, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		matched, err = r.completeCleanupInTransaction(ctx, item, now)
		return err
	})
	return
}

func (r *Repository) completeCleanupInTransaction(ctx context.Context, item app.Export, now time.Time) (bool, error) {
	run, err := persistenceid.Parse(item.TaskRunID)
	if err != nil {
		return false, err
	}
	affected, err := r.store.Queries(ctx).ArchiveComplete(ctx, sqlc.ArchiveCompleteParams{UpdatedAt: now, ID: run.String(), Version: item.CleanupStateVersion})
	return affected == 1, err
}

func (r *Repository) RescheduleCleanup(ctx context.Context, item app.Export, next time.Time, message string, now time.Time) (matched bool, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		matched, err = r.rescheduleCleanupInTransaction(ctx, item, next, message, now)
		return err
	})
	return
}

func (r *Repository) rescheduleCleanupInTransaction(ctx context.Context, item app.Export, next time.Time, message string, now time.Time) (bool, error) {
	run, err := persistenceid.Parse(item.TaskRunID)
	if err != nil {
		return false, err
	}
	affected, err := r.store.Queries(ctx).ArchiveReschedule(ctx, sqlc.ArchiveRescheduleParams{Next: &next, Message: message, UpdatedAt: now, ID: run.String(), Version: item.CleanupStateVersion})
	return affected == 1, err
}

func (r *Repository) ListInputs(ctx context.Context, taskRunID string) ([]app.Input, error) {
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return []app.Input{}, nil
	}
	row, err := r.store.Queries(ctx).ArchiveInputs(ctx, run.String())
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return []app.Input{}, nil
		}
		return nil, err
	}
	return inputsFromRow(row)
}

func optionalTime(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
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
		TaskRunID: run.String(), TenantID: item.TenantID, WorkspaceID: item.WorkspaceID,
		ProjectID: project.String(), CanvasID: canvas.String(), Status: string(item.Status),
		ErrorCode: item.ErrorCode, ErrorMessage: item.ErrorMessage, InputCount: item.InputCount,
		OutputFilename: item.OutputFilename, OutputAssetID: item.OutputAssetID, OutputRevisionID: item.OutputRevisionID, OutputSize: item.OutputSize,
		OutputSha256: item.OutputSHA256, UploadID: item.UploadID, PartSize: item.PartSize,
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
		TaskRunID: row.TaskRunID, TenantID: row.TenantID, WorkspaceID: row.WorkspaceID,
		ProjectID: row.ProjectID, CanvasID: row.CanvasID, Status: task.Status(row.Status),
		ErrorCode: row.ErrorCode, ErrorMessage: row.ErrorMessage, InputCount: row.InputCount,
		OutputFilename: row.OutputFilename, OutputAssetID: row.OutputAssetID, OutputRevisionID: row.OutputRevisionID, OutputSize: row.OutputSize,
		OutputSHA256: row.OutputSha256, UploadID: row.UploadID, PartSize: row.PartSize,
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
	return canvasVideoArchiveExportInputRow{TaskRunID: run.String(), Inputs: payload, CreatedAt: createdAt}, nil
}

func inputsFromRow(row canvasVideoArchiveExportInputRow) ([]app.Input, error) {
	var snapshots []archiveInputSnapshot
	if err := json.Unmarshal(row.Inputs, &snapshots); err != nil {
		return nil, fmt.Errorf("decode archive input snapshot for task run %s: %w", row.TaskRunID, err)
	}
	if snapshots == nil {
		return nil, fmt.Errorf("decode archive input snapshot for task run %s: expected JSON array", row.TaskRunID)
	}
	items := make([]app.Input, 0, len(snapshots))
	ordinals := make(map[int32]struct{}, len(snapshots))
	sort.Slice(snapshots, func(left, right int) bool { return snapshots[left].Ordinal < snapshots[right].Ordinal })
	for index := range snapshots {
		snapshot := snapshots[index]
		if _, exists := ordinals[snapshot.Ordinal]; exists {
			return nil, fmt.Errorf("decode archive input snapshot for task run %s: duplicate ordinal %d", row.TaskRunID, snapshot.Ordinal)
		}
		ordinals[snapshot.Ordinal] = struct{}{}
		nodeID, err := persistenceid.Parse(snapshot.NodeID)
		if err != nil {
			return nil, fmt.Errorf("decode archive input snapshot for task run %s: invalid node ID: %w", row.TaskRunID, err)
		}
		outputID, err := persistenceid.Parse(snapshot.OutputID)
		if err != nil {
			return nil, fmt.Errorf("decode archive input snapshot for task run %s: invalid output ID: %w", row.TaskRunID, err)
		}
		assetID, err := persistenceid.ParseOptional(snapshot.AssetID)
		if err != nil {
			return nil, fmt.Errorf("decode archive input snapshot for task run %s: invalid asset ID: %w", row.TaskRunID, err)
		}
		items = append(items, app.Input{
			TaskRunID: row.TaskRunID, Ordinal: snapshot.Ordinal,
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
