package agent

import (
	"context"
	"errors"
	"time"
)

var (
	ErrAgentNotFound  = errors.New("personal Agent not found")
	ErrAgentLeaseLost = errors.New("personal Agent provisioning lease was lost")
)

type AgentStatus string

const (
	AgentStatusProvisioning AgentStatus = "provisioning"
	AgentStatusReady        AgentStatus = "ready"
	AgentStatusFailed       AgentStatus = "failed"
)

type SyncedSkill struct {
	Key         string
	Name        string
	ContentHash string
	AssetID     string
	VersionID   string
	Version     string
}

type AgentScope struct {
	TenantID    string
	UserID      string
	WorkspaceID string
}

type AgentSpec struct {
	SkillVersionIDs []string
	SystemPrompt    string
	PromptVersion   string
}

type SkillPublisher interface {
	Publish(context.Context, LocalSkill) (SyncedSkill, error)
}

type AgentRuntime interface {
	FindEnvironment(context.Context, AgentScope) (string, bool, error)
	CreateEnvironment(context.Context, AgentScope) (string, error)
	DeleteEnvironment(context.Context, AgentScope, string) error
	FindAgent(context.Context, AgentScope) (string, string, bool, error)
	CreateAgent(context.Context, AgentScope, string, AgentSpec) (string, error)
	UpdateAgent(context.Context, AgentScope, string, AgentSpec) error
	DeleteAgent(context.Context, AgentScope, string) error
}

type PersonalAgent struct {
	TenantID             string
	UserID               string
	WorkspaceID          string
	EnvironmentID        string
	AgentID              string
	Status               AgentStatus
	ProvisioningToken    string
	BoundSkillVersionIDs []string
	PromptVersion        string
	LastError            string
	UpdatedAt            time.Time
}

type Store interface {
	SaveSkill(context.Context, SyncedSkill) error
	ReplaceSkills(context.Context, []SyncedSkill) error
	ListSkills(context.Context) ([]SyncedSkill, error)
	GetAgent(context.Context, string, string) (PersonalAgent, error)
	ClaimAgent(context.Context, PersonalAgent, time.Time, time.Time) (PersonalAgent, bool, error)
	SaveProvisioningEnvironment(context.Context, PersonalAgent) error
	SaveReadyAgent(context.Context, PersonalAgent) error
	FailProvisioning(context.Context, PersonalAgent, error) error
	SaveAgentError(context.Context, string, string, error) error
	SaveAgentConfiguration(context.Context, string, string, []string, string) error
	DeleteByTenant(context.Context, string) error
	DeleteByWorkspace(context.Context, string, string) error
}
