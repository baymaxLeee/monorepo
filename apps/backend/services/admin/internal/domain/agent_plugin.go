package domain

import (
	"encoding/json"
	"time"
)

type AgentPluginSourceKind string

const (
	AgentPluginSourceSystem      AgentPluginSourceKind = "system"
	AgentPluginSourceExternalMCP AgentPluginSourceKind = "external-mcp"
)

type AgentPluginTrustLevel string

const (
	AgentPluginTrustSystem     AgentPluginTrustLevel = "system"
	AgentPluginTrustVerified   AgentPluginTrustLevel = "verified"
	AgentPluginTrustUnverified AgentPluginTrustLevel = "unverified"
)

type AgentPluginInstallPolicy string

const (
	AgentPluginAvailable          AgentPluginInstallPolicy = "available"
	AgentPluginInstalledByDefault AgentPluginInstallPolicy = "installed-by-default"
	AgentPluginNotAvailable       AgentPluginInstallPolicy = "not-available"
)

type AgentPluginToolPolicy struct {
	Capability         string                 `json:"capability"`
	CallableByCodeMode bool                   `json:"callableByCodeMode,omitempty"`
	Effect             string                 `json:"effect"`
	Trust              string                 `json:"trust"`
	Execution          string                 `json:"execution"`
	SourceProjection   map[string]interface{} `json:"sourceProjection,omitempty"`
	Streaming          bool                   `json:"streaming,omitempty"`
	UIKind             string                 `json:"uiKind,omitempty"`
}

type AgentPluginToolPlanning struct {
	Summary        string   `json:"summary"`
	Constraints    []string `json:"constraints,omitempty"`
	Prerequisites  []string `json:"prerequisites,omitempty"`
	Parallelizable bool     `json:"parallelizable,omitempty"`
}

type AgentPluginMCPTool struct {
	Name         string                  `json:"name"`
	Description  string                  `json:"description"`
	InputSchema  json.RawMessage         `json:"inputSchema"`
	OutputSchema json.RawMessage         `json:"outputSchema,omitempty"`
	Policy       AgentPluginToolPolicy   `json:"policy"`
	Planning     AgentPluginToolPlanning `json:"planning"`
}

// Header mappings are release policy, not renderer input. Values are keys into the
// activation, installation config or encrypted installation secret maps respectively.
type AgentPluginMCPServer struct {
	Name             string               `json:"name"`
	URL              string               `json:"url"`
	RequiredBindings []string             `json:"requiredBindings,omitempty"`
	OptionalBindings []string             `json:"optionalBindings,omitempty"`
	BindingHeaders   map[string]string    `json:"bindingHeaders,omitempty"`
	ConfigHeaders    map[string]string    `json:"configHeaders,omitempty"`
	SecretHeaders    map[string]string    `json:"secretHeaders,omitempty"`
	Tools            []AgentPluginMCPTool `json:"tools"`
}

type AgentPluginSkill struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	AssetID     string `json:"assetId"`
	RevisionID  string `json:"revisionId"`
	SHA256      string `json:"sha256"`
}

// AgentPluginManifest is an immutable release. Digest is sha256 over its canonical JSON with an
// empty Digest field; endpoint, contribution and policy changes always publish a new release.
type AgentPluginManifest struct {
	SchemaVersion int                    `json:"schemaVersion"`
	ID            string                 `json:"id"`
	Version       string                 `json:"version"`
	Digest        string                 `json:"digest"`
	DisplayName   string                 `json:"displayName"`
	Description   string                 `json:"description"`
	Source        AgentPluginSourceKind  `json:"source"`
	Trust         AgentPluginTrustLevel  `json:"trust"`
	MCPServers    []AgentPluginMCPServer `json:"mcpServers"`
	Skills        []AgentPluginSkill     `json:"skills,omitempty"`
}

// AgentPluginCatalogEntry is global Admin-governed marketplace metadata.
type AgentPluginCatalogEntry struct {
	ID                  string
	DisplayName         string
	Description         string
	Source              AgentPluginSourceKind
	Trust               AgentPluginTrustLevel
	InstallPolicy       AgentPluginInstallPolicy
	Availability        string
	LatestReleaseDigest string
	Listed              bool
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type AgentPluginInstallation struct {
	TenantID         string
	WorkspaceID      string
	PluginID         string
	ReleaseDigest    string
	Enabled          bool
	Revision         int64
	Config           map[string]string
	EncryptedSecrets map[string]string
	InstalledBy      string
	UpdatedBy        string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type AgentPluginListItem struct {
	Catalog       AgentPluginCatalogEntry
	Manifest      AgentPluginManifest
	Installed     bool
	Enabled       bool
	StateRevision int64
}

// AgentPluginSelectionCandidate is the installed release projection used to build a
// renderer-safe selector response. It intentionally excludes endpoint and grant data.
type AgentPluginSelectionCandidate struct {
	PluginID     string
	DisplayName  string
	Description  string
	InstallPolicy AgentPluginInstallPolicy
	Manifest     AgentPluginManifest
}

type AgentPluginSelectionOption struct {
	PluginID          string
	DisplayName       string
	Description       string
	SelectedByDefault bool
	RequiresBindings  bool
}

// AgentPluginActivation is the only plugin input accepted from Chat/the renderer.
type AgentPluginActivation struct {
	PluginID string            `json:"pluginId"`
	Bindings map[string]string `json:"bindings,omitempty"`
}

type ResolvedAgentPlugin struct {
	Manifest   AgentPluginManifest   `json:"manifest"`
	Activation AgentPluginActivation `json:"activation"`
}

// AgentPluginConnectionGrant is returned only over the trusted internal transport and remains
// in the Runtime/Desktop process memory. It is deliberately outside the persisted snapshot hash.
type AgentPluginConnectionGrant struct {
	PluginID   string            `json:"pluginId"`
	ServerName string            `json:"serverName"`
	Headers    map[string]string `json:"headers"`
	ExpiresAt  *time.Time        `json:"expiresAt,omitempty"`
}

type ResolvedAgentPluginSnapshot struct {
	SchemaVersion     int                          `json:"schemaVersion"`
	SnapshotID        string                       `json:"snapshotId"`
	SnapshotDigest    string                       `json:"snapshotDigest"`
	WorkspaceRevision int64                        `json:"workspaceRevision"`
	TenantID          string                       `json:"tenantId"`
	WorkspaceID       string                       `json:"workspaceId"`
	ResolvedAt        time.Time                    `json:"resolvedAt"`
	Plugins           []ResolvedAgentPlugin        `json:"plugins"`
	ConnectionGrants  []AgentPluginConnectionGrant `json:"connectionGrants"`
}
