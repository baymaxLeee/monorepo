package canvasnode

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"

	app "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationresource "github.com/example/monorepo/canvas/internal/application/resource"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
	domainresource "github.com/example/monorepo/canvas/internal/domain/resource"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxCanvasNodes = 100

type Repository struct{ store *persistencetransaction.Store }

func NewRepository(store *persistencetransaction.Store) *Repository { return &Repository{store: store} }
func (r *Repository) BindCanvasNodeAsset(
	ctx context.Context,
	input applicationresource.CanvasNodeAssetBindingInput,
) (binding applicationresource.CanvasNodeAssetBinding, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		binding, err = r.bindCanvasNodeAssetInTransaction(ctx, input)
		return err
	})
	return
}

func (r *Repository) bindCanvasNodeAssetInTransaction(
	ctx context.Context,
	input applicationresource.CanvasNodeAssetBindingInput,
) (applicationresource.CanvasNodeAssetBinding, error) {
	projectID, err := parseID(input.ProjectID)
	if err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	canvasID, err := parseID(input.CanvasID)
	if err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	nodeID, err := parseID(input.CanvasNodeID)
	if err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	_, err = parseID(input.AssetID)
	if err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	resourceAssetID, err := parseID(input.ResourceAssetID)
	if err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	scope := app.Scope{TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CallerID: input.CallerID}
	db := r.store.Queries(ctx)
	if err = lockCanvas(ctx, db, input.TenantID, input.WorkspaceID, input.ProjectID, canvasID); err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, applicationresource.ErrCanvasNodeAssetNotBindable
	}
	row, err := db.NodeGetLocked(ctx, sqlc.NodeGetLockedParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   projectID,
		CanvasID:    canvasID,
		ID:          nodeID,
	})
	if err != nil {
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
	affected, err := db.NodeBindResource(ctx, sqlc.NodeBindResourceParams{
		ResourceAssetID: &resourceAssetID,
		NodeData:        nodeData,
		UpdatedBy:       scope.CallerID,
		UpdatedAt:       input.UpdatedAt.UTC(),
		TenantID:        scope.TenantID,
		WorkspaceID:     scope.WorkspaceID,
		ProjectID:       projectID,
		CanvasID:        canvasID,
		ID:              nodeID,
		Revision:        item.Revision,
	})
	if err != nil {
		return applicationresource.CanvasNodeAssetBinding{}, err
	}
	if affected != 1 {
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
	p, e := parseID(projectID)
	if e != nil {
		return nil, app.ErrNotFound
	}
	ep, e := parseID(canvasID)
	if e != nil {
		return nil, app.ErrNotFound
	}
	if e = findCanvas(ctx, r.store.Queries(ctx), scope, p, ep, false); e != nil {
		return nil, readErr(e)
	}
	args := sqlc.NodeListParams{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ProjectID: p, CanvasID: ep}
	var rows []canvasnodeRow
	if forUpdate {
		rows, e = r.store.Queries(ctx).NodeListLocked(ctx, sqlc.NodeListLockedParams(args))
	} else {
		rows, e = r.store.Queries(ctx).NodeList(ctx, args)
	}
	if e != nil {
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
	if e = loadSelectedOutputMetadata(ctx, r.store.Queries(ctx), scope, out); e != nil {
		return nil, e
	}
	return out, nil
}

func (r *Repository) ListIDs(ctx context.Context, scope app.Scope, projectID, canvasID string) ([]string, error) {
	p, err := parseID(projectID)
	if err != nil {
		return nil, app.ErrNotFound
	}
	ep, err := parseID(canvasID)
	if err != nil {
		return nil, app.ErrNotFound
	}
	if err = findCanvas(ctx, r.store.Queries(ctx), scope, p, ep, false); err != nil {
		return nil, readErr(err)
	}
	return r.store.Queries(ctx).NodeVideoIDs(ctx, sqlc.NodeVideoIDsParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   p,
		CanvasID:    ep,
		Type:        int16(domain.NodeTypeVideoGeneration),
	})
}

func (r *Repository) BatchGet(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID string,
	canvasnodeIDs []string,
) ([]domain.CanvasNode, error) {
	p, err := parseID(projectID)
	if err != nil {
		return nil, app.ErrNotFound
	}
	ep, err := parseID(canvasID)
	if err != nil {
		return nil, app.ErrNotFound
	}
	if err = findCanvas(ctx, r.store.Queries(ctx), scope, p, ep, false); err != nil {
		return nil, readErr(err)
	}
	if len(canvasnodeIDs) == 0 {
		return []domain.CanvasNode{}, nil
	}
	rows, err := r.store.Queries(ctx).NodeBatch(ctx, sqlc.NodeBatchParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   p,
		CanvasID:    ep,
		Ids:         validIDs(canvasnodeIDs),
	})
	if err != nil {
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
	if err = loadSelectedOutputMetadata(ctx, r.store.Queries(ctx), scope, items); err != nil {
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
	projectUUID, err := parseID(projectID)
	if err != nil {
		return nil, err
	}
	canvasUUIDs := make([]string, 0, len(canvasIDs))
	for _, canvasID := range canvasIDs {
		canvasUUID, parseErr := parseID(canvasID)
		if parseErr != nil {
			return nil, parseErr
		}
		canvasUUIDs = append(canvasUUIDs, canvasUUID)
	}
	if len(canvasUUIDs) == 0 {
		return map[string]app.FallbackFrameAsset{}, nil
	}
	rows, err := r.store.Queries(ctx).NodeFirstFrames(ctx, sqlc.NodeFirstFramesParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   projectUUID,
		CanvasIds:   canvasUUIDs,
		Type:        int16(domain.NodeTypeVideoGeneration),
	})
	if err != nil {
		return nil, err
	}
	result := make(map[string]app.FallbackFrameAsset, len(rows))
	for _, row := range rows {
		if row.FirstFrameAssetID != nil {
			result[row.CanvasID] = app.FallbackFrameAsset{AssetID: *row.FirstFrameAssetID, TaskRunID: row.TaskRunID}
		}
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
	p, e := parseID(projectID)
	if e != nil {
		return domain.CanvasNode{}, app.ErrNotFound
	}
	ep, e := parseID(canvasID)
	if e != nil {
		return domain.CanvasNode{}, app.ErrNotFound
	}
	id, e := parseID(canvasnodeID)
	if e != nil {
		return domain.CanvasNode{}, app.ErrNotFound
	}
	if e = findCanvas(ctx, r.store.Queries(ctx), scope, p, ep, forUpdate); e != nil {
		return domain.CanvasNode{}, readErr(e)
	}
	row, e := r.getRow(ctx, scope, p, ep, id, forUpdate)
	if e != nil {
		return domain.CanvasNode{}, readErr(e)
	}
	item, e := r.decodeRow(ctx, row)
	if e != nil {
		return domain.CanvasNode{}, e
	}
	items := []domain.CanvasNode{item}
	if e = loadSelectedOutputMetadata(ctx, r.store.Queries(ctx), scope, items); e != nil {
		return domain.CanvasNode{}, e
	}
	return items[0], nil
}

func (r *Repository) Number(ctx context.Context, scope app.Scope, projectID, canvasID, canvasnodeID string) (int32, error) {
	p, err := parseID(projectID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	ep, err := parseID(canvasID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	id, err := parseID(canvasnodeID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	current, err := r.getRow(ctx, scope, p, ep, id, false)
	if err != nil {
		return 0, readErr(err)
	}
	preceding, err := r.store.Queries(ctx).NodeCountPreceding(ctx, sqlc.NodeCountPrecedingParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   p,
		CanvasID:    ep,
		Rank:        current.StoryboardRank,
	})
	if err != nil {
		return 0, err
	}
	return int32(preceding + 1), nil
}

func (r *Repository) GetByID(ctx context.Context, scope app.Scope, canvasnodeID string) (domain.CanvasNode, error) {
	id, err := parseID(canvasnodeID)
	if err != nil {
		return domain.CanvasNode{}, app.ErrNotFound
	}
	row, err := r.store.Queries(ctx).NodeGetByID(ctx, sqlc.NodeGetByIDParams{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ID: id,
	})
	if err != nil {
		return domain.CanvasNode{}, readErr(err)
	}
	return r.decodeRow(ctx, row)
}

func (r *Repository) Create(ctx context.Context, item domain.CanvasNode, after *string) (number int32, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		number, err = r.createInTransaction(ctx, item, after)
		return err
	})
	return
}

func (r *Repository) createInTransaction(ctx context.Context, item domain.CanvasNode, after *string) (int32, error) {
	db := r.store.Queries(ctx)
	canvasID, err := parseID(item.CanvasID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	if err = lockCanvas(ctx, db, item.TenantID, item.WorkspaceID, item.ProjectID, canvasID); err != nil {
		return 0, readErr(err)
	}
	projectID, err := parseID(item.ProjectID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	nodeCount, err := db.NodeCount(ctx, sqlc.NodeCountParams{
		TenantID:    item.TenantID,
		WorkspaceID: item.WorkspaceID,
		ProjectID:   projectID,
		CanvasID:    canvasID,
	})
	if err != nil {
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
		if createErr := insertNode(ctx, db, row); createErr != nil {
			return 0, createErr
		}
		return 0, nil
	}
	rows, err := db.NodeVideoNodesLocked(ctx, sqlc.NodeVideoNodesLockedParams{
		TenantID:    item.TenantID,
		WorkspaceID: item.WorkspaceID,
		ProjectID:   projectID,
		CanvasID:    canvasID,
		Type:        int16(domain.NodeTypeVideoGeneration),
	})
	if err != nil {
		return 0, err
	}
	key := int64(1024)
	canvasnodeNo := int32(len(rows) + 1)
	if len(rows) > 0 {
		key = rows[len(rows)-1].StoryboardRank + 1024
	}
	if after != nil {
		anchor, parseErr := parseID(*after)
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
				if err = rebalanceRows(ctx, db, rows); err != nil {
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
	if err = insertNode(ctx, db, row); err != nil {
		return 0, err
	}
	return canvasnodeNo, nil
}

func (r *Repository) Update(ctx context.Context, item domain.CanvasNode, patch domain.UpdatePatch) (number int32, revision int64, revokedRunID string, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		number, revision, revokedRunID, err = r.updateInTransaction(ctx, item, patch)
		return err
	})
	return
}

func (r *Repository) updateInTransaction(ctx context.Context, item domain.CanvasNode, patch domain.UpdatePatch) (int32, int64, string, error) {
	row, err := toRow(item)
	if err != nil {
		return 0, 0, "", err
	}
	db := r.store.Queries(ctx)
	if err = lockCanvas(ctx, db, item.TenantID, item.WorkspaceID, item.ProjectID, row.CanvasID); err != nil {
		return 0, 0, "", readErr(err)
	}
	scope := app.Scope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID}
	current, err := r.getRow(ctx, scope, row.ProjectID, row.CanvasID, row.ID, true)
	if err != nil {
		return 0, 0, "", readErr(err)
	}
	if current.Revision != patch.ExpectedRevision {
		return 0, 0, "", app.ErrRevisionConflict
	}
	row.NodeData, err = encodeCanvasNodeDataForUpdate(item, current.NodeData)
	if err != nil {
		return 0, 0, "", err
	}
	revokedTaskRunID := optionalUUIDString(current.ActiveTaskRunID)
	revision := current.Revision + 1
	definitionChanged := patch.Prompt != nil || patch.Text != nil || patch.IncomingEdges != nil ||
		patch.VideoInputMode != nil || !patch.GenerationConfig.Empty()
	if !definitionChanged {
		revokedTaskRunID = ""
	}
	_, err = db.NodePatch(ctx, sqlc.NodePatchParams{
		NodeData:    row.NodeData,
		UpdatedBy:   item.UpdatedBy,
		UpdatedAt:   item.UpdatedAt,
		Revoke:      definitionChanged,
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   row.ProjectID,
		CanvasID:    row.CanvasID,
		ID:          row.ID,
		Revision:    current.Revision,
	})
	if err != nil {
		return 0, 0, "", err
	}
	preceding, err := db.NodeCountPreceding(ctx, sqlc.NodeCountPrecedingParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   row.ProjectID,
		CanvasID:    row.CanvasID,
		Rank:        current.StoryboardRank,
	})
	if err != nil {
		return 0, 0, "", err
	}
	canvasnodeNo := int32(preceding + 1)
	return canvasnodeNo, revision, revokedTaskRunID, nil
}

// ClaimTaskRun 用条件更新抢占单分镜的生成槽位。生成不改变内容，所以这里不递增
// revision；并发请求只有一个能把 NULL 改成自己的 TaskRunID，避免重复创建计费任务。
func (r *Repository) ClaimTaskRun(ctx context.Context, item domain.CanvasNode) (matched bool, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		matched, err = r.claimTaskRunInTransaction(ctx, item)
		return err
	})
	return
}

func (r *Repository) claimTaskRunInTransaction(ctx context.Context, item domain.CanvasNode) (bool, error) {
	row, err := toRow(item)
	if err != nil {
		return false, err
	}
	db := r.store.Queries(ctx)
	if err = lockCanvas(ctx, db, item.TenantID, item.WorkspaceID, item.ProjectID, row.CanvasID); err != nil {
		return false, readErr(err)
	}
	affected, err := r.store.Queries(ctx).NodeClaim(ctx, sqlc.NodeClaimParams{
		RunID:       row.ActiveTaskRunID,
		TenantID:    item.TenantID,
		WorkspaceID: item.WorkspaceID,
		ProjectID:   row.ProjectID,
		CanvasID:    row.CanvasID,
		ID:          row.ID,
		Revision:    row.Revision,
	})
	return affected == 1, err
}

// ReleaseTaskRun 也使用条件更新，只释放仍指向 expectedRunID 的槽位，不能误清掉
// 另一个请求刚发起的新运行。
func (r *Repository) ReleaseTaskRun(ctx context.Context, item domain.CanvasNode, expectedRunID string) (matched bool, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		matched, err = r.releaseTaskRunInTransaction(ctx, item, expectedRunID)
		return err
	})
	return
}

func (r *Repository) releaseTaskRunInTransaction(ctx context.Context, item domain.CanvasNode, expectedRunID string) (bool, error) {
	row, err := toRow(item)
	if err != nil {
		return false, err
	}
	expected, err := parseID(expectedRunID)
	if err != nil {
		return false, err
	}
	affected, err := r.store.Queries(ctx).NodeRelease(ctx, sqlc.NodeReleaseParams{
		TenantID:    item.TenantID,
		WorkspaceID: item.WorkspaceID,
		ProjectID:   row.ProjectID,
		CanvasID:    row.CanvasID,
		ID:          row.ID,
		RunID:       &expected,
	})
	return affected == 1, err
}

// BindGeneratedAsset atomically releases a generation slot and selects its
// successful image/video Asset on the generation node. Generated Assets are
// project-owned storage facts and are never materialized as ResourceAssets.
func (r *Repository) BindGeneratedAsset(ctx context.Context, scope app.Scope, projectID, canvasID, nodeID, taskRunID, assetID string, nodeType domain.NodeType, updatedAt time.Time) (matched bool, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		matched, err = r.bindGeneratedAssetInTransaction(ctx, scope, projectID, canvasID, nodeID, taskRunID, assetID, nodeType, updatedAt)
		return err
	})
	return
}

func (r *Repository) bindGeneratedAssetInTransaction(ctx context.Context, scope app.Scope, projectID, canvasID, nodeID, taskRunID, assetID string, nodeType domain.NodeType, updatedAt time.Time) (bool, error) {
	project, err := parseID(projectID)
	if err != nil {
		return false, app.ErrNotFound
	}
	canvas, err := parseID(canvasID)
	if err != nil {
		return false, app.ErrNotFound
	}
	node, err := parseID(nodeID)
	if err != nil {
		return false, app.ErrNotFound
	}
	run, err := parseID(taskRunID)
	if err != nil {
		return false, app.ErrNotFound
	}
	asset, err := parseID(assetID)
	if err != nil {
		return false, app.ErrNotFound
	}
	db := r.store.Queries(ctx)
	if err = lockCanvas(ctx, db, scope.TenantID, scope.WorkspaceID, projectID, canvas); err != nil {
		return false, readErr(err)
	}
	affected, err := r.store.Queries(ctx).NodeSelectAsset(ctx, sqlc.NodeSelectAssetParams{
		RunID:       &run,
		AssetID:     &asset,
		UpdatedBy:   scope.CallerID,
		UpdatedAt:   updatedAt.UTC(),
		Bind:        true,
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   project,
		CanvasID:    canvas,
		ID:          node,
		Type:        int16(nodeType),
	})
	return affected == 1, err
}

func (r *Repository) BindGeneratedText(ctx context.Context, scope app.Scope, projectID, canvasID, nodeID, taskRunID, content string, updatedAt time.Time) (bool, error) {
	project, err := parseID(projectID)
	if err != nil {
		return false, app.ErrNotFound
	}
	canvas, err := parseID(canvasID)
	if err != nil {
		return false, app.ErrNotFound
	}
	node, err := parseID(nodeID)
	if err != nil {
		return false, app.ErrNotFound
	}
	run, err := parseID(taskRunID)
	if err != nil {
		return false, app.ErrNotFound
	}
	return r.updateSelectedOutputText(ctx, scope, project, canvas, node, &run, run, content, updatedAt)
}

func (r *Repository) SelectGeneratedText(ctx context.Context, scope app.Scope, projectID, canvasID, nodeID, taskRunID, content string, updatedAt time.Time) (bool, error) {
	project, err := parseID(projectID)
	if err != nil {
		return false, app.ErrNotFound
	}
	canvas, err := parseID(canvasID)
	if err != nil {
		return false, app.ErrNotFound
	}
	node, err := parseID(nodeID)
	if err != nil {
		return false, app.ErrNotFound
	}
	run, err := parseID(taskRunID)
	if err != nil {
		return false, app.ErrNotFound
	}
	return r.updateSelectedOutputText(ctx, scope, project, canvas, node, nil, run, content, updatedAt)
}

func (r *Repository) SelectGeneratedAsset(ctx context.Context, scope app.Scope, projectID, canvasID, nodeID, taskRunID, assetID string, nodeType domain.NodeType, updatedAt time.Time) (matched bool, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		matched, err = r.selectGeneratedAssetInTransaction(ctx, scope, projectID, canvasID, nodeID, taskRunID, assetID, nodeType, updatedAt)
		return err
	})
	return
}

func (r *Repository) selectGeneratedAssetInTransaction(ctx context.Context, scope app.Scope, projectID, canvasID, nodeID, taskRunID, assetID string, nodeType domain.NodeType, updatedAt time.Time) (bool, error) {
	project, err := parseID(projectID)
	if err != nil {
		return false, app.ErrNotFound
	}
	canvas, err := parseID(canvasID)
	if err != nil {
		return false, app.ErrNotFound
	}
	node, err := parseID(nodeID)
	if err != nil {
		return false, app.ErrNotFound
	}
	run, err := parseID(taskRunID)
	if err != nil {
		return false, app.ErrNotFound
	}
	asset, err := parseID(assetID)
	if err != nil {
		return false, app.ErrNotFound
	}
	db := r.store.Queries(ctx)
	if err = lockCanvas(ctx, db, scope.TenantID, scope.WorkspaceID, projectID, canvas); err != nil {
		return false, readErr(err)
	}
	affected, err := r.store.Queries(ctx).NodeSelectAsset(ctx, sqlc.NodeSelectAssetParams{
		RunID:       &run,
		AssetID:     &asset,
		UpdatedBy:   scope.CallerID,
		UpdatedAt:   updatedAt.UTC(),
		Bind:        false,
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   project,
		CanvasID:    canvas,
		ID:          node,
		Type:        int16(nodeType),
	})
	return affected == 1, err
}

func (r *Repository) updateSelectedOutputText(
	ctx context.Context,
	scope app.Scope,
	project, canvas, node string,
	expectedActiveRun *string,
	selectedOutputID string,
	content string,
	updatedAt time.Time,
) (bool, error) {
	matched := false
	err := r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		tx := r.store.Queries(ctx)
		if lockErr := lockCanvas(ctx, tx, scope.TenantID, scope.WorkspaceID, project, canvas); lockErr != nil {
			return readErr(lockErr)
		}
		current, err := r.getRow(ctx, scope, project, canvas, node, true)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		if current.Type != int16(domain.NodeTypeTextGeneration) || (expectedActiveRun != nil && (current.ActiveTaskRunID == nil || *current.ActiveTaskRunID != *expectedActiveRun)) {
			return nil
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
		affected, err := tx.NodeSelectText(ctx, sqlc.NodeSelectTextParams{
			RunID:       &selectedOutputID,
			NodeData:    encoded,
			UpdatedBy:   scope.CallerID,
			UpdatedAt:   updatedAt.UTC(),
			Bind:        expectedActiveRun != nil,
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			ProjectID:   project,
			CanvasID:    canvas,
			ID:          node,
		})
		if err != nil {
			return err
		}
		matched = affected == 1
		return nil
	})
	return matched, err
}

func (r *Repository) Delete(ctx context.Context, item domain.CanvasNode) (revokedRunID string, releasedAssets []string, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		revokedRunID, releasedAssets, err = r.deleteInTransaction(ctx, item)
		return err
	})
	return
}

func (r *Repository) deleteInTransaction(ctx context.Context, item domain.CanvasNode) (string, []string, error) {
	row, err := toRow(item)
	if err != nil {
		return "", nil, err
	}
	db := r.store.Queries(ctx)
	if err = lockCanvas(ctx, db, item.TenantID, item.WorkspaceID, item.ProjectID, row.CanvasID); err != nil {
		return "", nil, readErr(err)
	}
	scope := app.Scope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID}
	current, err := r.getRow(ctx, scope, row.ProjectID, row.CanvasID, row.ID, true)
	if err != nil {
		return "", nil, readErr(err)
	}
	revokedTaskRunID := optionalUUIDString(current.ActiveTaskRunID)
	releasedAssetIDs := make([]string, 0, 2)
	if current.SelectedAssetID != nil && (current.Type == int16(domain.NodeTypeImageGeneration) ||
		(current.Type == int16(domain.NodeTypeVideoGeneration) && current.SelectedOutputID == nil)) {
		releasedAssetIDs = append(releasedAssetIDs, *current.SelectedAssetID)
	}
	if current.AssetID != nil {
		releasedAssetIDs = append(releasedAssetIDs, *current.AssetID)
	}
	_, err = db.NodeDelete(ctx, sqlc.NodeDeleteParams{
		UpdatedBy:   item.UpdatedBy,
		UpdatedAt:   item.UpdatedAt,
		DeletedAt:   row.DeletedAt,
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   row.ProjectID,
		CanvasID:    row.CanvasID,
		Ids:         []string{row.ID},
	})
	if err != nil {
		return "", nil, err
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
	project, err := parseID(projectID)
	if err != nil {
		return false, nil
	}
	canvas, err := parseID(canvasID)
	if err != nil {
		return false, nil
	}
	node, err := parseID(nodeID)
	if err != nil {
		return false, nil
	}
	count, err := r.store.Queries(ctx).NodeDeletionMatches(ctx, sqlc.NodeDeletionMatchesParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		DeletedAt:   ptr(deletedAt.UnixMilli()),
		ProjectID:   project,
		CanvasID:    canvas,
		ID:          node,
		Revision:    revision,
	})
	if err != nil {
		return false, err
	}
	return count == 1, nil
}

func (r *Repository) DeleteByCanvas(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID string,
	now time.Time,
) (deleted []domain.CanvasNode, releasedAssets []string, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		deleted, releasedAssets, err = r.deleteByCanvasInTransaction(ctx, scope, projectID, canvasID, now)
		return err
	})
	return
}

func (r *Repository) deleteByCanvasInTransaction(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID string,
	now time.Time,
) ([]domain.CanvasNode, []string, error) {
	project, err := parseID(projectID)
	if err != nil {
		return nil, nil, app.ErrNotFound
	}
	canvas, err := parseID(canvasID)
	if err != nil {
		return nil, nil, app.ErrNotFound
	}
	rows, err := r.store.Queries(ctx).NodeListLocked(ctx, sqlc.NodeListLockedParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   project,
		CanvasID:    canvas,
	})
	if err != nil {
		return nil, nil, err
	}
	if len(rows) == 0 {
		return nil, nil, nil
	}
	ids := make([]string, 0, len(rows))
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
			releasedAssetIDs = append(releasedAssetIDs, *rows[index].AssetID)
		}
		if rows[index].SelectedAssetID != nil && (rows[index].Type == int16(domain.NodeTypeImageGeneration) ||
			(rows[index].Type == int16(domain.NodeTypeVideoGeneration) && rows[index].SelectedOutputID == nil)) {
			releasedAssetIDs = append(releasedAssetIDs, *rows[index].SelectedAssetID)
		}
	}
	affected, err := r.store.Queries(ctx).NodeDelete(ctx, sqlc.NodeDeleteParams{
		UpdatedBy:   scope.CallerID,
		UpdatedAt:   deletedAt,
		DeletedAt:   ptr(deletedAt.UnixMilli()),
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   project,
		CanvasID:    canvas,
		Ids:         ids,
	})
	if err != nil {
		return nil, nil, err
	}
	if affected != int64(len(rows)) {
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
	projectUUID, err := parseID(projectID)
	if err != nil {
		return nil, app.ErrNotFound
	}
	if limit < 1 {
		return []app.ProjectAssetCandidate{}, nil
	}
	rows, err := r.store.Queries(ctx).NodeLibraryAssets(ctx, sqlc.NodeLibraryAssetsParams{
		TenantID:     scope.TenantID,
		WorkspaceID:  scope.WorkspaceID,
		ProjectOwner: int16(domainresource.OwnerProject),
		ProjectID:    projectUUID,
		PageSize:     int32(limit),
	})
	if err != nil {
		return nil, err
	}
	out := make([]app.ProjectAssetCandidate, 0, len(rows))
	for _, row := range rows {
		if item, ok := projectAssetCandidateFromRow(scope, projectLibraryAssetRow(row)); ok {
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
	projectUUID, err := parseID(projectID)
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
		if _, parseErr := parseID(cursor.ID); parseErr != nil {
			return empty, app.ErrNotFound
		}
		position := *cursor
		scanCursor = &position
	}
	for len(candidates) < fetchLimit {
		types := make([]int16, 0, len(resourceTypes))
		for _, t := range resourceTypes {
			types = append(types, int16(t))
		}
		var cursorTime pgtype.Timestamptz
		var cursorID string
		if scanCursor != nil {
			cursorTime = pgtype.Timestamptz{Time: scanCursor.CreatedAt, Valid: true}
			cursorID, err = parseID(scanCursor.ID)
			if err != nil {
				return empty, app.ErrNotFound
			}
		}
		resourceRows, err := r.store.Queries(ctx).NodeLibrarySearch(ctx, sqlc.NodeLibrarySearchParams{
			TenantID:      scope.TenantID,
			WorkspaceID:   scope.WorkspaceID,
			ProjectOwner:  int16(domainresource.OwnerProject),
			ProjectID:     projectUUID,
			OfficialOwner: int16(domainresource.OwnerOfficial),
			Pattern:       "%" + keyword + "%",
			Types:         types,
			CursorTime:    cursorTime,
			CursorID:      cursorID,
			PageSize:      int32(fetchLimit),
		})
		if err != nil {
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
			children := make([]app.CanvasNodeAvailableAssetItem, 0, len(looks[row.ResourceID]))
			for _, look := range looks[row.ResourceID] {
				if look.CurrentAssetID == nil {
					children = append(children, app.CanvasNodeAvailableAssetItem{
						Asset:           domainasset.Asset{MediaType: domainasset.MediaType(look.SlotMediaType)},
						ResourceAssetID: look.ResourceAssetID, Name: look.Name,
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
			resourceID := row.ResourceID
			candidates = append(candidates, candidate{
				item:   app.CanvasNodeAvailableAsset{Source: app.CanvasNodeAssetSourceProjectResource, Name: row.Name, Description: row.Description, ResourceID: resourceID, ResourceType: domainresource.Type(row.Type), Assets: children},
				cursor: app.CanvasNodeAssetSearchCursor{CreatedAt: row.CreatedAt, ID: resourceID},
			})
		}
		last := resourceRows[len(resourceRows)-1]
		scanCursor = &app.CanvasNodeAssetSearchCursor{CreatedAt: last.CreatedAt, ID: last.ResourceID}
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

type projectLibraryResourceRow = sqlc.NodeLibrarySearchRow

func (r *Repository) ResolveCurrentResourceAsset(
	ctx context.Context,
	scope app.Scope,
	projectID string,
	resourceAssetID string,
) (app.CanvasResourceAssetReference, error) {
	projectUUID, err := parseID(projectID)
	if err != nil {
		return app.CanvasResourceAssetReference{}, err
	}
	resourceAssetUUID, err := parseID(resourceAssetID)
	if err != nil {
		return app.CanvasResourceAssetReference{}, err
	}
	rows, err := r.store.Queries(ctx).NodeLibraryResolve(ctx, sqlc.NodeLibraryResolveParams{
		TenantID:      scope.TenantID,
		WorkspaceID:   scope.WorkspaceID,
		ProjectOwner:  int16(domainresource.OwnerProject),
		ProjectID:     projectUUID,
		OfficialOwner: int16(domainresource.OwnerOfficial),
		PrimaryOnly:   false,
		Ids:           []string{resourceAssetUUID},
	})
	if err != nil {
		return app.CanvasResourceAssetReference{}, err
	}
	if len(rows) != 1 {
		return app.CanvasResourceAssetReference{}, app.ErrNotFound
	}
	candidate, ok := projectAssetCandidateFromRow(scope, projectLibraryAssetRow(rows[0]))
	if !ok {
		return app.CanvasResourceAssetReference{}, app.ErrNotFound
	}
	return app.CanvasResourceAssetReference{
		ResourceID:      rows[0].ResourceID,
		ResourceAssetID: resourceAssetID,
		Revision:        rows[0].ResourceAssetRevision,
		Name:            candidate.Name,
		IsPrimary:       rows[0].PrimaryResourceAssetID != nil && *rows[0].PrimaryResourceAssetID == resourceAssetID,
		Asset:           candidate.Asset,
	}, nil
}

func (r *Repository) BatchResolveCurrentResourceAssets(
	ctx context.Context,
	scope app.Scope,
	projectID string,
	resourceAssetIDs []string,
) (map[string]app.CanvasResourceAssetReference, error) {
	projectUUID, err := parseID(projectID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(resourceAssetIDs))
	seen := make(map[string]struct{}, len(resourceAssetIDs))
	for _, id := range resourceAssetIDs {
		parsed, parseErr := parseID(id)
		if parseErr != nil {
			return nil, parseErr
		}
		canonicalID := parsed
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
	rows, err := r.store.Queries(ctx).NodeLibraryResolve(ctx, sqlc.NodeLibraryResolveParams{
		TenantID:      scope.TenantID,
		WorkspaceID:   scope.WorkspaceID,
		ProjectOwner:  int16(domainresource.OwnerProject),
		ProjectID:     projectUUID,
		OfficialOwner: int16(domainresource.OwnerOfficial),
		PrimaryOnly:   false,
		Ids:           ids,
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		candidate, ok := projectAssetCandidateFromRow(scope, projectLibraryAssetRow(row))
		if !ok {
			continue
		}
		id := row.ResourceAssetID
		result[id] = app.CanvasResourceAssetReference{
			ResourceID:      row.ResourceID,
			ResourceAssetID: id,
			Revision:        row.ResourceAssetRevision,
			Name:            candidate.Name,
			IsPrimary:       row.PrimaryResourceAssetID != nil && *row.PrimaryResourceAssetID == id,
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
	projectUUID, err := parseID(projectID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(resourceIDs))
	seen := make(map[string]struct{}, len(resourceIDs))
	for _, id := range resourceIDs {
		parsed, parseErr := parseID(id)
		if parseErr != nil {
			return nil, parseErr
		}
		canonicalID := parsed
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
	rows, err := r.store.Queries(ctx).NodeLibraryResolve(ctx, sqlc.NodeLibraryResolveParams{
		TenantID:      scope.TenantID,
		WorkspaceID:   scope.WorkspaceID,
		ProjectOwner:  int16(domainresource.OwnerProject),
		ProjectID:     projectUUID,
		OfficialOwner: int16(domainresource.OwnerOfficial),
		PrimaryOnly:   true,
		Ids:           ids,
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		candidate, ok := projectAssetCandidateFromRow(scope, projectLibraryAssetRow(row))
		if !ok {
			continue
		}
		resourceID := row.ResourceID
		result[resourceID] = app.CanvasResourceAssetReference{
			ResourceID: resourceID, ResourceAssetID: row.ResourceAssetID, Revision: row.ResourceAssetRevision,
			Name: candidate.Name, IsPrimary: true, Asset: candidate.Asset,
		}
	}
	return result, nil
}

func resourceIDsOf(rows []projectLibraryResourceRow) []string {
	ids := make([]string, 0, len(rows))
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
	rows, err := r.store.Queries(ctx).NodeLibraryLooks(ctx, sqlc.NodeLibraryLooksParams{
		ProjectOwner:       int16(domainresource.OwnerProject),
		ResourceAssetOwner: int16(domainasset.OwnerResource),
		OfficialOwner:      int16(domainresource.OwnerOfficial),
		OfficialAssetOwner: int16(domainasset.OwnerOfficial),
		TenantID:           scope.TenantID,
		WorkspaceID:        scope.WorkspaceID,
		Ids:                ids,
		MediaTypes:         []int16{int16(domainasset.MediaImage), int16(domainasset.MediaVideo), int16(domainasset.MediaAudio)},
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		resourceID := row.ResourceID
		out[resourceID] = append(out[resourceID], row)
	}
	return out, nil
}

type projectLibraryAssetRow = sqlc.NodeLibraryLooksRow

func projectAssetCandidateFromRow(scope app.Scope, row projectLibraryAssetRow) (app.ProjectAssetCandidate, bool) {
	name := strings.TrimSpace(row.Name)
	assetID := row.AssetID
	if name == "" || assetID == "" || !domainasset.MediaType(row.MediaType).Valid() {
		return app.ProjectAssetCandidate{}, false
	}
	primary := row.PrimaryResourceAssetID != nil && *row.PrimaryResourceAssetID == row.ResourceAssetID
	return app.ProjectAssetCandidate{
		Asset: domainasset.Asset{
			ID: assetID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
			OwnerType: domainasset.OwnerType(row.OwnerType), OwnerID: row.OwnerID,
			FileName: row.FileName, MediaType: domainasset.MediaType(row.MediaType),
			ContentType: row.ContentType, SizeBytes: row.SizeBytes, SourceAssetID: row.SourceAssetID, SourceRevisionID: row.SourceRevisionID,
			CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt.Time,
		},
		Name: name, ResourceAssetID: row.ResourceAssetID, ResourceID: row.ResourceID, ResourceName: row.ResourceName,
		Description: row.Description, Primary: primary,
	}, true
}

func parseID(raw string) (string, error) {
	id, err := persistenceid.Parse(raw)
	if err != nil {
		return "", err
	}
	return id.String(), nil
}

func optionalID(raw string) (*string, error) {
	if raw == "" {
		return nil, nil
	}
	id, err := parseID(raw)
	return &id, err
}

func ptr[T any](v T) *T { return &v }
func validIDs(raw []string) []string {
	ids := make([]string, 0, len(raw))
	for _, v := range raw {
		if id, e := parseID(v); e == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

func lockCanvas(ctx context.Context, db *sqlc.Queries, tenant string, workspace *string, project, canvas string) error {
	p, e := parseID(project)
	if e != nil {
		return app.ErrNotFound
	}
	return findCanvas(ctx, db, app.Scope{TenantID: tenant, WorkspaceID: workspace}, p, canvas, true)
}

func findCanvas(ctx context.Context, db *sqlc.Queries, scope app.Scope, project, canvas string, lock bool) error {
	p := sqlc.NodeFindProjectParams{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ID: project}
	c := sqlc.NodeFindCanvasParams{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ProjectID: project, ID: canvas}
	if lock {
		if _, e := db.NodeFindProjectLocked(ctx, sqlc.NodeFindProjectLockedParams(p)); e != nil {
			return e
		}
		_, e := db.NodeFindCanvasLocked(ctx, sqlc.NodeFindCanvasLockedParams(c))
		return e
	}
	if _, e := db.NodeFindProject(ctx, p); e != nil {
		return e
	}
	_, e := db.NodeFindCanvas(ctx, c)
	return e
}

func (r *Repository) getRow(ctx context.Context, scope app.Scope, project, canvas, node string, lock bool) (canvasnodeRow, error) {
	args := sqlc.NodeGetParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   project,
		CanvasID:    canvas,
		ID:          node,
	}
	if lock {
		return r.store.Queries(ctx).NodeGetLocked(ctx, sqlc.NodeGetLockedParams(args))
	}
	return r.store.Queries(ctx).NodeGet(ctx, args)
}

func insertNode(ctx context.Context, db *sqlc.Queries, row canvasnodeRow) error {
	return db.NodeInsert(ctx, sqlc.NodeInsertParams{
		ID:               row.ID,
		TenantID:         row.TenantID,
		WorkspaceID:      row.WorkspaceID,
		ProjectID:        row.ProjectID,
		CanvasID:         row.CanvasID,
		Type:             row.Type,
		StoryboardRank:   row.StoryboardRank,
		AssetID:          row.AssetID,
		ResourceID:       row.ResourceID,
		ResourceAssetID:  row.ResourceAssetID,
		Revision:         row.Revision,
		ActiveTaskRunID:  row.ActiveTaskRunID,
		SelectedOutputID: row.SelectedOutputID,
		SelectedAssetID:  row.SelectedAssetID,
		CreatedBy:        row.CreatedBy,
		UpdatedBy:        row.UpdatedBy,
		CreatedAt:        row.CreatedAt,
		UpdatedAt:        row.UpdatedAt,
		NodeData:         row.NodeData,
	})
}

func (r *Repository) LockCanvas(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID string,
) (int64, error) {
	project, err := parseID(projectID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	canvas, err := parseID(canvasID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	if err = findCanvas(ctx, r.store.Queries(ctx), scope, project, canvas, true); err != nil {
		return 0, readErr(err)
	}
	revision, err := r.store.Queries(ctx).NodeFindCanvasLocked(ctx, sqlc.NodeFindCanvasLockedParams{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ID: canvas, ProjectID: project,
	})
	return revision, readErr(err)
}

func (r *Repository) AdvanceCanvasRevision(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID string,
	expectedRevision int64,
	now time.Time,
) (revision int64, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		revision, err = r.advanceCanvasRevisionInTransaction(ctx, scope, projectID, canvasID, expectedRevision, now)
		return err
	})
	return
}

func (r *Repository) advanceCanvasRevisionInTransaction(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID string,
	expectedRevision int64,
	now time.Time,
) (int64, error) {
	project, err := parseID(projectID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	canvas, err := parseID(canvasID)
	if err != nil {
		return 0, app.ErrNotFound
	}
	affected, err := r.store.Queries(ctx).NodeAdvanceRevision(ctx, sqlc.NodeAdvanceRevisionParams{
		UpdatedAt:   now.UTC(),
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   project,
		ID:          canvas,
		Revision:    expectedRevision,
	})
	if err != nil {
		return 0, err
	}
	if affected != 1 {
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
) (err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		return r.updateStoryboardRanksInTransaction(ctx, scope, projectID, canvasID, ranks, now)
	})
	return
}

func (r *Repository) updateStoryboardRanksInTransaction(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID string,
	ranks map[string]int64,
	now time.Time,
) error {
	project, err := parseID(projectID)
	if err != nil {
		return app.ErrNotFound
	}
	canvas, err := parseID(canvasID)
	if err != nil {
		return app.ErrNotFound
	}
	for rawID, rank := range ranks {
		id, parseErr := parseID(rawID)
		if parseErr != nil {
			return app.ErrNotFound
		}
		affected, err := r.store.Queries(ctx).NodeUpdateRank(ctx, sqlc.NodeUpdateRankParams{
			Rank:        rank,
			UpdatedBy:   scope.CallerID,
			UpdatedAt:   now.UTC(),
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			ProjectID:   project,
			CanvasID:    canvas,
			ID:          id,
			Type:        int16(domain.NodeTypeVideoGeneration),
		})
		if err != nil {
			return err
		}
		if affected != 1 {
			return app.ErrNotFound
		}
	}
	return nil
}

func toRow(s domain.CanvasNode) (canvasnodeRow, error) {
	id, e := parseID(s.ID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	p, e := parseID(s.ProjectID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	ep, e := parseID(s.CanvasID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	activeRunID, e := optionalID(s.ActiveTaskRunID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	selectedOutputID, e := optionalID(s.SelectedOutputID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	selectedAssetID, e := optionalID(s.SelectedAssetID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	assetID, e := optionalID(s.AssetID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	resourceAssetID, e := optionalID(s.ResourceAssetID)
	if e != nil {
		return canvasnodeRow{}, e
	}
	resourceID, e := optionalID(s.ResourceID)
	if e != nil {
		return canvasnodeRow{}, e
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
		row.DeletedAt = ptr(s.DeletedAt.UnixMilli())
	}
	return row, nil
}

func fromRow(r canvasnodeRow) (domain.CanvasNode, error) {
	nodeType := domain.NodeType(r.Type)
	if !nodeType.Valid() {
		return domain.CanvasNode{}, fmt.Errorf("canvas node %s has invalid type %d", r.ID, r.Type)
	}
	document, payload, err := decodeCanvasNodeData(nodeType, r.NodeData)
	if err != nil {
		return domain.CanvasNode{}, fmt.Errorf("decode canvas node %s node_data: %w", r.ID, err)
	}
	position := domain.Position{PositionX: document.Position.X, PositionY: document.Position.Y}
	if !position.Valid() {
		return domain.CanvasNode{}, fmt.Errorf("canvas node %s has invalid position", r.ID)
	}
	item := domain.CanvasNode{ID: r.ID, TenantID: r.TenantID, WorkspaceID: r.WorkspaceID,
		ProjectID: r.ProjectID, CanvasID: r.CanvasID, Type: nodeType, Name: canvasNodeDataName(document, nodeType), HasPersistedName: document.Name != nil,
		Position: position, IncomingEdges: document.IncomingEdges,
		StoryboardRank: r.StoryboardRank, AssetID: optionalUUIDString(r.AssetID),
		ResourceID: optionalUUIDString(r.ResourceID), ResourceAssetID: optionalUUIDString(r.ResourceAssetID),
		Revision: r.Revision, ActiveTaskRunID: optionalUUIDString(r.ActiveTaskRunID), SelectedOutputID: optionalUUIDString(r.SelectedOutputID),
		SelectedAssetID: optionalUUIDString(r.SelectedAssetID), CreatedBy: r.CreatedBy, UpdatedBy: r.UpdatedBy,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
	if r.DeletedAt != nil && *r.DeletedAt != 0 {
		deletedAt := time.UnixMilli(*r.DeletedAt).UTC()
		item.DeletedAt = &deletedAt
	}
	if err = applyCanvasNodePayload(&item, payload); err != nil {
		return domain.CanvasNode{}, fmt.Errorf("apply canvas node %s payload: %w", r.ID, err)
	}
	if nodeType == domain.NodeTypeImageAsset || nodeType == domain.NodeTypeVideoAsset || nodeType == domain.NodeTypeAudioAsset {
		if !domain.ValidMaterialReference(item) {
			return domain.CanvasNode{}, fmt.Errorf("canvas node %s has inconsistent material reference", r.ID)
		}
	}
	return item, nil
}

func (r *Repository) decodeRow(_ context.Context, row canvasnodeRow) (domain.CanvasNode, error) {
	return fromRow(row)
}

func optionalUUIDString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func loadSelectedOutputMetadata(ctx context.Context, db *sqlc.Queries, scope app.Scope, items []domain.CanvasNode) error {
	selectedIDs := make([]string, 0, len(items))
	indexByOutputID := make(map[string]int, len(items))
	for index := range items {
		if items[index].SelectedOutputID == "" {
			continue
		}
		id, err := parseID(items[index].SelectedOutputID)
		if err != nil {
			return err
		}
		selectedIDs = append(selectedIDs, id)
		indexByOutputID[items[index].SelectedOutputID] = index
	}
	if len(selectedIDs) == 0 {
		return nil
	}
	rows, err := db.NodeMetadata(ctx, sqlc.NodeMetadataParams{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, Ids: selectedIDs,
	})
	if err != nil {
		return err
	}
	for _, row := range rows {
		index, exists := indexByOutputID[row.TaskRunID]
		if !exists || items[index].ID != row.NodeID {
			continue
		}
		if row.FirstFrameAssetID != nil {
			items[index].FirstFrameAssetID = *row.FirstFrameAssetID
		}
		if row.LastFrameAssetID != nil {
			items[index].LastFrameAssetID = *row.LastFrameAssetID
		}
		if row.OutputDurationSeconds != nil {
			duration := *row.OutputDurationSeconds
			items[index].SelectedOutputDurationSeconds = &duration
		}
	}
	return nil
}

func rebalanceRows(ctx context.Context, tx *sqlc.Queries, rows []canvasnodeRow) error {
	for index := range rows {
		temporaryKey := math.MinInt64 + int64(index) + 1
		if _, err := tx.NodeRebalance(ctx, sqlc.NodeRebalanceParams{
			Rank: temporaryKey, ID: rows[index].ID,
		}); err != nil {
			return err
		}
	}
	for index := range rows {
		stableKey := int64(index+1) * 1024
		if _, err := tx.NodeRebalance(ctx, sqlc.NodeRebalanceParams{
			Rank: stableKey, ID: rows[index].ID,
		}); err != nil {
			return err
		}
		rows[index].StoryboardRank = stableKey
	}
	return nil
}

func readErr(e error) error {
	if errors.Is(e, pgx.ErrNoRows) {
		return app.ErrNotFound
	}
	return e
}
