package agent

import "time"

type skillModel struct {
	Key         string `gorm:"column:skill_key;type:varchar(191);primaryKey"`
	Name        string `gorm:"column:name;type:varchar(255);not null"`
	ContentHash string `gorm:"column:content_hash;type:char(64);not null"`
	AssetID     string `gorm:"column:asset_center_skill_id;type:varchar(255);not null"`
	VersionID   string `gorm:"column:version_id;type:varchar(255);not null"`
	Version     string `gorm:"column:version;type:varchar(255);not null"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (skillModel) TableName() string { return "agent_skills" }

type agentModel struct {
	TenantID             string   `gorm:"column:tenant_id;type:varchar(191);primaryKey"`
	UserID               string   `gorm:"column:user_id;type:varchar(191);primaryKey"`
	WorkspaceID          string   `gorm:"column:workspace_id;type:varchar(255);not null"`
	EnvironmentID        string   `gorm:"column:environment_id;type:varchar(255);not null;default:''"`
	AgentID              string   `gorm:"column:agent_id;type:varchar(255);not null;default:''"`
	Status               string   `gorm:"column:status;type:varchar(32);not null"`
	ProvisioningToken    string   `gorm:"column:provisioning_token;type:varchar(64);not null;default:''"`
	BoundSkillVersionIDs []string `gorm:"column:bound_skill_version_ids;type:text;serializer:json"`
	PromptVersion        string   `gorm:"column:prompt_version;type:char(64);not null;default:''"`
	LastError            string   `gorm:"column:last_error;type:text;not null"`
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

func (agentModel) TableName() string { return "personal_agents" }

func Models() []any { return []any{&skillModel{}, &agentModel{}} }
