package application

import (
	"context"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	"gorm.io/gorm"
)

func releaseGenerationOwners(tx *gorm.DB, nodeIDs *gorm.DB) error {
	generations := tx.Model(&p.Generation{}).Select("id").Where("node_id IN (?)", nodeIDs)
	if err := tx.Where("owner_type = ? AND owner_key IN (?)", "CANVAS_GENERATION_OUTPUT", generations).Delete(&p.AssetReference{}).Error; err != nil {
		return err
	}
	return tx.Model(&p.Generation{}).Where("node_id IN (?) AND status IN ?", nodeIDs, []string{"queued", "running"}).Update("cancel_requested", true).Error
}

func (s *Service) GenerationContent(ctx context.Context, actor Actor, canvasID, id string) (MediaContent, error) {
	db := s.DB.WithContext(ctx)
	board, err := boardAccess(db, actor, canvasID, false)
	if err != nil {
		return MediaContent{}, err
	}
	var generation p.Generation
	if err := db.Where("id = ? AND canvas_id = ? AND status = 'completed'", id, canvasID).First(&generation).Error; err != nil {
		return MediaContent{}, NotFound()
	}
	var node p.Node
	if err := db.Where("id = ? AND canvas_id = ?", generation.NodeID, canvasID).First(&node).Error; err != nil {
		return MediaContent{}, NotFound()
	}
	var asset p.Asset
	if err := db.Where("id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id AND owner_type = 'CANVAS_GENERATION_OUTPUT' AND owner_key = ? AND deleted_at IS NULL)", generation.OutputAssetID, actor.TenantID, actor.WorkspaceID, board.ProjectID, id).First(&asset).Error; err != nil {
		return MediaContent{}, NotFound()
	}
	body, err := s.Storage.Get(ctx, storage.Scope(actor.TenantID, actor.WorkspaceID, board.ProjectID), asset.ObjectKey)
	return MediaContent{Body: body, MIME: asset.MimeType}, err
}
