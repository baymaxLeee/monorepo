package asset

import (
	"context"
	"errors"
	"fmt"
	"time"
)

const referenceCountRebuildBatchSize = 100

var ErrInvalidReferenceCountRebuild = errors.New("invalid asset reference count rebuild")

type ReferenceCountAsset struct {
	AssetID     string
	TenantID    string
	WorkspaceID *string
}

type ReferenceCountUpdate struct {
	ReferenceCountAsset
	Count int32
}

type ReferenceCountRebuildStore interface {
	ListReferenceCountAssets(context.Context, time.Time, time.Time, string, int) ([]ReferenceCountAsset, error)
	ReplaceReferenceCounts(context.Context, []ReferenceCountUpdate) error
}

type ReferenceCountReconciler struct {
	store      ReferenceCountRebuildStore
	references ReferenceCounter
}

func NewReferenceCountReconciler(store ReferenceCountRebuildStore, references ReferenceCounter) *ReferenceCountReconciler {
	return &ReferenceCountReconciler{store: store, references: references}
}

func (reconciler *ReferenceCountReconciler) Run(ctx context.Context, windowStart, windowEnd time.Time) (int, error) {
	if reconciler == nil || reconciler.store == nil || reconciler.references == nil || windowStart.IsZero() || !windowStart.Before(windowEnd) {
		return 0, ErrInvalidReferenceCountRebuild
	}
	completed := 0
	afterAssetID := ""
	for ctx.Err() == nil {
		assets, err := reconciler.store.ListReferenceCountAssets(ctx, windowStart, windowEnd, afterAssetID, referenceCountRebuildBatchSize)
		if err != nil {
			return completed, err
		}
		if len(assets) == 0 {
			return completed, nil
		}
		updates, err := reconciler.rebuildBatch(ctx, assets)
		if err != nil {
			return completed, err
		}
		if err = reconciler.store.ReplaceReferenceCounts(ctx, updates); err != nil {
			return completed, err
		}
		completed += len(assets)
		afterAssetID = assets[len(assets)-1].AssetID
		if len(assets) < referenceCountRebuildBatchSize {
			return completed, nil
		}
	}
	return completed, ctx.Err()
}

func (reconciler *ReferenceCountReconciler) rebuildBatch(ctx context.Context, assets []ReferenceCountAsset) ([]ReferenceCountUpdate, error) {
	updates := make([]ReferenceCountUpdate, len(assets))
	positions := make(map[string]int, len(assets))
	type scopeGroup struct {
		scope ReferenceScope
		ids   []string
	}
	groups := make([]scopeGroup, 0)
	groupPositions := make(map[string]int)
	for index, item := range assets {
		updates[index].ReferenceCountAsset = item
		positions[item.AssetID] = index
		key := referenceCountScopeKey(item.TenantID, item.WorkspaceID)
		position, exists := groupPositions[key]
		if !exists {
			position = len(groups)
			groupPositions[key] = position
			groups = append(groups, scopeGroup{scope: ReferenceScope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID}})
		}
		groups[position].ids = append(groups[position].ids, item.AssetID)
	}
	for _, group := range groups {
		counts, err := reconciler.references.CountReferences(ctx, group.scope, group.ids)
		if err != nil {
			return nil, fmt.Errorf("rebuild asset reference counts: %w", err)
		}
		for assetID, count := range counts {
			position, exists := positions[assetID]
			if !exists || count < 0 {
				return nil, ErrInvalidReferenceCountRebuild
			}
			updates[position].Count = count
		}
	}
	return updates, nil
}

func referenceCountScopeKey(tenantID string, workspaceID *string) string {
	if workspaceID == nil {
		return tenantID + "\x00"
	}
	return tenantID + "\x00" + *workspaceID
}
