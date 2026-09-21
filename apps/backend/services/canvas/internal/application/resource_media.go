package application

import (
	"context"
	"encoding/json"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	assetdomain "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domain "github.com/example/monorepo/canvas/internal/server/domain/resource"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"io"
	"time"
)

func (s *Service) UploadResourceAsset(ctx context.Context, a Actor, projectID, resourceID, id, name string, body io.Reader) (c.ResourceAsset, error) {
	if len(id) < 1 || len(id) > 36 {
		return c.ResourceAsset{}, Invalid("invalid resource asset id")
	}
	if err := domain.ValidateResourceAssetName(name); err != nil {
		return c.ResourceAsset{}, Invalid(err.Error())
	}
	db := s.DB.WithContext(ctx)
	if _, err := access(db, a, projectID, true); err != nil {
		return c.ResourceAsset{}, err
	}
	var resource p.Resource
	if err := db.Where("id = ? AND project_id = ?", resourceID, projectID).First(&resource).Error; err != nil {
		return c.ResourceAsset{}, NotFound()
	}
	key, mime, kind, err := s.storeMedia(ctx, a, projectID, body)
	if err != nil {
		return c.ResourceAsset{}, err
	}
	var out p.ResourceAsset
	err = db.Transaction(func(tx *gorm.DB) error {
		if _, err := access(tx, a, projectID, true); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND project_id = ?", resourceID, projectID).First(&resource).Error; err != nil {
			return NotFound()
		}
		err := tx.Unscoped().First(&out, "id = ?", id).Error
		if err == nil {
			if out.ResourceID != resourceID || out.DeletedAt.Valid {
				return Conflict()
			}
			var existing p.Asset
			if err = tx.First(&existing, "id = ?", out.CurrentAssetID).Error; err != nil {
				return err
			}
			if existing.ArtifactID != key {
				return Conflict()
			}
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		if (resource.Type == 4 && kind != 3) || (resource.Type != 4 && kind != 1) {
			return Invalid("resource media type mismatch")
		}
		if resource.ResourceAssetCount >= domain.Type(resource.Type).ResourceAssetLimit() {
			return Invalid("resource asset limit reached")
		}
		asset := p.Asset{ID: newID(), TenantID: a.TenantID, WorkspaceID: a.WorkspaceID, ProjectID: projectID, ArtifactID: key, MimeType: mime}
		var sequence int64
		if err = tx.Unscoped().Model(&p.ResourceAsset{}).Where("resource_id = ?", resourceID).Select("COALESCE(MAX(sequence_no),0)").Scan(&sequence).Error; err != nil {
			return err
		}
		value, err := domain.NewResourceAsset(domain.NewResourceAssetInput{ID: id, ResourceID: resourceID, Name: name, SequenceNo: sequence + 1, CurrentAssetID: asset.ID, MediaType: assetdomain.MediaType(kind), Now: time.Now()})
		if err != nil {
			return Invalid(err.Error())
		}
		out = p.ResourceAsset{ID: value.ID, ResourceID: resourceID, Name: value.Name, SequenceNo: value.SequenceNo, SourceType: int16(value.SourceType), CurrentAssetID: asset.ID, MediaType: kind, Revision: 1}
		if err = tx.Create(&asset).Error; err != nil {
			return err
		}
		if err = tx.Create(&out).Error; err != nil {
			return err
		}
		if err = tx.Create(&p.ResourceAssetRevision{ResourceAssetID: id, AssetID: asset.ID, MediaType: kind, RevisionNo: 1, CreatedAt: time.Now()}).Error; err != nil {
			return err
		}
		if err = tx.Create(&p.AssetReference{AssetID: asset.ID, OwnerType: "RESOURCE_ASSET_REVISION", OwnerKey: id}).Error; err != nil {
			return err
		}
		if resource.PrimaryResourceAssetID == "" {
			resource.PrimaryResourceAssetID = id
		}
		resource.ResourceAssetCount++
		resource.Revision++
		return tx.Save(&resource).Error
	})
	return s.signedResourceAssetDTO(ctx, a, projectID, out), err
}
func (s *Service) ResourceContent(ctx context.Context, a Actor, projectID, id string) (MediaContent, error) {
	db := s.DB.WithContext(ctx)
	if _, err := access(db, a, projectID, false); err != nil {
		return MediaContent{}, err
	}
	var slot p.ResourceAsset
	if err := db.Where("id = ? AND resource_id IN (SELECT id FROM resources WHERE project_id = ? AND deleted_at IS NULL)", id, projectID).First(&slot).Error; err != nil {
		return MediaContent{}, NotFound()
	}
	var asset p.Asset
	err := db.Where("id = ? AND project_id = ? AND tenant_id = ? AND workspace_id = ? AND EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id AND owner_type = 'RESOURCE_ASSET_REVISION' AND owner_key = ? AND deleted_at IS NULL)", slot.CurrentAssetID, projectID, a.TenantID, a.WorkspaceID, id).First(&asset).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return MediaContent{}, NotFound()
		}
		return MediaContent{}, err
	}
	body, err := s.Storage.Get(ctx, storage.Scope(a.TenantID, a.WorkspaceID, projectID), asset.ArtifactID)
	return MediaContent{Body: body, MIME: asset.MimeType}, err
}
func (s *Service) CopyResourceToCanvas(ctx context.Context, a Actor, canvasID string, in c.MaterializeResource) (c.Graph, error) {
	var result c.Graph
	if len(in.NodeID) < 1 || len(in.NodeID) > 36 {
		return result, Invalid("invalid node id")
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		board, err := boardAccess(tx, a, canvasID, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", canvasID).Error; err != nil {
			return err
		}
		var slot p.ResourceAsset
		if err = tx.Where("id = ?", in.ResourceAssetID).First(&slot).Error; err != nil {
			return NotFound()
		}
		var resource p.Resource
		if err = tx.Clauses(clause.Locking{Strength: "SHARE"}).Where("id = ? AND project_id = ?", slot.ResourceID, board.ProjectID).First(&resource).Error; err != nil {
			return NotFound()
		}
		var asset p.Asset
		if err = tx.Where("id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ?", slot.CurrentAssetID, a.TenantID, a.WorkspaceID, board.ProjectID).First(&asset).Error; err != nil {
			return NotFound()
		}
		var count int64
		if err = tx.Model(&p.AssetReference{}).Where("asset_id = ? AND owner_type = ? AND owner_key = ?", asset.ID, "RESOURCE_ASSET_REVISION", slot.ID).Count(&count).Error; err != nil {
			return err
		}
		if count != 1 {
			return NotFound()
		}
		var old p.Node
		err = tx.Unscoped().First(&old, "id = ?", in.NodeID).Error
		if err == nil {
			if old.CanvasID != canvasID || old.ResourceAssetID != slot.ID || old.DeletedAt.Valid {
				return Conflict()
			}
			result, err = readGraph(tx, board)
			return err
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		config, _ := json.Marshal(c.GenerationConfig{})
		node := p.Node{ID: in.NodeID, CanvasID: canvasID, AssetID: asset.ID, ResourceID: resource.ID, ResourceAssetID: slot.ID, Type: slot.MediaType, Name: slot.Name, Revision: 1, VideoInputMode: 1, GenerationConfig: string(config), IncomingEdges: "[]"}
		if err = tx.Create(&node).Error; err != nil {
			return err
		}
		if err = tx.Create(&p.AssetReference{AssetID: asset.ID, OwnerType: "CANVAS_NODE_ASSET", OwnerKey: node.ID}).Error; err != nil {
			return err
		}
		board.Revision++
		if err = tx.Save(&board).Error; err != nil {
			return err
		}
		result, err = readGraph(tx, board)
		return err
	})
	return result, err
}
