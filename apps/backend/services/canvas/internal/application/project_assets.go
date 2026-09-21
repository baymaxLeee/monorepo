package application

import (
	"context"
	"io"
	"strings"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	"gorm.io/gorm"
)

func (s *Service) UploadProjectAsset(ctx context.Context, actor Actor, projectID, clientID, name string, body io.Reader) (c.ProjectAsset, error) {
	clientID = strings.TrimSpace(clientID)
	name = strings.TrimSpace(name)
	if clientID == "" || len(clientID) > 60 || name == "" || len(name) > 255 {
		return c.ProjectAsset{}, Invalid("invalid project asset upload")
	}
	db := s.DB.WithContext(ctx)
	if _, err := access(db, actor, projectID, true); err != nil {
		return c.ProjectAsset{}, err
	}
	var existing p.Asset
	err := db.Joins("JOIN asset_references project_owner ON project_owner.asset_id = assets.id AND project_owner.deleted_at IS NULL").
		Where("assets.tenant_id = ? AND assets.workspace_id = ? AND assets.project_id = ? AND project_owner.owner_type = ? AND project_owner.owner_key = ?", actor.TenantID, actor.WorkspaceID, projectID, "PROJECT_ASSET", clientID).
		First(&existing).Error
	if err == nil {
		return c.ProjectAsset{ID: existing.ID, MediaType: mediaType(existing.MimeType)}, nil
	}
	if err != gorm.ErrRecordNotFound {
		return c.ProjectAsset{}, err
	}
	key, mime, kind, err := s.storeMedia(ctx, actor, projectID, body)
	if err != nil {
		return c.ProjectAsset{}, err
	}
	asset := p.Asset{ID: newID(), TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, ProjectID: projectID, ObjectKey: key, MimeType: mime, OriginalName: name}
	err = db.Transaction(func(tx *gorm.DB) error {
		if _, err := access(tx, actor, projectID, true); err != nil {
			return err
		}
		if err := tx.Create(&asset).Error; err != nil {
			return err
		}
		return tx.Create(&p.AssetReference{AssetID: asset.ID, OwnerType: "PROJECT_ASSET", OwnerKey: clientID}).Error
	})
	if err != nil {
		_ = s.Storage.Delete(context.WithoutCancel(ctx), storage.Scope(actor.TenantID, actor.WorkspaceID, projectID), key)
		return c.ProjectAsset{}, err
	}
	return c.ProjectAsset{ID: asset.ID, MediaType: kind}, nil
}

func mediaType(mime string) int16 {
	switch {
	case strings.HasPrefix(mime, "image/"):
		return 1
	case strings.HasPrefix(mime, "video/"):
		return 2
	case strings.HasPrefix(mime, "audio/"):
		return 3
	default:
		return 0
	}
}

func (s *Service) ProjectAssetContent(ctx context.Context, actor Actor, projectID, assetID string) (MediaContent, error) {
	if _, err := access(s.DB.WithContext(ctx), actor, projectID, false); err != nil {
		return MediaContent{}, err
	}
	var asset p.Asset
	err := s.DB.WithContext(ctx).Where(
		"id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id AND owner_type = ? AND deleted_at IS NULL)",
		assetID, actor.TenantID, actor.WorkspaceID, projectID, "PROJECT_ASSET",
	).First(&asset).Error
	if err != nil {
		return MediaContent{}, NotFound()
	}
	body, err := s.Storage.Get(ctx, storage.Scope(actor.TenantID, actor.WorkspaceID, projectID), asset.ObjectKey)
	return MediaContent{Body: body, MIME: asset.MimeType}, err
}
