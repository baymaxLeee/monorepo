package agent

import "time"

type presetSkillModel struct {
	SkillKey           string    `gorm:"column:skill_key;type:varchar(128);primaryKey"`
	AssetCenterSkillID string    `gorm:"column:asset_center_skill_id;type:varchar(255);not null;uniqueIndex"`
	Name               string    `gorm:"column:name;type:varchar(255);not null"`
	DefaultBound       bool      `gorm:"column:default_bound;not null"`
	State              string    `gorm:"column:state;type:varchar(16);not null"`
	CreatedAt          time.Time `gorm:"not null"`
	UpdatedAt          time.Time `gorm:"not null"`
}

func (presetSkillModel) TableName() string { return "preset_skills" }

type tenantAgentModel struct {
	TenantID        string    `gorm:"column:tenant_id;type:varchar(191);primaryKey"`
	ProductCode     string    `gorm:"column:product_code;type:varchar(64);primaryKey"`
	WorkspaceID     string    `gorm:"column:workspace_id;type:varchar(255);not null"`
	AgentID         string    `gorm:"column:agent_id;type:varchar(255);not null;uniqueIndex"`
	CreatedByUserID string    `gorm:"column:created_by_user_id;type:varchar(191);not null"`
	BindingDigest   string    `gorm:"column:binding_digest;type:char(64);not null"`
	PromptVersion   string    `gorm:"column:prompt_version;type:char(64);not null"`
	CreatedAt       time.Time `gorm:"not null"`
	UpdatedAt       time.Time `gorm:"not null"`
}

func (tenantAgentModel) TableName() string { return "tenant_hibot_agents" }

func Models() []any { return []any{&presetSkillModel{}, &tenantAgentModel{}} }
