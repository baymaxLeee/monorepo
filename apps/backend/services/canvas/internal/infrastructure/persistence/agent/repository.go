package agent

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	application "github.com/example/monorepo/canvas/internal/application/agent"
)

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) UpsertPresetSkill(ctx context.Context, skill application.PresetSkill) error {
	model := presetSkillModel{
		SkillKey: skill.Key, AssetCenterSkillID: skill.AssetCenterSkillID, Name: skill.Name,
		DefaultBound: skill.DefaultBound, State: string(skill.State),
	}
	if err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "skill_key"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"asset_center_skill_id", "name", "default_bound", "state", "updated_at",
		}),
	}).Create(&model).Error; err != nil {
		return fmt.Errorf("upsert preset skill %q: %w", skill.Key, err)
	}
	return nil
}

func (r *Repository) ListDefaultPresetSkills(ctx context.Context) ([]application.PresetSkill, error) {
	var models []presetSkillModel
	if err := r.db.WithContext(ctx).
		Where("state = ? AND default_bound = ?", application.PresetSkillActive, true).
		Order("skill_key ASC").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("list default preset skills: %w", err)
	}
	result := make([]application.PresetSkill, 0, len(models))
	for _, model := range models {
		result = append(result, application.PresetSkill{
			Key: model.SkillKey, AssetCenterSkillID: model.AssetCenterSkillID, Name: model.Name,
			DefaultBound: model.DefaultBound, State: application.PresetSkillState(model.State),
		})
	}
	return result, nil
}

func (r *Repository) GetTenantAgent(ctx context.Context, tenantID, productCode string) (application.TenantAgent, error) {
	var model tenantAgentModel
	if err := r.db.WithContext(ctx).
		Where("tenant_id = ? AND product_code = ?", tenantID, productCode).
		First(&model).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return application.TenantAgent{}, application.ErrTenantAgentNotFound
		}
		return application.TenantAgent{}, fmt.Errorf("get tenant Hibot Agent: %w", err)
	}
	return application.TenantAgent{
		TenantID: model.TenantID, ProductCode: model.ProductCode, WorkspaceID: model.WorkspaceID,
		AgentID: model.AgentID, CreatedByUserID: model.CreatedByUserID,
		BindingDigest: model.BindingDigest, PromptVersion: model.PromptVersion,
	}, nil
}

func (r *Repository) UpsertTenantAgent(ctx context.Context, agent application.TenantAgent) error {
	model := tenantAgentModel{
		TenantID: agent.TenantID, ProductCode: agent.ProductCode, WorkspaceID: agent.WorkspaceID,
		AgentID: agent.AgentID, CreatedByUserID: agent.CreatedByUserID,
		BindingDigest: agent.BindingDigest, PromptVersion: agent.PromptVersion,
	}
	if err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "tenant_id"}, {Name: "product_code"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"workspace_id", "agent_id", "created_by_user_id", "binding_digest", "prompt_version", "updated_at",
		}),
	}).Create(&model).Error; err != nil {
		return fmt.Errorf("upsert tenant Hibot Agent: %w", err)
	}
	return nil
}

func (r *Repository) DeleteTenantAgent(ctx context.Context, tenantID, productCode, agentID string) error {
	result := r.db.WithContext(ctx).Where(
		"tenant_id = ? AND product_code = ? AND agent_id = ?", tenantID, productCode, agentID,
	).Delete(&tenantAgentModel{})
	if result.Error != nil {
		return fmt.Errorf("delete tenant Hibot Agent mapping: %w", result.Error)
	}
	return nil
}
