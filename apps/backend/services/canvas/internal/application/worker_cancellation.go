package application

import (
	"context"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
)

func (s *Service) generationCancellation(ctx context.Context, id string) (bool, error) {
	var row p.Generation
	db := s.DB.WithContext(ctx)
	if err := db.Select("id", "canvas_id", "node_id", "tenant_id", "workspace_id", "cancel_requested").First(&row, "id = ?", id).Error; err != nil {
		return false, err
	}
	if row.CancelRequested {
		return true, nil
	}
	var count int64
	err := db.Table("canvas_nodes n").Joins("JOIN canvases c ON c.id = n.canvas_id").Joins("JOIN projects p ON p.id = c.project_id").Where("n.id = ? AND c.id = ? AND p.tenant_id = ? AND p.workspace_id = ? AND n.deleted_at IS NULL AND c.deleted_at IS NULL AND p.deleted_at IS NULL", row.NodeID, row.CanvasID, row.TenantID, row.WorkspaceID).Count(&count).Error
	if err != nil {
		return false, err
	}
	if count == 1 {
		return false, nil
	}
	return true, db.Model(&p.Generation{}).Where("id = ? AND status IN ?", id, []string{"queued", "running"}).Update("cancel_requested", true).Error
}
