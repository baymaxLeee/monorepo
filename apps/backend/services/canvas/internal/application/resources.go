package application

import (
	"context"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	domain "github.com/example/monorepo/canvas/internal/server/domain/resource"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strings"
	"time"
)

func resourceDTO(v p.Resource) c.Resource {
	return c.Resource{ID: v.ID, ProjectID: v.ProjectID, Type: v.Type, Name: v.Name, Description: v.Description, PrimaryResourceAssetID: v.PrimaryResourceAssetID, Revision: v.Revision, ResourceAssetCount: v.ResourceAssetCount, CreatedBy: v.CreatedBy, CreatedAt: isoTime(v.CreatedAt), UpdatedAt: isoTime(v.UpdatedAt)}
}
func (s *Service) ListResources(ctx context.Context, a Actor, projectID string) (c.ResourceList, error) {
	db := s.DB.WithContext(ctx)
	if _, err := access(db, a, projectID, false); err != nil {
		return c.ResourceList{}, err
	}
	var rows []p.Resource
	if err := db.Where("project_id = ? AND tenant_id = ? AND workspace_id = ?", projectID, a.TenantID, a.WorkspaceID).Order("created_at DESC,id").Find(&rows).Error; err != nil {
		return c.ResourceList{}, err
	}
	result := c.ResourceList{Items: []c.Resource{}}
	for _, row := range rows {
		result.Items = append(result.Items, resourceDTO(row))
	}
	return result, nil
}

func (s *Service) SearchCreativeAssets(ctx context.Context, a Actor, projectID, query string, limit int) (c.CreativeAssetList, error) {
	db := s.DB.WithContext(ctx)
	if _, e := access(db, a, projectID, false); e != nil {
		return c.CreativeAssetList{}, e
	}
	if limit < 1 || limit > 100 {
		limit = 40
	}
	out := c.CreativeAssetList{Items: []c.CreativeAsset{}}
	search := `SELECT * FROM (
 SELECT r.id AS resource_id,r.name AS resource_name,r.type AS resource_type,ra.id AS resource_asset_id,ra.current_asset_id,ra.name,ra.media_type,'' AS node_id,'' AS canvas_id
 FROM resource_assets ra JOIN resources r ON r.id=ra.resource_id JOIN assets a ON a.id=ra.current_asset_id
 WHERE r.project_id=? AND r.tenant_id=? AND r.workspace_id=? AND r.deleted_at IS NULL AND ra.deleted_at IS NULL AND a.deleted_at IS NULL AND EXISTS(SELECT 1 FROM asset_references ar WHERE ar.asset_id=a.id AND ar.owner_type='RESOURCE_ASSET_REVISION' AND ar.owner_key=ra.id AND ar.deleted_at IS NULL)
 UNION ALL
 SELECT '','',0,'',n.asset_id,n.name,CASE WHEN n.type IN (1,5) THEN 1 WHEN n.type IN (2,6) THEN 2 ELSE 3 END,n.id,n.canvas_id
 FROM canvas_nodes n JOIN canvases b ON b.id=n.canvas_id JOIN assets a ON a.id=n.asset_id
 WHERE b.project_id=? AND b.deleted_at IS NULL AND n.deleted_at IS NULL AND a.deleted_at IS NULL AND a.tenant_id=? AND a.workspace_id=? AND EXISTS(SELECT 1 FROM asset_references ar WHERE ar.asset_id=a.id AND ar.deleted_at IS NULL)
 ) candidates WHERE LOWER(name) LIKE ? OR LOWER(resource_name) LIKE ? ORDER BY name,current_asset_id,node_id LIMIT ?`
	like := "%" + strings.ToLower(strings.TrimSpace(query)) + "%"
	e := db.Raw(search, projectID, a.TenantID, a.WorkspaceID, projectID, a.TenantID, a.WorkspaceID, like, like, limit).Scan(&out.Items).Error
	return out, e
}
func (s *Service) SaveResource(ctx context.Context, a Actor, projectID, id string, in c.ResourceInput) (c.Resource, error) {
	var row p.Resource
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := access(tx, a, projectID, true); err != nil {
			return err
		}
		if id == "" {
			value, err := domain.New(domain.NewInput{ID: newID(), TenantID: a.TenantID, OwnerType: domain.OwnerProject, OwnerID: projectID, Type: domain.Type(in.Type), Name: in.Name, Description: in.Description, CreatedBy: a.UserID, Now: time.Now()})
			if err != nil {
				return Invalid(err.Error())
			}
			row = p.Resource{ID: value.ID, TenantID: a.TenantID, WorkspaceID: a.WorkspaceID, ProjectID: projectID, Type: int16(value.Type), Name: value.Name, Description: value.Description, CreatedBy: a.UserID, Revision: 1}
			return tx.Create(&row).Error
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND project_id = ?", id, projectID).First(&row).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return NotFound()
			}
			return err
		}
		if row.Revision != in.ExpectedRevision {
			return Conflict()
		}
		if row.Type != in.Type {
			return Invalid("resource type is immutable")
		}
		value := domain.Resource{ID: row.ID, Name: row.Name, Description: row.Description, Revision: row.Revision}
		if _, err := value.Update(in.Name, in.Description, in.ExpectedRevision, time.Now()); err != nil {
			return Invalid(err.Error())
		}
		row.Name = value.Name
		row.Description = value.Description
		row.Revision = value.Revision
		return tx.Save(&row).Error
	})
	return resourceDTO(row), err
}
func (s *Service) DeleteResource(ctx context.Context, a Actor, projectID, id string, in c.ExpectedRevision) (c.Deleted, error) {
	var cleanupIDs []string
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := access(tx, a, projectID, true); err != nil {
			return err
		}
		var row p.Resource
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND project_id = ?", id, projectID).First(&row).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return NotFound()
			}
			return err
		}
		if row.Revision != in.ExpectedRevision {
			return Conflict()
		}
		var reviewAssetIDs []string
		if err := tx.Model(&p.ResourceAssetRevision{}).Where(
			"resource_asset_id IN (SELECT id FROM resource_assets WHERE resource_id = ?)", id,
		).Distinct().Pluck("asset_id", &reviewAssetIDs).Error; err != nil {
			return err
		}
		var err error
		cleanupIDs, err = s.retireAssetReviews(tx, a, reviewAssetIDs, "", time.Now().UTC())
		if err != nil {
			return err
		}
		if err := tx.Where("owner_type = ? AND owner_key IN (SELECT id FROM resource_assets WHERE resource_id = ?)", "RESOURCE_ASSET_REVISION", id).Delete(&p.AssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("resource_id = ?", id).Delete(&p.ResourceAsset{}).Error; err != nil {
			return err
		}
		return tx.Delete(&row).Error
	})
	if err == nil {
		s.processAssetReviewCleanups(context.WithoutCancel(ctx), cleanupIDs)
	}
	return c.Deleted{Deleted: err == nil}, err
}
func (s *Service) ListResourceAssets(ctx context.Context, a Actor, projectID, id string) (c.ResourceAssetList, error) {
	db := s.DB.WithContext(ctx)
	if _, err := access(db, a, projectID, false); err != nil {
		return c.ResourceAssetList{}, err
	}
	var resource p.Resource
	if err := db.Where("id = ? AND project_id = ?", id, projectID).First(&resource).Error; err != nil {
		return c.ResourceAssetList{}, NotFound()
	}
	type resourceAssetRow struct {
		p.ResourceAsset `gorm:"embedded"`
		ArtifactID      string `gorm:"column:artifact_id"`
		MimeType        string `gorm:"column:mime_type"`
	}
	var rows []resourceAssetRow
	if err := db.Model(&p.ResourceAsset{}).Select("resource_assets.*, assets.artifact_id, assets.mime_type").Joins(
		"LEFT JOIN assets ON assets.id = resource_assets.current_asset_id AND assets.deleted_at IS NULL",
	).Where("resource_assets.resource_id = ?", id).Order("resource_assets.sequence_no,resource_assets.id").Scan(&rows).Error; err != nil {
		return c.ResourceAssetList{}, err
	}
	namespace := storage.Scope(a.TenantID, a.WorkspaceID, projectID)
	artifacts := make([]storage.Artifact, 0, len(rows))
	for _, row := range rows {
		if row.ArtifactID != "" {
			artifacts = append(artifacts, storage.Artifact{Namespace: namespace, ID: row.ArtifactID, ContentType: row.MimeType})
		}
	}
	urls, _ := s.Storage.BatchPublicURLs(ctx, artifacts)
	result := c.ResourceAssetList{Items: []c.ResourceAsset{}}
	for _, row := range rows {
		item := resourceAssetDTO(row.ResourceAsset)
		if signed, ok := urls[storage.ArtifactLookupKey(namespace, row.ArtifactID)]; ok {
			item.PreviewURL, item.ExpiresAt = signed.URL, signed.ExpiresAt
		}
		result.Items = append(result.Items, item)
	}
	return result, nil
}
