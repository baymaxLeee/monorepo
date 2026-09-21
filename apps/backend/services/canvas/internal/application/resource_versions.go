package application

import (
	"context"
	"io"
	"time"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	domain "github.com/example/monorepo/canvas/internal/domain/resource"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func resourceSlot(db *gorm.DB, a Actor, projectID, id string, write bool) (p.Resource, p.ResourceAsset, error) {
	var resource p.Resource
	var slot p.ResourceAsset
	if _, err := access(db, a, projectID, write); err != nil {
		return resource, slot, err
	}
	if err := db.First(&slot, "id = ?", id).Error; err != nil {
		return resource, slot, NotFound()
	}
	q := db
	if write {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"}).Session(&gorm.Session{})
	}
	if err := q.Where("id = ? AND project_id = ?", slot.ResourceID, projectID).First(&resource).Error; err != nil {
		return resource, slot, NotFound()
	}
	if err := q.First(&slot, "id = ?", id).Error; err != nil {
		return resource, slot, NotFound()
	}
	return resource, slot, nil
}
func resourceAssetDTO(slot p.ResourceAsset) c.ResourceAsset {
	return c.ResourceAsset{ID: slot.ID, Name: slot.Name, MediaType: slot.MediaType, Revision: slot.Revision}
}
func (s *Service) ReplaceResourceAsset(ctx context.Context, a Actor, projectID, id string, expected int64, body io.Reader) (c.ResourceAsset, error) {
	if expected < 1 {
		return c.ResourceAsset{}, Invalid("expected revision is required")
	}
	db := s.DB.WithContext(ctx)
	if _, _, err := resourceSlot(db, a, projectID, id, false); err != nil {
		return c.ResourceAsset{}, err
	}
	if _, err := access(db, a, projectID, true); err != nil {
		return c.ResourceAsset{}, err
	}
	key, mime, kind, err := s.storeMedia(ctx, a, projectID, body)
	if err != nil {
		return c.ResourceAsset{}, err
	}
	var out p.ResourceAsset
	err = db.Transaction(func(tx *gorm.DB) error {
		resource, slot, err := resourceSlot(tx, a, projectID, id, true)
		if err != nil {
			return err
		}
		if slot.Revision != expected {
			return Conflict()
		}
		if slot.MediaType != kind {
			return Invalid("resource media type mismatch")
		}
		asset := p.Asset{ID: newID(), TenantID: a.TenantID, WorkspaceID: a.WorkspaceID, ProjectID: projectID, ObjectKey: key, MimeType: mime}
		if err = tx.Create(&asset).Error; err != nil {
			return err
		}
		var revision int64
		if err = tx.Model(&p.ResourceAssetRevision{}).Where("resource_asset_id = ?", id).Select("COALESCE(MAX(revision_no),0)").Scan(&revision).Error; err != nil {
			return err
		}
		if err = tx.Create(&p.ResourceAssetRevision{ResourceAssetID: id, AssetID: asset.ID, MediaType: kind, RevisionNo: revision + 1, CreatedAt: time.Now()}).Error; err != nil {
			return err
		}
		if err = tx.Create(&p.AssetReference{AssetID: asset.ID, OwnerType: "RESOURCE_ASSET_REVISION", OwnerKey: id}).Error; err != nil {
			return err
		}
		slot.CurrentAssetID, slot.Revision = asset.ID, slot.Revision+1
		if err = tx.Save(&slot).Error; err != nil {
			return err
		}
		resource.Revision++
		out = slot
		return tx.Save(&resource).Error
	})
	return resourceAssetDTO(out), err
}
func (s *Service) ListResourceVersions(ctx context.Context, a Actor, projectID, id string) (c.ResourceVersionList, error) {
	db := s.DB.WithContext(ctx)
	_, slot, err := resourceSlot(db, a, projectID, id, false)
	if err != nil {
		return c.ResourceVersionList{}, err
	}
	var rows []p.ResourceAssetRevision
	if err = db.Where("resource_asset_id = ?", id).Order("revision_no DESC").Find(&rows).Error; err != nil {
		return c.ResourceVersionList{}, err
	}
	out := c.ResourceVersionList{Items: []c.ResourceVersion{}}
	for _, row := range rows {
		out.Items = append(out.Items, c.ResourceVersion{RevisionNo: row.RevisionNo, Current: row.AssetID == slot.CurrentAssetID, CreatedAt: isoTime(row.CreatedAt)})
	}
	return out, nil
}
func (s *Service) ResourceVersionContent(ctx context.Context, a Actor, projectID, id string, revision int64) (MediaContent, error) {
	db := s.DB.WithContext(ctx)
	if _, _, err := resourceSlot(db, a, projectID, id, false); err != nil {
		return MediaContent{}, err
	}
	var asset p.Asset
	if err := db.Where("tenant_id = ? AND workspace_id = ? AND project_id = ? AND id IN (SELECT asset_id FROM resource_asset_revisions WHERE resource_asset_id = ? AND revision_no = ?) AND EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id AND owner_type = 'RESOURCE_ASSET_REVISION' AND owner_key = ? AND deleted_at IS NULL)", a.TenantID, a.WorkspaceID, projectID, id, revision, id).First(&asset).Error; err != nil {
		return MediaContent{}, NotFound()
	}
	body, err := s.Storage.Get(ctx, storage.Scope(a.TenantID, a.WorkspaceID, projectID), asset.ObjectKey)
	return MediaContent{Body: body, MIME: asset.MimeType}, err
}
func (s *Service) UpdateResourceAsset(ctx context.Context, a Actor, projectID, id string, in c.ResourceAssetUpdate) (c.ResourceAsset, error) {
	if in.RevisionNo < 0 {
		return c.ResourceAsset{}, Invalid("invalid revision")
	}
	var out p.ResourceAsset
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		resource, slot, err := resourceSlot(tx, a, projectID, id, true)
		if err != nil {
			return err
		}
		if slot.Revision != in.ExpectedRevision {
			return Conflict()
		}
		if err = domain.ValidateResourceAssetName(in.Name); err != nil {
			return Invalid(err.Error())
		}
		if in.RevisionNo > 0 {
			var version p.ResourceAssetRevision
			if err = tx.Where("resource_asset_id = ? AND revision_no = ?", id, in.RevisionNo).First(&version).Error; err != nil {
				return NotFound()
			}
			slot.CurrentAssetID = version.AssetID
		}
		slot.Name, slot.Revision = in.Name, slot.Revision+1
		if err = tx.Save(&slot).Error; err != nil {
			return err
		}
		resource.Revision++
		out = slot
		return tx.Save(&resource).Error
	})
	return resourceAssetDTO(out), err
}
func (s *Service) SetPrimaryResourceAsset(ctx context.Context, a Actor, projectID, id string, in c.ExpectedRevision) (c.Resource, error) {
	var out p.Resource
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		resource, _, err := resourceSlot(tx, a, projectID, id, true)
		if err != nil {
			return err
		}
		if resource.Revision != in.ExpectedRevision {
			return Conflict()
		}
		resource.PrimaryResourceAssetID, resource.Revision = id, resource.Revision+1
		out = resource
		return tx.Save(&resource).Error
	})
	return resourceDTO(out), err
}
func (s *Service) DeleteResourceAsset(ctx context.Context, a Actor, projectID, id string, in c.ExpectedRevision) (c.Deleted, error) {
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		resource, slot, err := resourceSlot(tx, a, projectID, id, true)
		if err != nil {
			return err
		}
		if slot.Revision != in.ExpectedRevision {
			return Conflict()
		}
		if err = tx.Where("owner_type = ? AND owner_key = ?", "RESOURCE_ASSET_REVISION", id).Delete(&p.AssetReference{}).Error; err != nil {
			return err
		}
		if err = tx.Delete(&slot).Error; err != nil {
			return err
		}
		if resource.PrimaryResourceAssetID == id {
			var next []p.ResourceAsset
			if err = tx.Where("resource_id = ?", resource.ID).Order("sequence_no,id").Limit(1).Find(&next).Error; err != nil {
				return err
			}
			resource.PrimaryResourceAssetID = ""
			if len(next) != 0 {
				resource.PrimaryResourceAssetID = next[0].ID
			}
		}
		resource.ResourceAssetCount--
		resource.Revision++
		return tx.Save(&resource).Error
	})
	return c.Deleted{Deleted: err == nil}, err
}
