package application

import (
	"context"
	"encoding/json"
	"fmt"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	repo "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/resourceassetgeneration"
	image "github.com/example/monorepo/canvas/internal/server/domain/imagegeneration"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strings"
)

func (s *Service) StartResourceGeneration(ctx context.Context, a Actor, projectID, id string, in c.StartGeneration) (c.Generation, error) {
	var row p.ResourceGeneration
	if strings.TrimSpace(in.OperationID) == "" || len(in.OperationID) > 160 {
		return c.Generation{}, Invalid("operation id is required")
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		d, err := loadResourceDraft(ctx, tx, a, projectID, id, true)
		if err != nil {
			return err
		}
		err = tx.Where("resource_asset_id = ? AND user_id = ? AND operation_id = ?", id, a.UserID, in.OperationID).First(&row).Error
		if err == nil {
			if row.NodeRevision != in.ExpectedRevision {
				return Conflict()
			}
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		if d.Revision != in.ExpectedRevision || d.ActiveTaskRunID != "" {
			return Conflict()
		}
		if !d.Ready() {
			return Invalid("请填写提示词、模型、分辨率和画幅")
		}
		admission, err := s.admitGeneration(ctx, tx, a, projectID, d.Config.ModelID, "image", 0)
		if err != nil {
			return err
		}
		refs, err := resolveResourceImageReferences(tx, a, projectID, d)
		if err != nil {
			return err
		}
		width, height, err := image.Dimensions(d.Config.Resolution, d.Config.AspectRatio)
		if err != nil {
			return Invalid("分辨率或画幅无效")
		}
		payload, err := json.Marshal(map[string]any{"tenantId": a.TenantID, "workspaceId": a.WorkspaceID, "providerId": d.Config.ModelID, "prompt": d.Config.Prompt, "artifactNamespace": storage.Scope(a.TenantID, a.WorkspaceID, projectID), "artifactIds": refs, "size": fmt.Sprintf("%dx%d", width, height), "aspectRatio": string(d.Config.AspectRatio), "watermark": d.Config.Watermark})
		if err != nil {
			return err
		}
		row = p.ResourceGeneration{ProjectID: projectID, ResourceID: d.ResourceID, ResourceAssetID: id, Generation: p.Generation{ID: newID(), TenantID: a.TenantID, WorkspaceID: a.WorkspaceID, UserID: a.UserID, OperationID: in.OperationID, NodeRevision: d.Revision, ProviderID: d.Config.ModelID, Prompt: d.Config.Prompt, Status: "queued", TaskType: "canvas-image-generation", InputPayload: string(payload), ReservedAmountMicros: admission.AmountMicros}}
		if err = tx.Create(&row).Error; err != nil {
			return err
		}
		admission.Metadata.GenerationID = row.ID
		if err := tx.Create(&admission.Metadata).Error; err != nil {
			return err
		}
		ok, err := repo.NewRepository(tx).SetActiveTaskRun(ctx, draftScope(a), id, row.ID)
		if err != nil {
			return err
		}
		if !ok {
			return Conflict()
		}
		return nil
	})
	return generationDTO(row.Generation), err
}
func (s *Service) ListResourceGenerationRuns(ctx context.Context, a Actor, projectID, id string) (c.GenerationList, error) {
	db := s.DB.WithContext(ctx)
	if _, _, err := resourceSlot(db, a, projectID, id, false); err != nil {
		return c.GenerationList{}, err
	}
	var rows []p.ResourceGeneration
	if err := db.Where("project_id = ? AND resource_asset_id = ? AND tenant_id = ? AND workspace_id = ?", projectID, id, a.TenantID, a.WorkspaceID).Order("created_at DESC,id").Find(&rows).Error; err != nil {
		return c.GenerationList{}, err
	}
	out := c.GenerationList{Items: []c.Generation{}}
	for _, r := range rows {
		out.Items = append(out.Items, generationDTO(r.Generation))
	}
	return out, nil
}
func (s *Service) CancelResourceGeneration(ctx context.Context, a Actor, projectID, id, runID string) (c.Generation, error) {
	var row p.ResourceGeneration
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, _, err := resourceSlot(tx, a, projectID, id, true); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND project_id = ? AND resource_asset_id = ?", runID, projectID, id).First(&row).Error; err != nil {
			return NotFound()
		}
		if row.Status != "queued" && row.Status != "running" {
			return nil
		}
		row.CancelRequested = true
		return tx.Save(&row).Error
	})
	if err == nil && row.CancelRequested && row.TaskID != "" {
		_, err = s.Executor.Cancel(ctx, row.TaskID, row.ID)
	}
	return generationDTO(row.Generation), err
}
