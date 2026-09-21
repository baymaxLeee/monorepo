package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sort"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	scopelifecycle "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/scopelifecycle"
	application "github.com/example/monorepo/canvas/internal/server/application/agent"
)

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) SaveSkill(ctx context.Context, skill application.SyncedSkill) error {
	model := skillModel{
		Key: skill.Key, Name: skill.Name, ContentHash: skill.ContentHash,
		AssetID: skill.AssetID, VersionID: skill.VersionID, Version: skill.Version,
	}
	if err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "skill_key"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"name", "content_hash", "asset_center_skill_id", "version_id", "version", "updated_at",
		}),
	}).Create(&model).Error; err != nil {
		return fmt.Errorf("save Agent skill %q: %w", skill.Key, err)
	}
	return nil
}

func (r *Repository) ListSkills(ctx context.Context) ([]application.SyncedSkill, error) {
	var models []skillModel
	if err := r.db.WithContext(ctx).Order("skill_key ASC").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("list Agent skills: %w", err)
	}
	result := make([]application.SyncedSkill, 0, len(models))
	for _, model := range models {
		result = append(result, application.SyncedSkill{
			Key: model.Key, Name: model.Name, ContentHash: model.ContentHash,
			AssetID: model.AssetID, VersionID: model.VersionID, Version: model.Version,
		})
	}
	return result, nil
}

func (r *Repository) ReplaceSkills(ctx context.Context, skills []application.SyncedSkill) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		txRepository := NewRepository(tx)
		keys := make([]string, 0, len(skills))
		for _, item := range skills {
			if err := txRepository.SaveSkill(ctx, item); err != nil {
				return err
			}
			keys = append(keys, item.Key)
		}
		query := tx.WithContext(ctx).Where("1 = 1")
		if len(keys) > 0 {
			query = query.Where("skill_key NOT IN ?", keys)
		}
		if err := query.Delete(&skillModel{}).Error; err != nil {
			return fmt.Errorf("remove absent Agent skills: %w", err)
		}
		return nil
	})
}

func (r *Repository) GetAgent(ctx context.Context, tenantID, userID string) (application.PersonalAgent, error) {
	var model agentModel
	if err := r.db.WithContext(ctx).Where("tenant_id = ? AND user_id = ?", tenantID, userID).First(&model).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return application.PersonalAgent{}, application.ErrAgentNotFound
		}
		return application.PersonalAgent{}, err
	}
	return toPersonalAgent(model), nil
}

func (r *Repository) ClaimAgent(
	ctx context.Context,
	agent application.PersonalAgent,
	now time.Time,
	staleBefore time.Time,
) (application.PersonalAgent, bool, error) {
	var stored application.PersonalAgent
	var claimed bool
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var workspace *string
		if agent.WorkspaceID != "" {
			workspace = &agent.WorkspaceID
		}
		if err := scopelifecycle.LockActive(tx, agent.TenantID, workspace); err != nil {
			return err
		}
		var err error
		stored, claimed, err = (&Repository{db: tx}).claimAgent(ctx, agent, now, staleBefore)
		return err
	})
	return stored, claimed, err
}

func (r *Repository) claimAgent(ctx context.Context, agent application.PersonalAgent, now, staleBefore time.Time) (application.PersonalAgent, bool, error) {
	model := agentModel{
		TenantID: agent.TenantID, UserID: agent.UserID, WorkspaceID: agent.WorkspaceID,
		Status: string(application.AgentStatusProvisioning), ProvisioningToken: agent.ProvisioningToken,
		CreatedAt: now, UpdatedAt: now,
	}
	created := r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&model)
	if created.Error != nil {
		return application.PersonalAgent{}, false, fmt.Errorf("claim personal Agent: %w", created.Error)
	}
	if created.RowsAffected == 1 {
		return toPersonalAgent(model), true, nil
	}

	result := r.db.WithContext(ctx).Model(&agentModel{}).
		Where("tenant_id = ? AND user_id = ?", agent.TenantID, agent.UserID).
		Where("status = ? OR (status = ? AND updated_at < ?)",
			application.AgentStatusFailed, application.AgentStatusProvisioning, staleBefore).
		Updates(map[string]any{
			"workspace_id": agent.WorkspaceID, "status": application.AgentStatusProvisioning,
			"provisioning_token": agent.ProvisioningToken, "last_error": "", "updated_at": now,
		})
	if result.Error != nil {
		return application.PersonalAgent{}, false, fmt.Errorf("reclaim personal Agent: %w", result.Error)
	}
	stored, getErr := r.GetAgent(ctx, agent.TenantID, agent.UserID)
	if getErr != nil {
		return application.PersonalAgent{}, false, getErr
	}
	return stored, result.RowsAffected == 1, nil
}

func (r *Repository) SaveProvisioningEnvironment(ctx context.Context, agent application.PersonalAgent) error {
	result := r.db.WithContext(ctx).Model(&agentModel{}).
		Where("tenant_id = ? AND user_id = ? AND status = ? AND provisioning_token = ?",
			agent.TenantID, agent.UserID, application.AgentStatusProvisioning, agent.ProvisioningToken).
		Updates(map[string]any{"environment_id": agent.EnvironmentID})
	if result.Error != nil {
		return fmt.Errorf("checkpoint personal Agent environment: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return application.ErrAgentLeaseLost
	}
	return nil
}

func (r *Repository) SaveReadyAgent(ctx context.Context, agent application.PersonalAgent) error {
	versions := sortedCopy(agent.BoundSkillVersionIDs)
	encodedVersions, err := json.Marshal(versions)
	if err != nil {
		return fmt.Errorf("encode personal Agent bindings: %w", err)
	}
	result := r.db.WithContext(ctx).Model(&agentModel{}).
		Where("tenant_id = ? AND user_id = ? AND status = ? AND provisioning_token = ?",
			agent.TenantID, agent.UserID, application.AgentStatusProvisioning, agent.ProvisioningToken).
		Updates(map[string]any{
			"workspace_id": agent.WorkspaceID, "environment_id": agent.EnvironmentID,
			"agent_id": agent.AgentID, "status": application.AgentStatusReady,
			"bound_skill_version_ids": string(encodedVersions), "last_error": "", "provisioning_token": "",
			"prompt_version": agent.PromptVersion,
		})
	if result.Error != nil {
		return fmt.Errorf("save ready personal Agent: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return application.ErrAgentLeaseLost
	}
	return nil
}

func (r *Repository) FailProvisioning(ctx context.Context, agent application.PersonalAgent, failure error) error {
	message := ""
	if failure != nil {
		message = failure.Error()
	}
	result := r.db.WithContext(ctx).Model(&agentModel{}).
		Where("tenant_id = ? AND user_id = ? AND status = ? AND provisioning_token = ?",
			agent.TenantID, agent.UserID, application.AgentStatusProvisioning, agent.ProvisioningToken).
		Updates(map[string]any{
			"status": application.AgentStatusFailed, "last_error": message,
			"environment_id": agent.EnvironmentID, "agent_id": agent.AgentID,
		})
	if result.Error != nil {
		return fmt.Errorf("fail personal Agent provisioning: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return application.ErrAgentLeaseLost
	}
	return nil
}

func (r *Repository) SaveAgentError(ctx context.Context, tenantID, userID string, failure error) error {
	message := ""
	if failure != nil {
		message = failure.Error()
	}
	return r.db.WithContext(ctx).Model(&agentModel{}).
		Where("tenant_id = ? AND user_id = ? AND status = ?", tenantID, userID, application.AgentStatusReady).
		Update("last_error", message).Error
}

func (r *Repository) SaveAgentConfiguration(ctx context.Context, tenantID, userID string, versionIDs []string, promptVersion string) error {
	encodedVersions, err := json.Marshal(sortedCopy(versionIDs))
	if err != nil {
		return fmt.Errorf("encode personal Agent bindings: %w", err)
	}
	result := r.db.WithContext(ctx).Model(&agentModel{}).
		Where("tenant_id = ? AND user_id = ? AND status = ?", tenantID, userID, application.AgentStatusReady).
		Updates(map[string]any{
			"bound_skill_version_ids": string(encodedVersions), "last_error": "",
			"prompt_version": promptVersion, "status": application.AgentStatusReady,
		})
	if result.Error != nil {
		return fmt.Errorf("save personal Agent configuration: %w", result.Error)
	}
	if result.RowsAffected == 1 {
		return nil
	}
	// MySQL reports zero changed rows when another replica has already stored
	// this exact target. Treat that idempotent convergence as success, while a
	// missing Agent or a different current configuration remains an error.
	stored, err := r.GetAgent(ctx, tenantID, userID)
	if err != nil {
		return err
	}
	if stored.Status == application.AgentStatusReady &&
		slices.Equal(sortedCopy(stored.BoundSkillVersionIDs), sortedCopy(versionIDs)) &&
		stored.PromptVersion == promptVersion {
		return nil
	}
	return gorm.ErrRecordNotFound
}

func (r *Repository) DeleteByTenant(ctx context.Context, tenantID string) error {
	if err := r.db.WithContext(ctx).Where("tenant_id = ?", tenantID).Delete(&agentModel{}).Error; err != nil {
		return fmt.Errorf("delete tenant personal Agents: %w", err)
	}
	return nil
}

func (r *Repository) DeleteByWorkspace(ctx context.Context, tenantID, workspaceID string) error {
	if err := r.db.WithContext(ctx).
		Where("tenant_id = ? AND workspace_id = ?", tenantID, workspaceID).
		Delete(&agentModel{}).Error; err != nil {
		return fmt.Errorf("delete workspace personal Agents: %w", err)
	}
	return nil
}

func toPersonalAgent(model agentModel) application.PersonalAgent {
	return application.PersonalAgent{
		TenantID: model.TenantID, UserID: model.UserID, WorkspaceID: model.WorkspaceID,
		EnvironmentID: model.EnvironmentID, AgentID: model.AgentID,
		Status:               application.AgentStatus(model.Status),
		ProvisioningToken:    model.ProvisioningToken,
		BoundSkillVersionIDs: sortedCopy(model.BoundSkillVersionIDs),
		PromptVersion:        model.PromptVersion,
		LastError:            model.LastError, UpdatedAt: model.UpdatedAt,
	}
}

func sortedCopy(values []string) []string {
	result := append([]string(nil), values...)
	sort.Strings(result)
	return result
}
