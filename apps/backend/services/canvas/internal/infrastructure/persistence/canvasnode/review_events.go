package canvasnode

import (
	"context"

	appasset "github.com/example/monorepo/canvas/internal/application/asset"
	stream "github.com/example/monorepo/canvas/internal/application/canvasstream"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
	reviews "github.com/example/monorepo/canvas/internal/infrastructure/persistence/benefitpackage"
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

func (j *EventJournal) collectNodeReviews(ctx context.Context, s eventScope, state *stream.State) error {
	ids := []string{}
	for _, node := range state.Nodes {
		if id := currentReviewAssetID(node); id != "" {
			ids = append(ids, id)
		}
	}
	// Read only reviews of already scoped, current node references. This creates
	// neither an Asset nor a retaining owner; the content lifecycle stays unchanged.
	byAsset, err := reviews.NewRepository(j.db).BatchGetAssetReviews(ctx, appasset.Scope{TenantID: s.TenantID, WorkspaceID: s.WorkspaceID}, ids)
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
