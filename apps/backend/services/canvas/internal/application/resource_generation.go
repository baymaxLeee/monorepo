package application

import (
	"context"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	repo "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/resourceassetgeneration"
	draftapp "github.com/example/monorepo/canvas/internal/server/application/resourceassetgeneration"
	image "github.com/example/monorepo/canvas/internal/server/domain/imagegeneration"
	resource "github.com/example/monorepo/canvas/internal/server/domain/resource"
	draft "github.com/example/monorepo/canvas/internal/server/domain/resourceassetgeneration"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

func draftScope(a Actor) draftapp.DraftScope {
	return draftapp.DraftScope{TenantID: a.TenantID, WorkspaceID: &a.WorkspaceID, CallerID: a.UserID}
}
func resourceDraftDTO(d draft.Draft) c.ResourceGenerationDraft {
	uploaded := make([]string, 0, len(d.UploadedReferences))
	for _, v := range d.UploadedReferences {
		uploaded = append(uploaded, v.AssetID)
	}
	refs := make([]int64, 0, len(d.ResourceReferences))
	for _, v := range d.ResourceReferences {
		refs = append(refs, v.SequenceNo)
	}
	return c.ResourceGenerationDraft{Revision: d.Revision, ActiveRunID: d.ActiveTaskRunID, Config: c.ResourceGenerationConfig{Prompt: d.Config.Prompt, ProviderID: d.Config.ModelID, Resolution: string(d.Config.Resolution), AspectRatio: string(d.Config.AspectRatio), Watermark: d.Config.Watermark, UploadedAssetIDs: uploaded, ReferenceSequences: refs}}
}
func (s *Service) CreateGeneratedResourceAsset(ctx context.Context, a Actor, projectID, resourceID string, in c.ExpectedRevision) (c.ResourceAsset, error) {
	var slot p.ResourceAsset
	defaultProviderID, err := s.ResolveDefaultProvider(ctx, a, "image")
	if err != nil {
		return c.ResourceAsset{}, err
	}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := access(tx, a, projectID, true); err != nil {
			return err
		}
		var r p.Resource
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND project_id = ?", resourceID, projectID).First(&r).Error; err != nil {
			return NotFound()
		}
		if r.Revision != in.ExpectedRevision {
			return Conflict()
		}
		if r.Type == 4 || r.ResourceAssetCount >= resource.Type(r.Type).ResourceAssetLimit() {
			return Invalid("该资源无法添加生成素材")
		}
		var seq int64
		if err := tx.Unscoped().Model(&p.ResourceAsset{}).Where("resource_id = ?", resourceID).Select("COALESCE(MAX(sequence_no),0)").Scan(&seq).Error; err != nil {
			return err
		}
		id := newID()
		value, err := resource.NewGeneratedResourceAsset(resource.NewGeneratedResourceAssetInput{ID: id, ResourceID: resourceID, ResourceName: r.Name, SequenceNo: seq + 1, ImageGenerationDraftID: id, Now: time.Now()})
		if err != nil {
			return Invalid("生成素材配置无效")
		}
		slot = p.ResourceAsset{ID: id, ResourceID: resourceID, Name: value.Name, SequenceNo: value.SequenceNo, SourceType: int16(value.SourceType), MediaType: 1, Revision: 1}
		d, err := draft.NewDraft(draft.NewDraftInput{ID: id, TenantID: a.TenantID, WorkspaceID: &a.WorkspaceID, ResourceID: resourceID, ResourceAssetID: id, CreatedBy: a.UserID, Now: time.Now()})
		if err != nil {
			return err
		}
		if defaultProviderID != "" {
			resolution, ratio := image.Resolution1080P, image.AspectRatio1x1
			if _, err = d.Update(draft.DraftPatch{Config: image.ConfigPatch{ModelID: &defaultProviderID, Resolution: &resolution, AspectRatio: &ratio}}, d.Revision, time.Now()); err != nil {
				return err
			}
		}
		if err = repo.NewRepository(tx).Create(ctx, d); err != nil {
			return err
		}
		if err = tx.Create(&slot).Error; err != nil {
			return err
		}
		if r.PrimaryResourceAssetID == "" {
			r.PrimaryResourceAssetID = id
		}
		r.Revision++
		r.ResourceAssetCount++
		return tx.Save(&r).Error
	})
	return s.signedResourceAssetDTO(ctx, a, projectID, slot), err
}
func loadResourceDraft(ctx context.Context, tx *gorm.DB, a Actor, projectID, id string, write bool) (draft.Draft, error) {
	_, slot, err := resourceSlot(tx, a, projectID, id, write)
	if err != nil {
		return draft.Draft{}, err
	}
	if slot.SourceType != int16(resource.SourceGenerated) {
		return draft.Draft{}, Invalid("请选择生成型素材")
	}
	repository := repo.NewRepository(tx)
	if write {
		return repository.GetForUpdate(ctx, draftScope(a), id)
	}
	return repository.Get(ctx, draftScope(a), id)
}
func (s *Service) GetResourceGeneration(ctx context.Context, a Actor, projectID, id string) (c.ResourceGenerationDraft, error) {
	d, err := loadResourceDraft(ctx, s.DB.WithContext(ctx), a, projectID, id, false)
	return resourceDraftDTO(d), err
}
func (s *Service) UpdateResourceGeneration(ctx context.Context, a Actor, projectID, id string, in c.UpdateResourceGeneration) (c.ResourceGenerationDraft, error) {
	var d draft.Draft
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		d, err = loadResourceDraft(ctx, tx, a, projectID, id, true)
		if err != nil {
			return err
		}
		if d.Revision != in.ExpectedRevision {
			return Conflict()
		}
		resolution, ratio := image.Resolution(in.Config.Resolution), image.AspectRatio(in.Config.AspectRatio)
		uploaded := make([]draft.UploadedReference, 0, len(in.Config.UploadedAssetIDs))
		for _, assetID := range in.Config.UploadedAssetIDs {
			uploaded = append(uploaded, draft.UploadedReference{AssetID: assetID})
		}
		references := make([]draft.ResourceReference, 0, len(in.Config.ReferenceSequences))
		for _, seq := range in.Config.ReferenceSequences {
			references = append(references, draft.ResourceReference{ResourceID: d.ResourceID, SequenceNo: seq})
		}
		changed, err := d.Update(draft.DraftPatch{Config: image.ConfigPatch{Prompt: &in.Config.Prompt, ModelID: &in.Config.ProviderID, Resolution: &resolution, AspectRatio: &ratio, Watermark: &in.Config.Watermark}, UploadedReferences: &uploaded, ResourceReferences: &references}, in.ExpectedRevision, time.Now())
		if err != nil {
			return Invalid("生成参数或参考素材无效")
		}
		if !changed {
			return nil
		}
		if _, err = resolveResourceImageReferences(tx, a, projectID, d); err != nil {
			return err
		}
		_, err = repo.NewRepository(tx).Update(ctx, d, in.ExpectedRevision)
		return err
	})
	return resourceDraftDTO(d), err
}
func resolveResourceImageReferences(tx *gorm.DB, a Actor, projectID string, d draft.Draft) ([]string, error) {
	keys := make([]string, 0, len(d.UploadedReferences)+len(d.ResourceReferences))
	for _, ref := range d.UploadedReferences {
		var asset p.Asset
		if err := tx.Where("id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND mime_type LIKE 'image/%' AND EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id AND owner_type = 'PROJECT_ASSET' AND deleted_at IS NULL)", ref.AssetID, a.TenantID, a.WorkspaceID, projectID).First(&asset).Error; err != nil {
			return nil, Invalid("上传的参考素材尚无可用图片")
		}
		keys = append(keys, asset.ArtifactID)
	}
	for _, ref := range d.ResourceReferences {
		var slot p.ResourceAsset
		if err := tx.Where("resource_id = ? AND sequence_no = ?", ref.ResourceID, ref.SequenceNo).First(&slot).Error; err != nil {
			return nil, Invalid("参考素材不存在")
		}
		var asset p.Asset
		if err := tx.Where("id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND mime_type LIKE 'image/%' AND EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id AND owner_type = 'RESOURCE_ASSET_REVISION' AND owner_key = ? AND deleted_at IS NULL)", slot.CurrentAssetID, a.TenantID, a.WorkspaceID, projectID, slot.ID).First(&asset).Error; err != nil {
			return nil, Invalid("参考素材尚无可用图片")
		}
		keys = append(keys, asset.ArtifactID)
	}
	return keys, nil
}
