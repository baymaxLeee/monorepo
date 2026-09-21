package application

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maximumCoverImageBytes = 2 << 20

func (s *Service) storeCover(ctx context.Context, actor Actor, projectID string, body io.Reader) (string, string, error) {
	content, err := io.ReadAll(io.LimitReader(body, maximumCoverImageBytes+1))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return "", "", Invalid("封面图片不能超过 2MB")
		}
		return "", "", err
	}
	if len(content) == 0 || len(content) > maximumCoverImageBytes {
		return "", "", Invalid("封面图片不能超过 2MB")
	}
	mime := http.DetectContentType(content)
	if mime != "image/png" && mime != "image/jpeg" {
		return "", "", Invalid("封面仅支持 PNG、JPG、JPEG 格式")
	}
	key, err := s.Storage.Put(ctx, storage.Scope(actor.TenantID, actor.WorkspaceID, projectID), bytes.NewReader(content))
	return key, mime, err
}

func (s *Service) UploadProjectCover(ctx context.Context, actor Actor, projectID string, expectedRevision int64, body io.Reader) (c.Project, error) {
	if expectedRevision < 1 {
		return c.Project{}, Invalid("expected revision is required")
	}
	if _, err := access(s.DB.WithContext(ctx), actor, projectID, true); err != nil {
		return c.Project{}, err
	}
	key, mime, err := s.storeCover(ctx, actor, projectID, body)
	if err != nil {
		return c.Project{}, err
	}
	asset := p.Asset{ID: newID(), TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, ProjectID: projectID, ArtifactID: key, MimeType: mime}
	var project p.Project
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var txErr error
		project, txErr = access(tx, actor, projectID, true)
		if txErr != nil {
			return txErr
		}
		if txErr = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&project, "id = ?", projectID).Error; txErr != nil {
			return txErr
		}
		if project.Revision != expectedRevision {
			return Conflict()
		}
		if txErr = tx.Create(&asset).Error; txErr != nil {
			return txErr
		}
		if txErr = tx.Create(&p.AssetReference{AssetID: asset.ID, OwnerType: "PROJECT_COVER", OwnerKey: project.ID}).Error; txErr != nil {
			return txErr
		}
		if project.CoverAssetID != "" {
			if txErr = tx.Where("asset_id = ? AND owner_type = ? AND owner_key = ?", project.CoverAssetID, "PROJECT_COVER", project.ID).Delete(&p.AssetReference{}).Error; txErr != nil {
				return txErr
			}
		}
		project.CoverAssetID = asset.ID
		project.Revision++
		return tx.Save(&project).Error
	})
	if err != nil {
		_ = s.Storage.Delete(context.WithoutCancel(ctx), storage.Scope(actor.TenantID, actor.WorkspaceID, projectID), key)
	}
	return s.projectDTOWithCover(ctx, actor, project), err
}

func (s *Service) ClearProjectCover(ctx context.Context, actor Actor, projectID string, in c.ExpectedRevision) (c.Project, error) {
	var project p.Project
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		project, err = access(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&project, "id = ?", projectID).Error; err != nil {
			return err
		}
		if project.Revision != in.ExpectedRevision {
			return Conflict()
		}
		if project.CoverAssetID != "" {
			if err = tx.Where("asset_id = ? AND owner_type = ? AND owner_key = ?", project.CoverAssetID, "PROJECT_COVER", project.ID).Delete(&p.AssetReference{}).Error; err != nil {
				return err
			}
			project.CoverAssetID = ""
			project.Revision++
			return tx.Save(&project).Error
		}
		return nil
	})
	return s.projectDTOWithCover(ctx, actor, project), err
}

func (s *Service) ProjectCoverContent(ctx context.Context, actor Actor, projectID string) (MediaContent, error) {
	db := s.DB.WithContext(ctx)
	project, err := access(db, actor, projectID, false)
	if err != nil || project.CoverAssetID == "" {
		return MediaContent{}, NotFound()
	}
	return s.coverContent(ctx, actor, projectID, project.CoverAssetID, "PROJECT_COVER", project.ID)
}

func (s *Service) UploadBoardCover(ctx context.Context, actor Actor, canvasID string, expectedRevision int64, body io.Reader) (c.Board, error) {
	if expectedRevision < 1 {
		return c.Board{}, Invalid("expected revision is required")
	}
	board, err := boardAccess(s.DB.WithContext(ctx), actor, canvasID, true)
	if err != nil {
		return c.Board{}, err
	}
	key, mime, err := s.storeCover(ctx, actor, board.ProjectID, body)
	if err != nil {
		return c.Board{}, err
	}
	asset := p.Asset{ID: newID(), TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, ProjectID: board.ProjectID, ArtifactID: key, MimeType: mime}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var txErr error
		board, txErr = boardAccess(tx, actor, canvasID, true)
		if txErr != nil {
			return txErr
		}
		if txErr = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", canvasID).Error; txErr != nil {
			return txErr
		}
		if board.Revision != expectedRevision {
			return Conflict()
		}
		if txErr = tx.Create(&asset).Error; txErr != nil {
			return txErr
		}
		if txErr = tx.Create(&p.AssetReference{AssetID: asset.ID, OwnerType: "CANVAS_COVER", OwnerKey: board.ID}).Error; txErr != nil {
			return txErr
		}
		if board.CoverAssetID != "" {
			if txErr = tx.Where("asset_id = ? AND owner_type = ? AND owner_key = ?", board.CoverAssetID, "CANVAS_COVER", board.ID).Delete(&p.AssetReference{}).Error; txErr != nil {
				return txErr
			}
		}
		board.CoverAssetID = asset.ID
		board.Revision++
		return tx.Save(&board).Error
	})
	if err != nil {
		_ = s.Storage.Delete(context.WithoutCancel(ctx), storage.Scope(actor.TenantID, actor.WorkspaceID, board.ProjectID), key)
	}
	return s.boardDTOWithCover(ctx, actor, board), err
}

func (s *Service) ClearBoardCover(ctx context.Context, actor Actor, canvasID string, in c.ExpectedRevision) (c.Board, error) {
	var board p.Board
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		board, err = boardAccess(tx, actor, canvasID, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", canvasID).Error; err != nil {
			return err
		}
		if board.Revision != in.ExpectedRevision {
			return Conflict()
		}
		if board.CoverAssetID != "" {
			if err = tx.Where("asset_id = ? AND owner_type = ? AND owner_key = ?", board.CoverAssetID, "CANVAS_COVER", board.ID).Delete(&p.AssetReference{}).Error; err != nil {
				return err
			}
			board.CoverAssetID = ""
			board.Revision++
			return tx.Save(&board).Error
		}
		return nil
	})
	return s.boardDTOWithCover(ctx, actor, board), err
}

func (s *Service) BoardCoverContent(ctx context.Context, actor Actor, canvasID string) (MediaContent, error) {
	db := s.DB.WithContext(ctx)
	board, err := boardAccess(db, actor, canvasID, false)
	if err != nil || board.CoverAssetID == "" {
		return MediaContent{}, NotFound()
	}
	return s.coverContent(ctx, actor, board.ProjectID, board.CoverAssetID, "CANVAS_COVER", board.ID)
}

func (s *Service) coverContent(ctx context.Context, actor Actor, projectID, assetID, ownerType, ownerKey string) (MediaContent, error) {
	var asset p.Asset
	err := s.DB.WithContext(ctx).Where(
		"id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id AND owner_type = ? AND owner_key = ? AND deleted_at IS NULL)",
		assetID, actor.TenantID, actor.WorkspaceID, projectID, ownerType, ownerKey,
	).First(&asset).Error
	if err != nil {
		return MediaContent{}, NotFound()
	}
	body, err := s.Storage.Get(ctx, storage.Scope(actor.TenantID, actor.WorkspaceID, projectID), asset.ArtifactID)
	return MediaContent{Body: body, MIME: asset.MimeType}, err
}

func (s *Service) UpdateCanvasView(ctx context.Context, actor Actor, canvasID string, in c.UpdateCanvasView) (c.Board, error) {
	if in.DefaultView != 1 && in.DefaultView != 2 {
		return c.Board{}, Invalid("invalid canvas view")
	}
	var board p.Board
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		board, err = boardAccess(tx, actor, canvasID, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", canvasID).Error; err != nil {
			return err
		}
		if board.Revision != in.ExpectedRevision {
			return Conflict()
		}
		if board.DefaultView == in.DefaultView {
			return nil
		}
		board.DefaultView = in.DefaultView
		board.Revision++
		board.UpdatedAt = time.Now().UTC()
		return tx.Save(&board).Error
	})
	return s.boardDTOWithCover(ctx, actor, board), err
}
