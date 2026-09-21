package application

import (
	"context"
	"time"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func manageProject(tx *gorm.DB, actor Actor, id string) (p.Project, error) {
	var project p.Project
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND tenant_id = ? AND workspace_id = ?", id, actor.TenantID, actor.WorkspaceID).First(&project).Error
	if err == gorm.ErrRecordNotFound {
		return project, NotFound()
	}
	if err != nil {
		return project, err
	}
	if project.CreatedBy != actor.UserID && actor.WorkspaceRole != "workspace_admin" {
		return project, NotFound()
	}
	return project, err
}

func (s *Service) GetProject(ctx context.Context, actor Actor, id string) (c.Project, error) {
	project, err := access(s.DB.WithContext(ctx), actor, id, false)
	return projectDTO(project), err
}

func (s *Service) UpdateProject(ctx context.Context, actor Actor, id string, in c.UpdateProject) (c.Project, error) {
	if err := requireProjectAdmin(actor); err != nil {
		return c.Project{}, err
	}
	if !validName(in.Name) || len(in.Description) > 20000 {
		return c.Project{}, Invalid("invalid project name or description")
	}
	var project p.Project
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		project, err = manageProject(tx, actor, id)
		if err != nil {
			return err
		}
		if project.Revision != in.ExpectedRevision {
			return Conflict()
		}
		project.Name, project.Description = in.Name, in.Description
		project.Revision++
		return tx.Save(&project).Error
	})
	if uniqueViolation(err, "projects_scope_name") {
		err = ConflictMessage("project_name_conflict", "同一工作空间内项目名称不能重复")
	}
	return projectDTO(project), err
}

func (s *Service) DeleteProject(ctx context.Context, actor Actor, id string, in c.ExpectedRevision) (c.Deleted, error) {
	if err := requireProjectAdmin(actor); err != nil {
		return c.Deleted{}, err
	}
	var cleanupIDs []string
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		project, err := manageProject(tx, actor, id)
		if err != nil {
			return err
		}
		if project.Revision != in.ExpectedRevision {
			return Conflict()
		}
		var reviewAssetIDs []string
		if err := tx.Model(&p.Asset{}).Where("project_id = ?", id).Pluck("id", &reviewAssetIDs).Error; err != nil {
			return err
		}
		cleanupIDs, err = s.retireAssetReviews(tx, actor, reviewAssetIDs, "", time.Now().UTC())
		if err != nil {
			return err
		}
		if err := releaseGenerationOwners(tx, tx.Model(&p.Node{}).Select("id").Where("canvas_id IN (SELECT id FROM canvases WHERE project_id = ?)", id)); err != nil {
			return err
		}
		if err := tx.Where("owner_type = ? AND owner_key IN (SELECT id FROM canvas_nodes WHERE canvas_id IN (SELECT id FROM canvases WHERE project_id = ?))", "CANVAS_NODE_ASSET", id).Delete(&p.AssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("owner_type = ? AND owner_key IN (SELECT id FROM resource_assets WHERE resource_id IN (SELECT id FROM resources WHERE project_id = ?))", "RESOURCE_ASSET_REVISION", id).Delete(&p.AssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("owner_type = ? AND asset_id IN (SELECT id FROM assets WHERE project_id = ?)", "PROJECT_ASSET", id).Delete(&p.AssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("owner_type = ? AND owner_key = ?", "PROJECT_COVER", id).Delete(&p.AssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("owner_type = ? AND owner_key IN (SELECT id FROM canvases WHERE project_id = ?)", "CANVAS_COVER", id).Delete(&p.AssetReference{}).Error; err != nil {
			return err
		}
		// Retain content for recovery; the deleted project is the access boundary.
		return tx.Delete(&project).Error
	})
	if err == nil {
		s.processAssetReviewCleanups(context.WithoutCancel(ctx), cleanupIDs)
	}
	return c.Deleted{Deleted: err == nil}, err
}

func (s *Service) UpdateBoard(ctx context.Context, actor Actor, id string, in c.UpdateBoard) (c.Board, error) {
	if !validName(in.Name) {
		return c.Board{}, Invalid("invalid canvas name")
	}
	var board p.Board
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		board, err = boardAccess(tx, actor, id, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", id).Error; err != nil {
			return err
		}
		if board.Revision != in.ExpectedRevision {
			return Conflict()
		}
		board.Name = in.Name
		board.Revision++
		return tx.Save(&board).Error
	})
	return boardDTO(board), err
}

func (s *Service) DeleteBoard(ctx context.Context, actor Actor, id string, in c.ExpectedRevision) (c.Deleted, error) {
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		board, err := boardAccess(tx, actor, id, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", id).Error; err != nil {
			return err
		}
		if board.Revision != in.ExpectedRevision {
			return Conflict()
		}
		if err := releaseGenerationOwners(tx, tx.Model(&p.Node{}).Select("id").Where("canvas_id = ?", id)); err != nil {
			return err
		}
		if err := tx.Where("owner_type = ? AND owner_key IN (SELECT id FROM canvas_nodes WHERE canvas_id = ?)", "CANVAS_NODE_ASSET", id).Delete(&p.AssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("owner_type = ? AND owner_key = ?", "CANVAS_COVER", id).Delete(&p.AssetReference{}).Error; err != nil {
			return err
		}
		return tx.Delete(&board).Error
	})
	return c.Deleted{Deleted: err == nil}, err
}

func isoTime(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
