package canvasnode

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	app "github.com/example/monorepo/canvas/internal/server/application/canvas"
	applicationresource "github.com/example/monorepo/canvas/internal/server/application/resource"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domain "github.com/example/monorepo/canvas/internal/server/domain/canvas"
	domainresource "github.com/example/monorepo/canvas/internal/server/domain/resource"
)

const maxCanvasNodes = 100

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) dbFor(ctx context.Context) *gorm.DB {
	return persistencetransaction.DB(ctx, r.db)
}

func (r *Repository) BindCanvasNodeAsset(
	ctx context.Context,
	input applicationresource.CanvasNodeAssetBindingInput,
) (applicationresource.CanvasNodeAssetBinding, error) {
	projectID, err := persistenceid.Parse(input.ProjectID)
	if err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	canvasID, err := persistenceid.Parse(input.CanvasID)
	if err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	nodeID, err := persistenceid.Parse(input.CanvasNodeID)
	if err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	_, err = persistenceid.Parse(input.AssetID)
	if err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	resourceAssetID, err := persistenceid.Parse(input.ResourceAssetID)
	if err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	scope := app.Scope{TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CallerID: input.CallerID}
	db := r.dbFor(ctx)
	if err = lockCanvas(db, input.TenantID, input.WorkspaceID, input.ProjectID, canvasID); err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	var row canvasnodeRow
	if err = scopeQuery(db.Clauses(clause.Locking{Strength: "UPDATE"}), scope).
		Where("id = ? AND project_id = ? AND canvas_id = ?", nodeID, projectID, canvasID).
		First(&row).Error; err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	item, err := r.decodeRow(ctx, row)
	if err != nil || item.ActiveTaskRunID != "" || item.ResourceID != "" || item.ResourceAssetID != "" {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	assetNode := item.Type == domain.NodeTypeImageAsset || item.Type == domain.NodeTypeVideoAsset || item.Type == domain.NodeTypeAudioAsset
	generationNode := item.Type == domain.NodeTypeImageGeneration || item.Type == domain.NodeTypeVideoGeneration
	if (assetNode && item.AssetID != input.AssetID) ||
		(generationNode && item.SelectedAssetID != input.AssetID) ||
		(!assetNode && !generationNode) {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	nextRevision := item.Revision + 1
	item.AssetID = ""
	item.ResourceAssetID = input.ResourceAssetID
	item.ReferenceType = domain.ReferenceTypeResourceAsset
	nodeData, err := encodeCanvasNodeData(item)
	if err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	result := db.Model(&row).Where("revision = ?", item.Revision).Updates(map[string]any{
		"asset_id": nil, "resource_id": nil, "resource_asset_id": resourceAssetID,
		"node_data":          nodeData,
		"selected_output_id": nil, "selected_asset_id": nil,
		"revision": nextRevision, "updated_by": input.CallerID, "updated_at": input.UpdatedAt.UTC(),
	})
	if result.Error != nil {
		return applicationresource.CanvasNodeAssetBinding{}, result.Error
	}
	if result.RowsAffected != 1 {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	return applicationresource.CanvasNodeAssetBinding{
		CanvasID: input.CanvasID, CanvasNodeID: input.CanvasNodeID, ResourceAssetID: input.ResourceAssetID,
		CanvasNodeRevision: nextRevision,
	}, nil
}
func (r *Repository) List(ctx context.Context, scope app.Scope, projectID, canvasID string) ([]domain.CanvasNode, error) {
	return r.list(ctx, scope, projectID, canvasID, false)
}

func (r *Repository) ListForUpdate(ctx context.Context, scope app.Scope, projectID, canvasID string) ([]domain.CanvasNode, error) {
	return r.list(ctx, scope, projectID, canvasID, true)
}

func (r *Repository) list(ctx context.Context, scope app.Scope, projectID, canvasID string, forUpdate bool) ([]domain.CanvasNode, error) {
	p, e := persistenceid.Parse(projectID)
	if e != nil {
		return nil, app.ErrNotFound
	}
	ep, e := persistenceid.Parse(canvasID)
	if e != nil {
		return nil, app.ErrNotFound
	}
	if e = findCanvas(r.dbFor(ctx), scope, p, ep, false); e != nil {
		return nil, readErr(e)
	}
	var rows []canvasnodeRow
	query := scopeQuery(r.dbFor(ctx), scope)
	if forUpdate {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if e = query.Where("project_id = ? AND canvas_id = ?", p, ep).Order("storyboard_rank ASC").Order("id ASC").Find(&rows).Error; e != nil {
		return nil, e
	}
	out := make([]domain.CanvasNode, 0, len(rows))
	for _, row := range rows {
		item, mapErr := r.decodeRow(ctx, row)
		if mapErr != nil {
			return nil, mapErr
		}
		out = append(out, item)
	}
	if e = loadSelectedOutputMetadata(r.dbFor(ctx), scope, out); e != nil {
		return nil, e
	}
	return out, nil
}

func (r *Repository) ListIDs(ctx context.Context, scope app.Scope, projectID, canvasID string) ([]string, error) {
	p, err := persistenceid.Parse(projectID)
	if err != nil {
		return nil, app.ErrNotFound
	}
	ep, err := persistenceid.Parse(canvasID)
	if err != nil {
		return nil, app.ErrNotFound
	}
	if err = findCanvas(r.dbFor(ctx), scope, p, ep, false); err != nil {
		return nil, readErr(err)
	}
	var ids []persistenceid.UUID
	if err = scopeQuery(r.dbFor(ctx).Model(&canvasnodeRow{}), scope).
		Where("project_id = ? AND canvas_id = ? AND type = ?", p, ep, domain.NodeTypeVideoGeneration).
		Order("storyboard_rank ASC").Order("id ASC").
		Pluck("id", &ids).Error; err != nil {
		return nil, err
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, id.String())
	}
	return out, nil
}

func (r *Repository) BatchGet(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID string,
	canvasnodeIDs []string,
) ([]domain.CanvasNode, error) {
	p, err := persistenceid.Parse(projectID)
	if err != nil {
		return nil, app.ErrNotFound
	}
	ep, err := persistenceid.Parse(canvasID)
	if err != nil {
		return nil, app.ErrNotFound
	}
	if err = findCanvas(r.dbFor(ctx), scope, p, ep, false); err != nil {
		return nil, readErr(err)
	}
	ids := persistenceid.ParseValid(canvasnodeIDs)
	if len(ids) == 0 {
		return []domain.CanvasNode{}, nil
	}
	var rows []canvasnodeRow
	if err = scopeQuery(r.dbFor(ctx), scope).
		Where("project_id = ? AND canvas_id = ? AND id IN ?", p, ep, ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	items := make([]domain.CanvasNode, 0, len(rows))
	for _, row := range rows {
		item, mapErr := r.decodeRow(ctx, row)
		if mapErr != nil {
			return nil, mapErr
		}
		items = append(items, item)
	}
	if err = loadSelectedOutputMetadata(r.dbFor(ctx), scope, items); err != nil {
		return nil, err
	}
	byID := make(map[string]domain.CanvasNode, len(items))
	for _, item := range items {
		byID[item.ID] = item
	}
	ordered := make([]domain.CanvasNode, 0, len(items))
	seen := make(map[string]struct{}, len(canvasnodeIDs))
	for _, id := range canvasnodeIDs {
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		if item, ok := byID[id]; ok {
			ordered = append(ordered, item)
		}
	}
	return ordered, nil
}

func (r *Repository) BatchFirstFrameAssets(
	ctx context.Context,
	scope app.Scope,
	projectID string,
	canvasIDs []string,
) (map[string]app.FallbackFrameAsset, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return nil, err
	}
	canvasUUIDs := make([]persistenceid.UUID, 0, len(canvasIDs))
	for _, canvasID := range canvasIDs {
		canvasUUID, parseErr := persistenceid.Parse(canvasID)
		if parseErr != nil {
			return nil, parseErr
		}
		canvasUUIDs = append(canvasUUIDs, canvasUUID)
	}
	if len(canvasUUIDs) == 0 {
		return map[string]app.FallbackFrameAsset{}, nil
	}
	var canvasnodeRows []canvasnodeRow
	if err = scopeQuery(r.dbFor(ctx), scope).
		Where("project_id = ? AND canvas_id IN ? AND type = ?", projectUUID, canvasUUIDs, domain.NodeTypeVideoGeneration).
		Order("canvas_id ASC").Order("storyboard_rank ASC").Order("id ASC").
		Find(&canvasnodeRows).Error; err != nil {
		return nil, err
	}
	firstByCanvas := make(map[string]canvasnodeRow, len(canvasUUIDs))
	selectedIDs := make([]persistenceid.UUID, 0, len(canvasUUIDs))
	for _, row := range canvasnodeRows {
		canvasID := row.CanvasID.String()
		if _, exists := firstByCanvas[canvasID]; exists {
			continue
		}
		firstByCanvas[canvasID] = row
		if row.SelectedOutputID != nil {
			selectedIDs = append(selectedIDs, *row.SelectedOutputID)
		}
	}
	if len(selectedIDs) == 0 {
		return map[string]app.FallbackFrameAsset{}, nil
	}
	var generationRows []selectedOutputMetadataRow
	if err = scopeQuery(r.dbFor(ctx).Model(&selectedOutputMetadataRow{}), scope).
		Select("task_run_id", "canvas_id", "node_id", "first_frame_asset_id").
		Where("project_id = ? AND canvas_id IN ? AND task_run_id IN ?", projectUUID, canvasUUIDs, selectedIDs).
		Find(&generationRows).Error; err != nil {
		return nil, err
	}
	result := make(map[string]app.FallbackFrameAsset, len(generationRows))
	for _, generation := range generationRows {
		canvasID := generation.CanvasID.String()
		first, exists := firstByCanvas[canvasID]
		if !exists || first.SelectedOutputID == nil || *first.SelectedOutputID != generation.TaskRunID ||
			first.ID != generation.NodeID || generation.FirstFrameAssetID == nil {
			continue
		}
		result[canvasID] = app.FallbackFrameAsset{AssetID: generation.FirstFrameAssetID.String(), TaskRunID: generation.TaskRunID.String()}
	}
	return result, nil
}
func (r *Repository) Get(ctx context.Context, scope app.Scope, projectID, canvasID, canvasnodeID string) (domain.CanvasNode, error) {
	return r.get(ctx, scope, projectID, canvasID, canvasnodeID, false)
}

func (r *Repository) GetForUpdate(ctx context.Context, scope app.Scope, projectID, canvasID, canvasnodeID string) (domain.CanvasNode, error) {
	return r.get(ctx, scope, projectID, canvasID, canvasnodeID, true)
}

func (r *Repository) get(ctx context.Context, scope app.Scope, projectID, canvasID, canvasnodeID string, forUpdate bool) (domain.CanvasNode, error) {
	p, e := persistenceid.Parse(projectID)
	if e != nil {
		return domain.CanvasNode{}, app.ErrNotFound
	}
	ep, e := persistenceid.Parse(canvasID)
	if e != nil {
		return domain.CanvasNode{}, app.ErrNotFound
	}
	id, e := persistenceid.Parse(canvasnodeID)
	if e != nil {
		return domain.CanvasNode{}, app.ErrNotFound
	}
	if e = findCanvas(r.dbFor(ctx), scope, p, ep, forUpdate); e != nil {
		return domain.CanvasNode{}, readErr(e)
	}
	var row canvasnodeRow
	query := scopeQuery(r.dbFor(ctx), scope)
	if forUpdate {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if e = query.Where("id = ? AND project_id = ? AND canvas_id = ?", id, p, ep).First(&row).Error; e != nil {
		return domain.CanvasNode{}, readErr(e)
	}
	item, e := r.decodeRow(ctx, row)
	if e != nil {
		return domain.CanvasNode{}, e
	}
	items := []domain.CanvasNode{item}
	if e = loadSelectedOutputMetadata(r.dbFor(ctx), scope, items); e != nil {
		return domain.CanvasNode{}, e
	}
	return items[0], nil
}

func (r *Repository) Number(ctx context.Context, scope app.Scope, projectID, canvasID, canvasnodeID string) (int32, error) {
	p, err := persistenceid.Parse(projectID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	ep, err := persistenceid.Parse(canvasID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	id, err := persistenceid.Parse(canvasnodeID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	var current canvasnodeRow
	if err = scopeQuery(r.dbFor(ctx), scope).Where("id = ? AND project_id = ? AND canvas_id = ?", id, p, ep).First(&current).Error; err != nil {
		return 0, readErr(err)
	}
	var preceding int64
	if err = scopeQuery(r.dbFor(ctx).Model(&canvasnodeRow{}), scope).
		Where("project_id = ? AND canvas_id = ? AND storyboard_rank < ?", p, ep, current.StoryboardRank).
		Count(&preceding).Error; err != nil {
		return 0, err
	}
	return int32(preceding + 1), nil
}

func (r *Repository) GetByID(ctx context.Context, scope app.Scope, canvasnodeID string) (domain.CanvasNode, error) {
	id, err := persistenceid.Parse(canvasnodeID)
	if err != nil {
		return domain.CanvasNode{}, app.ErrNotFound
	}
	var row canvasnodeRow
	if err = scopeQuery(r.dbFor(ctx), scope).Where("id = ?", id).First(&row).Error; err != nil {
		return domain.CanvasNode{}, readErr(err)
	}
	return r.decodeRow(ctx, row)
}
func (r *Repository) Create(ctx context.Context, item domain.CanvasNode, after *string) (int32, error) {
	db := r.dbFor(ctx)
	canvasID, err := persistenceid.Parse(item.CanvasID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	if err = lockCanvas(db, item.TenantID, item.WorkspaceID, item.ProjectID, canvasID); err != nil {
		return 0, readErr(err)
	}
	projectID, err := persistenceid.Parse(item.ProjectID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	var nodeCount int64
	base := scopeQuery(db.Model(&canvasnodeRow{}), app.Scope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID}).Where("project_id = ? AND canvas_id = ?", projectID, canvasID)
	if err = base.Count(&nodeCount).Error; err != nil {
		return 0, err
	}
	if nodeCount >= maxCanvasNodes {
		return 0, app.ErrCanvasNodeLimitExceeded
	}
	if item.Type != domain.NodeTypeVideoGeneration {
		item.StoryboardRank = 0
		row, mapErr := toRow(item)
		if mapErr != nil {
			return 0, mapErr
		}
		if createErr := db.Create(&row).Error; createErr != nil {
			return 0, createErr
		}
		return 0, nil
	}
	var rows []canvasnodeRow
	query := base.Where("type = ?", domain.NodeTypeVideoGeneration).Order("storyboard_rank ASC").Order("id ASC").Clauses(clause.Locking{Strength: "UPDATE"})
	if err = query.Find(&rows).Error; err != nil {
		return 0, err
	}
	key := int64(1024)
	canvasnodeNo := int32(len(rows) + 1)
	if len(rows) > 0 {
		key = rows[len(rows)-1].StoryboardRank + 1024
	}
	if after != nil {
		anchor, parseErr := persistenceid.Parse(*after)
		if parseErr != nil {
			return 0, app.ErrNotFound
		}
		index := -1
		for n, row := range rows {
			if row.ID == anchor {
				index = n
				break
			}
		}
		if index < 0 {
			return 0, app.ErrNotFound
		}
		canvasnodeNo = int32(index + 2)
		if index+1 < len(rows) {
			key = (rows[index].StoryboardRank + rows[index+1].StoryboardRank) / 2
			if key == rows[index].StoryboardRank {
				if err = rebalanceRows(db, rows); err != nil {
					return 0, err
				}
				key = (rows[index].StoryboardRank + rows[index+1].StoryboardRank) / 2
			}
		} else {
			key = rows[index].StoryboardRank + 1024
		}
	}
	item.StoryboardRank = key
	row, err := toRow(item)
	if err != nil {
		return 0, err
	}
	if err = db.Create(&row).Error; err != nil {
		return 0, err
	}
	return canvasnodeNo, nil
}
func (r *Repository) Update(ctx context.Context, item domain.CanvasNode, patch domain.UpdatePatch) (int32, int64, string, error) {
	row, err := toRow(item)
	if err != nil {
		return 0, 0, "", err
	}
	db := r.dbFor(ctx)
	if err = lockCanvas(db, item.TenantID, item.WorkspaceID, item.ProjectID, row.CanvasID); err != nil {
		return 0, 0, "", readErr(err)
	}
	var current canvasnodeRow
	if err = scopeQuery(db.Clauses(clause.Locking{Strength: "UPDATE"}), app.Scope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID}).Where("id = ? AND project_id = ? AND canvas_id = ?", row.ID, row.ProjectID, row.CanvasID).First(&current).Error; err != nil {
		return 0, 0, "", readErr(err)
	}
	if current.Revision != patch.ExpectedRevision {
		return 0, 0, "", app.ErrRevisionConflict
	}
	revokedTaskRunID := optionalUUIDString(current.ActiveTaskRunID)
	revision := current.Revision + 1
	updates := map[string]any{
		"node_data": row.NodeData, "revision": revision, "updated_by": item.UpdatedBy, "updated_at": item.UpdatedAt,
	}
	definitionChanged := patch.Prompt != nil || patch.Text != nil || patch.IncomingEdges != nil ||
		patch.VideoInputMode != nil || !patch.GenerationConfig.Empty()
	if definitionChanged {
		updates["active_task_run_id"] = nil
	} else {
		revokedTaskRunID = ""
	}
	if err = db.Model(&current).Updates(updates).Error; err != nil {
		return 0, 0, "", err
	}
	var preceding int64
	if err = scopeQuery(db.Model(&canvasnodeRow{}), app.Scope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID}).Where("project_id = ? AND canvas_id = ? AND storyboard_rank < ?", row.ProjectID, row.CanvasID, current.StoryboardRank).Count(&preceding).Error; err != nil {
		return 0, 0, "", err
	}
	canvasnodeNo := int32(preceding + 1)
	return canvasnodeNo, revision, revokedTaskRunID, nil
}

// ClaimTaskRun 用条件更新抢占单分镜的生成槽位。生成不改变内容，所以这里不递增
// revision；并发请求只有一个能把 NULL 改成自己的 TaskRunID，避免重复创建计费任务。
func (r *Repository) ClaimTaskRun(ctx context.Context, item domain.CanvasNode) (bool, error) {
	row, err := toRow(item)
	if err != nil {
		return false, err
	}
	db := r.dbFor(ctx)
	if err = lockCanvas(db, item.TenantID, item.WorkspaceID, item.ProjectID, row.CanvasID); err != nil {
		return false, readErr(err)
	}
	query := scopeQuery(db.Model(&canvasnodeRow{}), app.Scope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID})
	result := query.Where("id = ? AND project_id = ? AND canvas_id = ? AND revision = ? AND active_task_run_id IS NULL", row.ID, row.ProjectID, row.CanvasID, row.Revision).
		Update("active_task_run_id", row.ActiveTaskRunID)
	return result.RowsAffected == 1, result.Error
}

// ReleaseTaskRun 也使用条件更新，只释放仍指向 expectedRunID 的槽位，不能误清掉
// 另一个请求刚发起的新运行。
func (r *Repository) ReleaseTaskRun(ctx context.Context, item domain.CanvasNode, expectedRunID string) (bool, error) {
	row, err := toRow(item)
	if err != nil {
		return false, err
	}
	expected, err := persistenceid.Parse(expectedRunID)
	if err != nil {
		return false, err
	}
	query := scopeQuery(r.dbFor(ctx).Model(&canvasnodeRow{}), app.Scope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID})
	result := query.Where("id = ? AND project_id = ? AND canvas_id = ? AND active_task_run_id = ?", row.ID, row.ProjectID, row.CanvasID, expected).
		Update("active_task_run_id", nil)
	return result.RowsAffected == 1, result.Error
}

// BindGeneratedAsset atomically releases a generation slot and selects its
// successful image/video Asset on the generation node. Generated Assets are
// project-owned storage facts and are never materialized as ResourceAssets.
func (r *Repository) BindGeneratedAsset(ctx context.Context, scope app.Scope, projectID, canvasID, nodeID, taskRunID, assetID string, nodeType domain.NodeType, updatedAt time.Time) (bool, error) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return false, app.ErrNotFound
	}
	canvas, err := persistenceid.Parse(canvasID)
	if err != nil {
		return false, app.ErrNotFound
	}
	node, err := persistenceid.Parse(nodeID)
	if err != nil {
		return false, app.ErrNotFound
	}
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return false, app.ErrNotFound
	}
	asset, err := persistenceid.Parse(assetID)
	if err != nil {
		return false, app.ErrNotFound
	}
	db := r.dbFor(ctx)
	if err = lockCanvas(db, scope.TenantID, scope.WorkspaceID, projectID, canvas); err != nil {
		return false, readErr(err)
	}
	result := scopeQuery(db.Model(&canvasnodeRow{}), scope).
		Where("id = ? AND project_id = ? AND canvas_id = ? AND type = ? AND active_task_run_id = ?", node, project, canvas, nodeType, run).
		Updates(map[string]any{"active_task_run_id": nil, "resource_id": nil, "resource_asset_id": nil, "selected_output_id": run, "selected_asset_id": asset, "updated_by": scope.CallerID, "updated_at": updatedAt.UTC()})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) BindGeneratedText(ctx context.Context, scope app.Scope, projectID, canvasID, nodeID, taskRunID, content string, updatedAt time.Time) (bool, error) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return false, app.ErrNotFound
	}
	canvas, err := persistenceid.Parse(canvasID)
	if err != nil {
		return false, app.ErrNotFound
	}
	node, err := persistenceid.Parse(nodeID)
	if err != nil {
		return false, app.ErrNotFound
	}
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return false, app.ErrNotFound
	}
	return r.updateSelectedOutputText(ctx, scope, project, canvas, node, &run, run, content, updatedAt)
}

func (r *Repository) SelectGeneratedText(ctx context.Context, scope app.Scope, projectID, canvasID, nodeID, taskRunID, content string, updatedAt time.Time) (bool, error) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return false, app.ErrNotFound
	}
	canvas, err := persistenceid.Parse(canvasID)
	if err != nil {
		return false, app.ErrNotFound
	}
	node, err := persistenceid.Parse(nodeID)
	if err != nil {
		return false, app.ErrNotFound
	}
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return false, app.ErrNotFound
	}
	return r.updateSelectedOutputText(ctx, scope, project, canvas, node, nil, run, content, updatedAt)
}

func (r *Repository) SelectGeneratedAsset(ctx context.Context, scope app.Scope, projectID, canvasID, nodeID, taskRunID, assetID string, nodeType domain.NodeType, updatedAt time.Time) (bool, error) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return false, app.ErrNotFound
	}
	canvas, err := persistenceid.Parse(canvasID)
	if err != nil {
		return false, app.ErrNotFound
	}
	node, err := persistenceid.Parse(nodeID)
	if err != nil {
		return false, app.ErrNotFound
	}
	run, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return false, app.ErrNotFound
	}
	asset, err := persistenceid.Parse(assetID)
	if err != nil {
		return false, app.ErrNotFound
	}
	db := r.dbFor(ctx)
	if err = lockCanvas(db, scope.TenantID, scope.WorkspaceID, projectID, canvas); err != nil {
		return false, readErr(err)
	}
	result := scopeQuery(db.Model(&canvasnodeRow{}), scope).
		Where("id = ? AND project_id = ? AND canvas_id = ? AND type = ?", node, project, canvas, nodeType).
		Updates(map[string]any{"resource_id": nil, "resource_asset_id": nil, "selected_output_id": run, "selected_asset_id": asset, "updated_by": scope.CallerID, "updated_at": updatedAt.UTC()})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) updateSelectedOutputText(
	ctx context.Context,
	scope app.Scope,
	project, canvas, node persistenceid.UUID,
	expectedActiveRun *persistenceid.UUID,
	selectedOutputID persistenceid.UUID,
	content string,
	updatedAt time.Time,
) (bool, error) {
	matched := false
	err := r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		if lockErr := lockCanvas(tx, scope.TenantID, scope.WorkspaceID, project.String(), canvas); lockErr != nil {
			return readErr(lockErr)
		}
		var current canvasnodeRow
		query := scopeQuery(tx.Clauses(clause.Locking{Strength: "UPDATE"}), scope).
			Where("id = ? AND project_id = ? AND canvas_id = ? AND type = ?", node, project, canvas, domain.NodeTypeTextGeneration)
		if expectedActiveRun != nil {
			query = query.Where("active_task_run_id = ?", *expectedActiveRun)
		}
		if err := query.First(&current).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		item, err := fromRow(current)
		if err != nil {
			return err
		}
		item.SelectedOutputText = content
		encoded, err := encodeCanvasNodeData(item)
		if err != nil {
			return err
		}
		updates := map[string]any{
			"node_data": encoded, "selected_output_id": selectedOutputID, "selected_asset_id": nil,
			"updated_by": scope.CallerID, "updated_at": updatedAt.UTC(),
		}
		if expectedActiveRun != nil {
			updates["active_task_run_id"] = nil
		}
		result := tx.Model(&current).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		matched = result.RowsAffected == 1
		return nil
	})
	return matched, err
}

func (r *Repository) Delete(ctx context.Context, item domain.CanvasNode) (string, []string, error) {
	row, err := toRow(item)
	if err != nil {
		return "", nil, err
	}
	db := r.dbFor(ctx)
	if err = lockCanvas(db, item.TenantID, item.WorkspaceID, item.ProjectID, row.CanvasID); err != nil {
		return "", nil, readErr(err)
	}
	var current canvasnodeRow
	query := scopeQuery(db.Clauses(clause.Locking{Strength: "UPDATE"}), app.Scope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID}).
		Where("id = ? AND project_id = ? AND canvas_id = ?", row.ID, row.ProjectID, row.CanvasID)
	if err = query.First(&current).Error; err != nil {
		return "", nil, readErr(err)
	}
	revokedTaskRunID := optionalUUIDString(current.ActiveTaskRunID)
	releasedAssetIDs := make([]string, 0, 2)
	if current.SelectedAssetID != nil && (current.Type == int16(domain.NodeTypeImageGeneration) ||
		(current.Type == int16(domain.NodeTypeVideoGeneration) && current.SelectedOutputID == nil)) {
		releasedAssetIDs = append(releasedAssetIDs, current.SelectedAssetID.String())
	}
	if current.AssetID != nil {
		releasedAssetIDs = append(releasedAssetIDs, current.AssetID.String())
	}
	result := db.Model(&current).Updates(map[string]any{
		"active_task_run_id": nil,
		"updated_by":         item.UpdatedBy,
		"updated_at":         item.UpdatedAt,
		"deleted_at":         row.DeletedAt,
	})
	if result.Error != nil {
		return "", nil, result.Error
	}
	return revokedTaskRunID, releasedAssetIDs, nil
}

func (r *Repository) DeletionMatches(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID, nodeID string,
	revision int64,
	deletedAt time.Time,
) (bool, error) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return false, nil
	}
	canvas, err := persistenceid.Parse(canvasID)
	if err != nil {
		return false, nil
	}
	node, err := persistenceid.Parse(nodeID)
	if err != nil {
		return false, nil
	}
	query := scopeQuery(r.dbFor(ctx).Unscoped().Model(&canvasnodeRow{}), scope).
		Where("id = ? AND project_id = ? AND canvas_id = ? AND revision = ? AND deleted_at = ?",
			node, project, canvas, revision, deletedAt.UnixMilli())
	var count int64
	if err = query.Count(&count).Error; err != nil {
		return false, err
	}
	return count == 1, nil
}

func (r *Repository) DeleteByCanvas(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID string,
	now time.Time,
) ([]domain.CanvasNode, []string, error) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return nil, nil, app.ErrNotFound
	}
	canvas, err := persistenceid.Parse(canvasID)
	if err != nil {
		return nil, nil, app.ErrNotFound
	}
	return r.deleteScopedCanvasNodes(ctx, scope, now, "project_id = ? AND canvas_id = ?", project, canvas)
}

func (r *Repository) deleteScopedCanvasNodes(
	ctx context.Context,
	scope app.Scope,
	now time.Time,
	where string,
	args ...any,
) ([]domain.CanvasNode, []string, error) {
	db := r.dbFor(ctx)
	var rows []canvasnodeRow
	query := scopeQuery(db.Clauses(clause.Locking{Strength: "UPDATE"}), scope).Where(where, args...).
		Order("canvas_id ASC").Order("storyboard_rank ASC").Order("id ASC")
	if err := query.Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	if len(rows) == 0 {
		return nil, nil, nil
	}
	ids := make([]persistenceid.UUID, 0, len(rows))
	deleted := make([]domain.CanvasNode, 0, len(rows))
	deletedAt := now.UTC()
	for index := range rows {
		ids = append(ids, rows[index].ID)
		item, mapErr := fromRow(rows[index])
		if mapErr != nil {
			return nil, nil, mapErr
		}
		item.UpdatedBy = scope.CallerID
		item.UpdatedAt = deletedAt
		item.DeletedAt = &deletedAt
		deleted = append(deleted, item)
	}
	releasedAssetIDs := make([]string, 0, len(rows)*2)
	for index := range rows {
		if rows[index].AssetID != nil {
			releasedAssetIDs = append(releasedAssetIDs, rows[index].AssetID.String())
		}
		if rows[index].SelectedAssetID != nil && (rows[index].Type == int16(domain.NodeTypeImageGeneration) ||
			(rows[index].Type == int16(domain.NodeTypeVideoGeneration) && rows[index].SelectedOutputID == nil)) {
			releasedAssetIDs = append(releasedAssetIDs, rows[index].SelectedAssetID.String())
		}
	}
	result := scopeQuery(db.Model(&canvasnodeRow{}), scope).Where("id IN ?", ids).Updates(map[string]any{
		"active_task_run_id": nil,
		"updated_by":         scope.CallerID,
		"updated_at":         deletedAt,
		"deleted_at":         soft_delete.DeletedAt(deletedAt.UnixMilli()),
	})
	if result.Error != nil {
		return nil, nil, result.Error
	}
	if result.RowsAffected != int64(len(rows)) {
		return nil, nil, errors.New("delete scoped canvas_nodes lost locked rows")
	}
	return deleted, releasedAssetIDs, nil
}

func (r *Repository) ListProjectAssets(
	ctx context.Context,
	scope app.Scope,
	projectID string,
	limit int,
) ([]app.ProjectAssetCandidate, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return nil, app.ErrNotFound
	}
	if limit < 1 {
		return []app.ProjectAssetCandidate{}, nil
	}
	var rows []projectLibraryAssetRow
	if err = r.projectLibraryAssetsQuery(ctx, scope, projectUUID, "", 0, 0, limit).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]app.ProjectAssetCandidate, 0, len(rows))
	for _, row := range rows {
		if item, ok := projectAssetCandidateFromRow(scope, row); ok {
			out = append(out, item)
		}
	}
	return out, nil
}

func (r *Repository) SearchCanvasNodeAssets(
	ctx context.Context,
	scope app.Scope,
	projectID, keyword string,
	resourceTypes []domainresource.Type,
	cursor *app.CanvasNodeAssetSearchCursor,
	limit int,
) (app.CanvasNodeAvailableAssetWindow, error) {
	empty := app.CanvasNodeAvailableAssetWindow{}
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return empty, app.ErrNotFound
	}
	if limit < 1 {
		return empty, nil
	}
	fetchLimit := limit + 1
	type candidate struct {
		item   app.CanvasNodeAvailableAsset
		cursor app.CanvasNodeAssetSearchCursor
	}
	candidates := make([]candidate, 0, fetchLimit)
	var scanCursor *app.CanvasNodeAssetSearchCursor
	if cursor != nil {
		if _, parseErr := persistenceid.Parse(cursor.ID); parseErr != nil {
			return empty, app.ErrNotFound
		}
		position := *cursor
		scanCursor = &position
	}
	for len(candidates) < fetchLimit {
		var resourceRows []projectLibraryResourceRow
		resourceQuery := r.projectLibraryResourcesQuery(ctx, scope, projectUUID, keyword)
		if len(resourceTypes) > 0 {
			resourceQuery = resourceQuery.Where("resources.type IN ?", resourceTypes)
		}
		if scanCursor != nil {
			cursorID, parseErr := persistenceid.Parse(scanCursor.ID)
			if parseErr != nil {
				return empty, app.ErrNotFound
			}
			resourceQuery = resourceQuery.Where("resources.created_at < ? OR (resources.created_at = ? AND resources.id < ?)", scanCursor.CreatedAt, scanCursor.CreatedAt, cursorID)
		}
		if err = resourceQuery.Select("resources.id AS resource_id, resources.type, resources.name, resources.description, resources.primary_resource_asset_id, resources.revision, resources.created_at, resources.updated_at").Order("resources.created_at DESC").Order("resources.id DESC").Limit(fetchLimit).Scan(&resourceRows).Error; err != nil {
			return empty, err
		}
		if len(resourceRows) == 0 {
			break
		}
		looks, looksErr := r.availableLooksByResourceIDs(ctx, scope, resourceRows)
		if looksErr != nil {
			return empty, looksErr
		}
		for _, row := range resourceRows {
			children := make([]app.CanvasNodeAvailableAssetItem, 0, len(looks[row.ResourceID.String()]))
			for _, look := range looks[row.ResourceID.String()] {
				if look.CurrentAssetID == nil {
					children = append(children, app.CanvasNodeAvailableAssetItem{
						Asset:           domainasset.Asset{MediaType: domainasset.MediaType(look.SlotMediaType)},
						ResourceAssetID: look.ResourceAssetID.String(), Name: look.Name,
						Primary:    look.PrimaryResourceAssetID != nil && *look.PrimaryResourceAssetID == look.ResourceAssetID,
						Generating: look.ActiveTaskRunID != nil,
					})
					continue
				}
				item, ok := projectAssetCandidateFromRow(scope, look)
				if ok {
					children = append(children, app.CanvasNodeAvailableAssetItem{Asset: item.Asset, ResourceAssetID: item.ResourceAssetID, Name: item.Name, Primary: item.Primary, Generating: look.ActiveTaskRunID != nil})
				}
			}
			if len(children) == 0 {
				continue
			}
			resourceID := row.ResourceID.String()
			candidates = append(candidates, candidate{
				item:   app.CanvasNodeAvailableAsset{Source: app.CanvasNodeAssetSourceProjectResource, Name: row.Name, Description: row.Description, ResourceID: resourceID, ResourceType: domainresource.Type(row.Type), Assets: children},
				cursor: app.CanvasNodeAssetSearchCursor{CreatedAt: row.CreatedAt, ID: resourceID},
			})
		}
		last := resourceRows[len(resourceRows)-1]
		scanCursor = &app.CanvasNodeAssetSearchCursor{CreatedAt: last.CreatedAt, ID: last.ResourceID.String()}
		if len(resourceRows) < fetchLimit {
			break
		}
	}

	result := make([]app.CanvasNodeAvailableAsset, 0, min(limit, len(candidates)))
	for _, item := range candidates[:min(limit, len(candidates))] {
		result = append(result, item.item)
	}
	var nextCursor *app.CanvasNodeAssetSearchCursor
	if len(candidates) > limit {
		position := candidates[limit-1].cursor
		nextCursor = &position
	}
	return app.CanvasNodeAvailableAssetWindow{Items: result, NextCursor: nextCursor}, nil
}

type projectLibraryResourceRow struct {
	ResourceID             persistenceid.UUID
	Type                   int16
	Name                   string
	Description            string
	PrimaryResourceAssetID *persistenceid.UUID
	Revision               int64
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

func (r *Repository) ResolveCurrentResourceAsset(
	ctx context.Context,
	scope app.Scope,
	projectID string,
	resourceAssetID string,
) (app.CanvasResourceAssetReference, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return app.CanvasResourceAssetReference{}, err
	}
	resourceAssetUUID, err := persistenceid.Parse(resourceAssetID)
	if err != nil {
		return app.CanvasResourceAssetReference{}, err
	}
	var rows []projectLibraryAssetRow
	query := qualifiedScopeQuery(
		r.db.WithContext(ctx).Table("resource_assets").
			Select("assets.id AS asset_id, assets.owner_type, assets.owner_id, assets.file_name, assets.media_type, assets.content_type, assets.size_bytes, assets.artifact_id, assets.created_by, assets.created_at, resources.id AS resource_id, resources.type, resources.name AS resource_name, resources.description, resource_assets.id AS resource_asset_id, resource_assets.name, resource_assets.revision AS resource_asset_revision, resources.primary_resource_asset_id").
			Joins("JOIN resources ON resources.id = resource_assets.resource_id AND resources.deleted_at = 0").
			Joins("JOIN assets ON assets.id = resource_assets.current_asset_id AND assets.deleted_at = 0").
			Where("resource_assets.id = ? AND resource_assets.deleted_at = 0", resourceAssetUUID).
			Where("(resources.owner_type = ? AND resources.owner_id = ?) OR resources.owner_type = ?", int16(domainresource.OwnerProject), projectUUID, int16(domainresource.OwnerOfficial)),
		"resources",
		scope,
	)
	query = qualifiedScopeQuery(query, "assets", scope)
	if err = query.Limit(1).Scan(&rows).Error; err != nil {
		return app.CanvasResourceAssetReference{}, err
	}
	if len(rows) != 1 {
		return app.CanvasResourceAssetReference{}, app.ErrNotFound
	}
	candidate, ok := projectAssetCandidateFromRow(scope, rows[0])
	if !ok {
		return app.CanvasResourceAssetReference{}, app.ErrNotFound
	}
	return app.CanvasResourceAssetReference{
		ResourceID:      rows[0].ResourceID.String(),
		ResourceAssetID: resourceAssetID,
		Revision:        rows[0].ResourceAssetRevision,
		Name:            candidate.Name,
		IsPrimary:       rows[0].PrimaryResourceAssetID != nil && rows[0].PrimaryResourceAssetID.String() == resourceAssetID,
		Asset:           candidate.Asset,
	}, nil
}

func (r *Repository) BatchResolveCurrentResourceAssets(
	ctx context.Context,
	scope app.Scope,
	projectID string,
	resourceAssetIDs []string,
) (map[string]app.CanvasResourceAssetReference, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return nil, err
	}
	ids := make([]persistenceid.UUID, 0, len(resourceAssetIDs))
	seen := make(map[string]struct{}, len(resourceAssetIDs))
	for _, id := range resourceAssetIDs {
		parsed, parseErr := persistenceid.Parse(id)
		if parseErr != nil {
			return nil, parseErr
		}
		canonicalID := parsed.String()
		if _, exists := seen[canonicalID]; exists {
			continue
		}
		seen[canonicalID] = struct{}{}
		ids = append(ids, parsed)
	}
	result := make(map[string]app.CanvasResourceAssetReference, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var rows []projectLibraryAssetRow
	query := qualifiedScopeQuery(
		r.db.WithContext(ctx).Table("resource_assets").
			Select("assets.id AS asset_id, assets.owner_type, assets.owner_id, assets.file_name, assets.media_type, assets.content_type, assets.size_bytes, assets.artifact_id, assets.created_by, assets.created_at, resources.id AS resource_id, resources.type, resources.name AS resource_name, resources.description, resource_assets.id AS resource_asset_id, resource_assets.name, resource_assets.revision AS resource_asset_revision, resources.primary_resource_asset_id").
			Joins("JOIN resources ON resources.id = resource_assets.resource_id AND resources.deleted_at = 0").
			Joins("JOIN assets ON assets.id = resource_assets.current_asset_id AND assets.deleted_at = 0").
			Where("resource_assets.id IN ? AND resource_assets.deleted_at = 0", ids).
			Where("(resources.owner_type = ? AND resources.owner_id = ?) OR resources.owner_type = ?", int16(domainresource.OwnerProject), projectUUID, int16(domainresource.OwnerOfficial)),
		"resources",
		scope,
	)
	query = qualifiedScopeQuery(query, "assets", scope)
	if err = query.Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		candidate, ok := projectAssetCandidateFromRow(scope, row)
		if !ok {
			continue
		}
		id := row.ResourceAssetID.String()
		result[id] = app.CanvasResourceAssetReference{
			ResourceID:      row.ResourceID.String(),
			ResourceAssetID: id,
			Revision:        row.ResourceAssetRevision,
			Name:            candidate.Name,
			IsPrimary:       row.PrimaryResourceAssetID != nil && row.PrimaryResourceAssetID.String() == id,
			Asset:           candidate.Asset,
		}
	}
	return result, nil
}

func (r *Repository) ResolvePrimaryResourceAsset(
	ctx context.Context,
	scope app.Scope,
	projectID string,
	resourceID string,
) (app.CanvasResourceAssetReference, error) {
	items, err := r.BatchResolvePrimaryResourceAssets(ctx, scope, projectID, []string{resourceID})
	if err != nil {
		return app.CanvasResourceAssetReference{}, err
	}
	item, ok := items[resourceID]
	if !ok {
		return app.CanvasResourceAssetReference{}, app.ErrNotFound
	}
	return item, nil
}

func (r *Repository) BatchResolvePrimaryResourceAssets(
	ctx context.Context,
	scope app.Scope,
	projectID string,
	resourceIDs []string,
) (map[string]app.CanvasResourceAssetReference, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return nil, err
	}
	ids := make([]persistenceid.UUID, 0, len(resourceIDs))
	seen := make(map[string]struct{}, len(resourceIDs))
	for _, id := range resourceIDs {
		parsed, parseErr := persistenceid.Parse(id)
		if parseErr != nil {
			return nil, parseErr
		}
		canonicalID := parsed.String()
		if _, exists := seen[canonicalID]; exists {
			continue
		}
		seen[canonicalID] = struct{}{}
		ids = append(ids, parsed)
	}
	result := make(map[string]app.CanvasResourceAssetReference, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var rows []projectLibraryAssetRow
	query := qualifiedScopeQuery(
		r.db.WithContext(ctx).Table("resources").
			Select("assets.id AS asset_id, assets.owner_type, assets.owner_id, assets.file_name, assets.media_type, assets.content_type, assets.size_bytes, assets.artifact_id, assets.created_by, assets.created_at, resources.id AS resource_id, resources.type, resources.name AS resource_name, resources.description, resource_assets.id AS resource_asset_id, resource_assets.name, resource_assets.revision AS resource_asset_revision, resources.primary_resource_asset_id").
			Joins("JOIN resource_assets ON resource_assets.id = resources.primary_resource_asset_id AND resource_assets.deleted_at = 0").
			Joins("JOIN assets ON assets.id = resource_assets.current_asset_id AND assets.deleted_at = 0").
			Where("resources.id IN ? AND resources.deleted_at = 0", ids).
			Where("(resources.owner_type = ? AND resources.owner_id = ?) OR resources.owner_type = ?", int16(domainresource.OwnerProject), projectUUID, int16(domainresource.OwnerOfficial)),
		"resources",
		scope,
	)
	query = qualifiedScopeQuery(query, "assets", scope)
	if err = query.Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		candidate, ok := projectAssetCandidateFromRow(scope, row)
		if !ok {
			continue
		}
		resourceID := row.ResourceID.String()
		result[resourceID] = app.CanvasResourceAssetReference{
			ResourceID: resourceID, ResourceAssetID: row.ResourceAssetID.String(), Revision: row.ResourceAssetRevision,
			Name: candidate.Name, IsPrimary: true, Asset: candidate.Asset,
		}
	}
	return result, nil
}

func (r *Repository) projectLibraryResourcesQuery(
	ctx context.Context,
	scope app.Scope,
	projectUUID persistenceid.UUID,
	keyword string,
) *gorm.DB {
	base := r.db.WithContext(ctx)
	projectVisible := base.Session(&gorm.Session{NewDB: true}).
		Table("projects").
		Select("1").
		Where("projects.id = ? AND projects.tenant_id = ? AND projects.deleted_at = 0", projectUUID, scope.TenantID)
	if scope.WorkspaceID == nil {
		projectVisible = projectVisible.Where("projects.workspace_id IS NULL")
	} else {
		projectVisible = projectVisible.Where("projects.workspace_id = ?", *scope.WorkspaceID)
	}
	q := qualifiedScopeQuery(
		base.Table("resources"),
		"resources",
		scope,
	)
	q = q.Where("resources.deleted_at = 0").
		Where("EXISTS (?)", projectVisible).
		Where(
			base.Session(&gorm.Session{NewDB: true}).
				Where("resources.owner_type = ? AND resources.owner_id = ?", int16(domainresource.OwnerProject), projectUUID).
				Or("resources.owner_type = ?", int16(domainresource.OwnerOfficial)),
		)
	q = q.Where(`EXISTS (SELECT 1 FROM resource_assets
        WHERE resource_assets.resource_id = resources.id AND resource_assets.deleted_at = 0
        AND TRIM(resource_assets.name) <> '')`)
	if keyword != "" {
		pattern := "%" + keyword + "%"
		q = q.Where("resources.name LIKE ? OR resources.description LIKE ?", pattern, pattern)
	}
	return q
}

func resourceIDsOf(rows []projectLibraryResourceRow) []persistenceid.UUID {
	ids := make([]persistenceid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ResourceID)
	}
	return ids
}

func (r *Repository) availableLooksByResourceIDs(
	ctx context.Context,
	scope app.Scope,
	resources []projectLibraryResourceRow,
) (map[string][]projectLibraryAssetRow, error) {
	out := make(map[string][]projectLibraryAssetRow, len(resources))
	ids := resourceIDsOf(resources)
	if len(ids) == 0 {
		return out, nil
	}
	var rows []projectLibraryAssetRow
	q := qualifiedScopeQuery(
		r.db.WithContext(ctx).Table("resource_assets").
			Select("resource_assets.current_asset_id, resource_assets.media_type AS slot_media_type, drafts.active_task_run_id, assets.id AS asset_id, assets.owner_type, assets.owner_id, assets.file_name, assets.media_type, assets.content_type, assets.size_bytes, assets.artifact_id, assets.created_by, assets.created_at, resources.id AS resource_id, resources.type, resources.name AS resource_name, resources.description, resource_assets.id AS resource_asset_id, resource_assets.name, resource_assets.revision AS resource_asset_revision, resources.primary_resource_asset_id").
			Joins("JOIN resources ON resources.id = resource_assets.resource_id AND resources.deleted_at = 0").
			Joins(`LEFT JOIN assets ON assets.id = resource_assets.current_asset_id AND assets.deleted_at = 0 AND (
				(resources.owner_type = ? AND assets.owner_type = ? AND assets.owner_id = resources.id)
				OR
				(resources.owner_type = ? AND assets.owner_type = ? AND assets.owner_id = resources.owner_id)
			)`,
				int16(domainresource.OwnerProject), int16(domainasset.OwnerResource),
				int16(domainresource.OwnerOfficial), int16(domainasset.OwnerOfficial),
			).
			Joins("LEFT JOIN resource_asset_image_generation_drafts AS drafts ON drafts.id = resource_assets.image_generation_draft_id AND drafts.resource_asset_id = resource_assets.id AND drafts.resource_id = resources.id AND drafts.tenant_id = resources.tenant_id AND drafts.deleted_at = 0").
			Where("resource_assets.resource_id IN ? AND resource_assets.deleted_at = 0 AND TRIM(resource_assets.name) <> '' AND resource_assets.media_type IN ?", ids, []int16{
				int16(domainasset.MediaImage),
				int16(domainasset.MediaVideo),
				int16(domainasset.MediaAudio),
			}).
			Order("CASE WHEN resources.primary_resource_asset_id = resource_assets.id THEN 0 ELSE 1 END").
			Order("resource_assets.sequence_no ASC").
			Order("resource_assets.id ASC"),
		"resources",
		scope,
	)
	// A missing current result is a visible slot, never an authorized Asset.
	// Nonempty references must still pass the complete Asset scope/owner guard.
	assetVisible := qualifiedScopeQuery(r.db.Session(&gorm.Session{NewDB: true}), "assets", scope).Where("assets.id IS NOT NULL")
	q = q.Where(r.db.Session(&gorm.Session{NewDB: true}).Where("resource_assets.current_asset_id IS NULL").Or(assetVisible))
	if err := q.Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		resourceID := row.ResourceID.String()
		out[resourceID] = append(out[resourceID], row)
	}
	return out, nil
}

const projectLibraryAssetRefColumns = "resource_assets.current_asset_id, resources.id AS resource_id, resources.type, resources.name AS resource_name, resources.description, resource_assets.id AS resource_asset_id, resource_assets.name, resources.primary_resource_asset_id, resources.updated_at AS resource_updated_at, resource_assets.sequence_no"

const projectLibraryAssetColumns = "assets.id AS asset_id, assets.owner_type, assets.owner_id, assets.file_name, assets.media_type, assets.content_type, assets.size_bytes, assets.artifact_id, assets.created_by, assets.created_at, library_assets.resource_id, library_assets.type, library_assets.resource_name, library_assets.description, library_assets.resource_asset_id, library_assets.name, library_assets.primary_resource_asset_id"

type projectLibraryAssetRow struct {
	CurrentAssetID         *persistenceid.UUID
	SlotMediaType          int16
	ActiveTaskRunID        *persistenceid.UUID
	AssetID                persistenceid.UUID
	OwnerType              int16
	OwnerID                persistenceid.UUID
	FileName               string
	MediaType              int16
	ContentType            string
	SizeBytes              int64
	ArtifactID             string
	CreatedBy              string
	CreatedAt              time.Time
	ResourceID             persistenceid.UUID
	Type                   int16
	ResourceName           string
	Description            string
	ResourceAssetID        persistenceid.UUID
	ResourceAssetRevision  int64
	Name                   string
	PrimaryResourceAssetID *persistenceid.UUID
}

func (r *Repository) projectLibraryAssetsQuery(
	ctx context.Context,
	scope app.Scope,
	projectUUID persistenceid.UUID,
	keyword string,
	resourceType domainresource.Type,
	offset, limit int,
) *gorm.DB {
	refs := r.projectLibraryAssetRefsQuery(ctx, scope, projectUUID, keyword, resourceType).
		Select(projectLibraryAssetRefColumns).
		Offset(offset).
		Limit(limit)
	return qualifiedScopeQuery(
		r.db.WithContext(ctx).
			Table("(?) AS library_assets", refs).
			Select(projectLibraryAssetColumns).
			Joins("JOIN assets ON assets.id = library_assets.current_asset_id AND assets.deleted_at = 0"),
		"assets",
		scope,
	).
		Order("library_assets.resource_updated_at DESC").
		Order("library_assets.resource_id DESC").
		Order("CASE WHEN library_assets.primary_resource_asset_id = library_assets.resource_asset_id THEN 0 ELSE 1 END").
		Order("library_assets.sequence_no ASC").
		Order("library_assets.resource_asset_id ASC")
}

func (r *Repository) projectLibraryAssetRefsBase(
	ctx context.Context,
	scope app.Scope,
	projectUUID persistenceid.UUID,
	keyword string,
	resourceType domainresource.Type,
) *gorm.DB {
	q := qualifiedScopeQuery(
		r.db.WithContext(ctx).Table("projects").
			Joins("JOIN resources ON resources.owner_type = ? AND resources.owner_id = projects.id AND resources.deleted_at = 0", int16(domainresource.OwnerProject)).
			Joins("JOIN resource_assets ON resource_assets.resource_id = resources.id AND resource_assets.deleted_at = 0"),
		"resources",
		scope,
	)
	q = q.Where("projects.id = ? AND projects.tenant_id = ? AND projects.deleted_at = 0", projectUUID, scope.TenantID)
	if scope.WorkspaceID == nil {
		q = q.Where("projects.workspace_id IS NULL")
	} else {
		q = q.Where("projects.workspace_id = ?", *scope.WorkspaceID)
	}
	if keyword != "" {
		pattern := "%" + keyword + "%"
		q = q.Where(
			"resources.name LIKE ? OR resources.description LIKE ? OR resource_assets.name LIKE ?",
			pattern, pattern, pattern,
		)
	}
	if resourceType.Valid() {
		q = q.Where("resources.type = ?", int16(resourceType))
	}
	return q
}

func (r *Repository) projectLibraryAssetRefsQuery(
	ctx context.Context,
	scope app.Scope,
	projectUUID persistenceid.UUID,
	keyword string,
	resourceType domainresource.Type,
) *gorm.DB {
	return r.projectLibraryAssetRefsBase(ctx, scope, projectUUID, keyword, resourceType).
		Order("resources.updated_at DESC").
		Order("resources.id DESC").
		Order("CASE WHEN resources.primary_resource_asset_id = resource_assets.id THEN 0 ELSE 1 END").
		Order("resource_assets.sequence_no ASC").
		Order("resource_assets.id ASC")
}

func projectAssetCandidateFromRow(scope app.Scope, row projectLibraryAssetRow) (app.ProjectAssetCandidate, bool) {
	name := strings.TrimSpace(row.Name)
	assetID := row.AssetID.String()
	if name == "" || assetID == "" || !domainasset.MediaType(row.MediaType).Valid() {
		return app.ProjectAssetCandidate{}, false
	}
	primary := row.PrimaryResourceAssetID != nil && *row.PrimaryResourceAssetID == row.ResourceAssetID
	return app.ProjectAssetCandidate{
		Asset: domainasset.Asset{
			ID: assetID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
			OwnerType: domainasset.OwnerType(row.OwnerType), OwnerID: row.OwnerID.String(),
			FileName: row.FileName, MediaType: domainasset.MediaType(row.MediaType),
			ContentType: row.ContentType, SizeBytes: row.SizeBytes, ArtifactID: row.ArtifactID,
			CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt,
		},
		Name: name, ResourceAssetID: row.ResourceAssetID.String(), ResourceID: row.ResourceID.String(), ResourceName: row.ResourceName,
		Description: row.Description, Primary: primary,
	}, true
}

func scopeQuery(db *gorm.DB, scope app.Scope) *gorm.DB {
	q := db.Where("tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return q.Where("workspace_id IS NULL")
	}
	return q.Where("workspace_id = ?", *scope.WorkspaceID)
}

func qualifiedScopeQuery(db *gorm.DB, table string, scope app.Scope) *gorm.DB {
	q := db.Where(table+".tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return q.Where(table + ".workspace_id IS NULL")
	}
	return q.Where(table+".workspace_id = ?", *scope.WorkspaceID)
}

type canvasScopeRow struct {
	ID          persistenceid.UUID
	TenantID    string
	WorkspaceID *string
	ProjectID   persistenceid.UUID
	Revision    int64
	DeletedAt   soft_delete.DeletedAt
}

func (canvasScopeRow) TableName() string { return "canvases" }

type projectScopeRow struct {
	ID          persistenceid.UUID
	TenantID    string
	WorkspaceID *string
	DeletedAt   soft_delete.DeletedAt
}

func (projectScopeRow) TableName() string { return "projects" }

type assetScopeRow struct {
	ID          persistenceid.UUID
	TenantID    string
	WorkspaceID *string
	OwnerType   int16
	OwnerID     persistenceid.UUID
	MediaType   int16
}

func (assetScopeRow) TableName() string { return "assets" }
func lockCanvas(db *gorm.DB, tenant string, workspace *string, project string, canvas persistenceid.UUID) error {
	p, e := persistenceid.Parse(project)
	if e != nil {
		return app.ErrNotFound
	}
	return findCanvas(db, app.Scope{TenantID: tenant, WorkspaceID: workspace}, p, canvas, true)
}

func findCanvas(db *gorm.DB, scope app.Scope, project, canvas persistenceid.UUID, lock bool) error {
	// Lock in parent-to-child order so deletion cannot commit between admission
	// and the caller's node write. Async cleanup may leave child rows temporarily.
	parent := scopeQuery(db.Model(&projectScopeRow{}), scope)
	if lock {
		parent = parent.Clauses(clause.Locking{Strength: "SHARE"})
	}
	var projectRow projectScopeRow
	if err := parent.Where("id = ?", project).First(&projectRow).Error; err != nil {
		return err
	}
	query := scopeQuery(db.Model(&canvasScopeRow{}), scope)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var row canvasScopeRow
	return query.Where("id = ? AND project_id = ?", canvas, project).First(&row).Error
}

func (r *Repository) LockCanvas(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID string,
) (int64, error) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	canvas, err := persistenceid.Parse(canvasID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	if err = findCanvas(r.dbFor(ctx), scope, project, canvas, true); err != nil {
		return 0, readErr(err)
	}
	var row canvasScopeRow
	query := scopeQuery(r.dbFor(ctx).Model(&canvasScopeRow{}).Clauses(clause.Locking{Strength: "UPDATE"}), scope)
	if err = query.Where("id = ? AND project_id = ?", canvas, project).First(&row).Error; err != nil {
		return 0, readErr(err)
	}
	return row.Revision, nil
}

func (r *Repository) AdvanceCanvasRevision(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID string,
	expectedRevision int64,
	now time.Time,
) (int64, error) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	canvas, err := persistenceid.Parse(canvasID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	result := scopeQuery(r.dbFor(ctx).Model(&canvasScopeRow{}), scope).
		Where("id = ? AND project_id = ? AND revision = ?", canvas, project, expectedRevision).
		Updates(map[string]any{"revision": expectedRevision + 1, "updated_at": now.UTC()})
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected != 1 {
		return 0, app.ErrRevisionConflict
	}
	return expectedRevision + 1, nil
}

func (r *Repository) UpdateStoryboardRanks(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID string,
	ranks map[string]int64,
	now time.Time,
) error {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return app.ErrNotFound
	}
	canvas, err := persistenceid.Parse(canvasID)
	if err != nil {
		return app.ErrNotFound
	}
	for rawID, rank := range ranks {
		id, parseErr := persistenceid.Parse(rawID)
		if parseErr != nil {
			return app.ErrNotFound
		}
		result := scopeQuery(r.dbFor(ctx).Model(&canvasnodeRow{}), scope).
			Where("id = ? AND project_id = ? AND canvas_id = ? AND type = ?", id, project, canvas, domain.NodeTypeVideoGeneration).
			Updates(map[string]any{
				"storyboard_rank": rank,
				"revision":        gorm.Expr("revision + 1"),
				"updated_by":      scope.CallerID,
				"updated_at":      now.UTC(),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return app.ErrNotFound
		}
	}
	return nil
}
func toRow(s domain.CanvasNode) (canvasnodeRow, error) {
	id, e := persistenceid.Parse(s.ID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	p, e := persistenceid.Parse(s.ProjectID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	ep, e := persistenceid.Parse(s.CanvasID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	activeRunID, e := persistenceid.ParseOptional(s.ActiveTaskRunID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	selectedOutputID, e := persistenceid.ParseOptional(s.SelectedOutputID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	selectedAssetID, e := persistenceid.ParseOptional(s.SelectedAssetID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	assetID, e := persistenceid.ParseOptional(s.AssetID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	resourceAssetID, e := persistenceid.ParseOptional(s.ResourceAssetID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	resourceID, e := persistenceid.ParseOptional(s.ResourceID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	if s.ReferenceType == domain.ReferenceTypeUnspecified {
		if inferred, ok := domain.InferMaterialReferenceType(s); ok {
			s.ReferenceType = inferred
		}
	}
	nodeData, e := encodeCanvasNodeData(s)
	if e != nil {
		return canvasnodeRow{}, e
	}
	row := canvasnodeRow{ID: id, TenantID: s.TenantID, WorkspaceID: s.WorkspaceID, ProjectID: p, CanvasID: ep,
		Type: int16(s.Type), StoryboardRank: s.StoryboardRank,
		AssetID: assetID, ResourceID: resourceID, ResourceAssetID: resourceAssetID, NodeData: nodeData,
		Revision: s.Revision, ActiveTaskRunID: activeRunID,
		SelectedOutputID: selectedOutputID, SelectedAssetID: selectedAssetID, CreatedBy: s.CreatedBy,
		UpdatedBy: s.UpdatedBy, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt}
	if s.DeletedAt != nil {
		row.DeletedAt = soft_delete.DeletedAt(s.DeletedAt.UnixMilli())
	}
	return row, nil
}
func fromRow(r canvasnodeRow) (domain.CanvasNode, error) {
	nodeType := domain.NodeType(r.Type)
	if !nodeType.Valid() {
		return domain.CanvasNode{}, fmt.Errorf("canvas node %s has invalid type %d", r.ID.String(), r.Type)
	}
	legacyReferenceType, _ := domain.InferMaterialReferenceType(domain.CanvasNode{
		Type: nodeType, AssetID: optionalUUIDString(r.AssetID), ResourceID: optionalUUIDString(r.ResourceID), ResourceAssetID: optionalUUIDString(r.ResourceAssetID),
	})
	document, payload, err := decodeCanvasNodeDataWithReference(nodeType, legacyReferenceType, r.NodeData)
	if err != nil {
		return domain.CanvasNode{}, fmt.Errorf("decode canvas node %s node_data: %w", r.ID.String(), err)
	}
	position := domain.Position{PositionX: document.Position.X, PositionY: document.Position.Y}
	if !position.Valid() {
		return domain.CanvasNode{}, fmt.Errorf("canvas node %s has invalid position", r.ID.String())
	}
	item := domain.CanvasNode{ID: r.ID.String(), TenantID: r.TenantID, WorkspaceID: r.WorkspaceID,
		ProjectID: r.ProjectID.String(), CanvasID: r.CanvasID.String(), Type: nodeType, Name: canvasNodeDataName(document, nodeType), HasPersistedName: document.Name != nil,
		Position: position, IncomingEdges: document.IncomingEdges,
		StoryboardRank: r.StoryboardRank, AssetID: optionalUUIDString(r.AssetID),
		ResourceID: optionalUUIDString(r.ResourceID), ResourceAssetID: optionalUUIDString(r.ResourceAssetID),
		Revision: r.Revision, ActiveTaskRunID: optionalUUIDString(r.ActiveTaskRunID), SelectedOutputID: optionalUUIDString(r.SelectedOutputID),
		SelectedAssetID: optionalUUIDString(r.SelectedAssetID), CreatedBy: r.CreatedBy, UpdatedBy: r.UpdatedBy,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
	if r.DeletedAt != 0 {
		deletedAt := time.UnixMilli(int64(r.DeletedAt)).UTC()
		item.DeletedAt = &deletedAt
	}
	if err = applyCanvasNodePayload(&item, payload); err != nil {
		return domain.CanvasNode{}, fmt.Errorf("apply canvas node %s payload: %w", r.ID.String(), err)
	}
	if nodeType == domain.NodeTypeImageAsset || nodeType == domain.NodeTypeVideoAsset || nodeType == domain.NodeTypeAudioAsset {
		inferred, ok := domain.InferMaterialReferenceType(item)
		if !ok || (item.ReferenceType != domain.ReferenceTypeUnspecified && item.ReferenceType != inferred) {
			return domain.CanvasNode{}, fmt.Errorf("canvas node %s has inconsistent material reference", r.ID.String())
		}
		if item.ReferenceType == domain.ReferenceTypeUnspecified {
			item.ReferenceType = inferred
		}
	}
	return item, nil
}

func (r *Repository) decodeRow(ctx context.Context, row canvasnodeRow) (domain.CanvasNode, error) {
	item, err := fromRow(row)
	if err != nil {
		return domain.CanvasNode{}, err
	}
	writeVersion, ok := canvasNodePayloadWriteVersion(item)
	persistedVersion, hasPersistedVersion, versionErr := canvasNodeDataPersistedPayloadVersion(row.NodeData)
	if versionErr != nil {
		return domain.CanvasNode{}, versionErr
	}
	if !ok || (hasPersistedVersion && persistedVersion == writeVersion) {
		return item, nil
	}
	encoded, err := encodeCanvasNodeData(item)
	if err != nil {
		return domain.CanvasNode{}, err
	}
	// The compare-and-set keeps concurrent readers' repair idempotent without changing the user-visible node revision.
	if err = r.dbFor(ctx).Model(&canvasnodeRow{}).Where("id = ? AND node_data = ?", row.ID, row.NodeData).Update("node_data", encoded).Error; err != nil {
		return domain.CanvasNode{}, err
	}
	return item, nil
}

func optionalUUIDString(value *persistenceid.UUID) string {
	if value == nil {
		return ""
	}
	return value.String()
}

type selectedOutputMetadataRow struct {
	TaskRunID             persistenceid.UUID `gorm:"primaryKey"`
	TenantID              string
	WorkspaceID           *string
	ProjectID             persistenceid.UUID
	CanvasID              persistenceid.UUID
	NodeID                persistenceid.UUID
	FirstFrameAssetID     *persistenceid.UUID
	LastFrameAssetID      *persistenceid.UUID
	OutputDurationSeconds *int32
}

func (selectedOutputMetadataRow) TableName() string { return "canvas_node_generations" }

func loadSelectedOutputMetadata(db *gorm.DB, scope app.Scope, items []domain.CanvasNode) error {
	selectedIDs := make([]persistenceid.UUID, 0, len(items))
	indexByOutputID := make(map[string]int, len(items))
	for index := range items {
		if items[index].SelectedOutputID == "" {
			continue
		}
		id, err := persistenceid.Parse(items[index].SelectedOutputID)
		if err != nil {
			return err
		}
		selectedIDs = append(selectedIDs, id)
		indexByOutputID[items[index].SelectedOutputID] = index
	}
	if len(selectedIDs) == 0 {
		return nil
	}

	var rows []selectedOutputMetadataRow
	if err := scopeQuery(db.Model(&selectedOutputMetadataRow{}), scope).
		Select("task_run_id", "node_id", "first_frame_asset_id", "last_frame_asset_id", "output_duration_seconds").
		Where("task_run_id IN ?", selectedIDs).
		Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		index, exists := indexByOutputID[row.TaskRunID.String()]
		if !exists || items[index].ID != row.NodeID.String() {
			continue
		}
		if row.FirstFrameAssetID != nil {
			items[index].FirstFrameAssetID = row.FirstFrameAssetID.String()
		}
		if row.LastFrameAssetID != nil {
			items[index].LastFrameAssetID = row.LastFrameAssetID.String()
		}
		if row.OutputDurationSeconds != nil {
			duration := *row.OutputDurationSeconds
			items[index].SelectedOutputDurationSeconds = &duration
		}
	}
	return nil
}

func rebalanceRows(tx *gorm.DB, rows []canvasnodeRow) error {
	for index := range rows {
		temporaryKey := math.MinInt64 + int64(index) + 1
		if err := tx.Model(&canvasnodeRow{}).Where("id = ?", rows[index].ID).UpdateColumn("storyboard_rank", temporaryKey).Error; err != nil {
			return err
		}
	}
	for index := range rows {
		stableKey := int64(index+1) * 1024
		if err := tx.Model(&canvasnodeRow{}).Where("id = ?", rows[index].ID).UpdateColumn("storyboard_rank", stableKey).Error; err != nil {
			return err
		}
		rows[index].StoryboardRank = stableKey
	}
	return nil
}
func readErr(e error) error {
	if errors.Is(e, gorm.ErrRecordNotFound) {
		return app.ErrNotFound
	}
	return e
}
