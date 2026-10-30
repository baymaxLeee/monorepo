package canvasnode

import (
	"sort"

	"gorm.io/gorm"

	appasset "github.com/example/monorepo/canvas/internal/application/asset"
	stream "github.com/example/monorepo/canvas/internal/application/canvasstream"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
	reviews "github.com/example/monorepo/canvas/internal/infrastructure/persistence/benefitpackage"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

func currentReviewAssetID(node domain.CanvasNode) string {
	if node.AssetID != "" {
		return node.AssetID
	}
	if node.CurrentAssetID != "" {
		return node.CurrentAssetID
	}
	return node.SelectedAssetID
}

func (*EventJournal) collectNodeReviews(db *gorm.DB, s eventScope, state *stream.State) error {
	ids := []string{}
	for _, node := range state.Nodes {
		if id := currentReviewAssetID(node); id != "" {
			ids = append(ids, id)
		}
	}
	// Read only reviews of already scoped, current node references. This creates
	// neither an Asset nor a retaining owner; the content lifecycle stays unchanged.
	byAsset, err := reviews.NewRepository(db).BatchGetAssetReviews(db.Statement.Context, appasset.Scope{TenantID: s.TenantID, WorkspaceID: s.WorkspaceID}, ids)
	if err != nil {
		return err
	}
	state.NodeReviews = []stream.NodeReviews{}
	for _, node := range state.Nodes {
		id := currentReviewAssetID(node)
		if id == "" {
			continue
		}
		items := append([]domainasset.Review{}, byAsset[id]...)
		state.NodeReviews = append(state.NodeReviews, stream.NodeReviews{NodeID: node.ID, AssetID: id, Reviews: items})
	}
	return nil
}

func (*EventJournal) reviewChangedScopes(db, query *gorm.DB, valueSets []map[string]any, readExisting bool) ([]eventScope, error) {
	fresh := db.Session(&gorm.Session{NewDB: true})
	// Capture the old relation before UPDATE/DELETE and the new relation from
	// INSERT values. Package model edits also change the public review projection.
	assetIDs := []persistenceid.UUID{}

	if readExisting {
		if err := query.Distinct("asset_id").Pluck("asset_id", &assetIDs).Error; err != nil {
			return nil, err
		}
	}
	for _, values := range valueSets {
		if id, ok := values["asset_id"].(persistenceid.UUID); ok {
			assetIDs = append(assetIDs, id)
		}
	}
	if len(assetIDs) == 0 {
		return nil, nil
	}
	// Asset identities are globally unique. The matching Canvas is still scoped
	// and authorized at journal collection and delivery; no subscription broadens.
	slots := fresh.Table("resource_assets").Select("id").Where("current_asset_id IN ? AND deleted_at = 0", assetIDs)
	resources := fresh.Table("resources").Select("id").Where("primary_resource_asset_id IN (?) AND deleted_at = 0", slots)
	scopes := []eventScope{}
	if err := fresh.Table("canvas_nodes").Where("deleted_at = 0").Where("asset_id IN ? OR selected_asset_id IN ? OR resource_asset_id IN (?) OR resource_id IN (?)", assetIDs, assetIDs, slots, resources).Distinct("tenant_id, workspace_id, project_id, canvas_id").Find(&scopes).Error; err != nil {
		return nil, err
	}
	sort.Slice(scopes, func(i, j int) bool { return scopes[i].CanvasID.String() < scopes[j].CanvasID.String() })
	return scopes, nil
}
