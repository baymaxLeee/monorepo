package application

import (
	"context"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	domain "github.com/example/monorepo/canvas/internal/domain/resource"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

func resourceDTO(v p.Resource) c.Resource {
	return c.Resource{ID: v.ID, ProjectID: v.ProjectID, Type: v.Type, Name: v.Name, Description: v.Description, PrimaryResourceAssetID: v.PrimaryResourceAssetID, Revision: v.Revision, ResourceAssetCount: v.ResourceAssetCount}
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
		if err := tx.Where("owner_type = ? AND owner_key IN (SELECT id FROM resource_assets WHERE resource_id = ?)", "RESOURCE_ASSET_REVISION", id).Delete(&p.AssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("resource_id = ?", id).Delete(&p.ResourceAsset{}).Error; err != nil {
			return err
		}
		return tx.Delete(&row).Error
	})
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
	var rows []p.ResourceAsset
	if err := db.Where("resource_id = ?", id).Order("sequence_no,id").Find(&rows).Error; err != nil {
		return c.ResourceAssetList{}, err
	}
	result := c.ResourceAssetList{Items: []c.ResourceAsset{}}
	for _, row := range rows {
		result.Items = append(result.Items, c.ResourceAsset{ID: row.ID, Name: row.Name, MediaType: row.MediaType, Revision: row.Revision})
	}
	return result, nil
}
