package application

import (
	"context"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"gorm.io/gorm"
)

func (s *Service) CanvasNodeFrames(ctx context.Context, a Actor, id, nodeID string) (c.NodeFrames, error) {
	db := s.DB.WithContext(ctx)
	if _, e := boardAccess(db, a, id, false); e != nil {
		return c.NodeFrames{}, e
	}
	var node p.Node
	if e := db.Where("id = ? AND canvas_id = ?", nodeID, id).First(&node).Error; e != nil {
		return c.NodeFrames{}, NotFound()
	}
	var frame p.VideoFrames
	e := db.Where("generation_id IN (SELECT id FROM canvas_generations WHERE node_id = ? AND canvas_id = ? AND output_asset_id = ?)", nodeID, id, node.AssetID).Order("created_at DESC").First(&frame).Error
	if e == gorm.ErrRecordNotFound {
		return c.NodeFrames{Status: "unavailable"}, nil
	}
	if e != nil {
		return c.NodeFrames{}, e
	}
	return c.NodeFrames{Status: frame.Status, FirstAssetID: frame.FirstAssetID, LastAssetID: frame.LastAssetID}, nil
}
