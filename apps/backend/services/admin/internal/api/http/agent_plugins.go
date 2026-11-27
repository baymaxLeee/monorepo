package httpapi

import (
	"encoding/json"
	"net/http"

	adminapi "github.com/example/monorepo/admin/internal/api/generated/adminapi"
	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
	"github.com/gin-gonic/gin"
)

func rawObject(value map[string]interface{}) json.RawMessage {
	raw, _ := json.Marshal(value)
	return raw
}

func object(raw json.RawMessage) map[string]interface{} {
	if len(raw) == 0 {
		return nil
	}
	var value map[string]interface{}
	_ = json.Unmarshal(raw, &value)
	return value
}

func pluginManifestFromInput(value adminapi.AgentPluginManifestInput) domain.AgentPluginManifest {
	servers := make([]domain.AgentPluginMCPServer, 0, len(value.McpServers))
	for _, server := range value.McpServers {
		tools := make([]domain.AgentPluginMCPTool, 0, len(server.Tools))
		for _, tool := range server.Tools {
			policy := domain.AgentPluginToolPolicy{
				Capability: string(tool.Policy.Capability), Effect: string(tool.Policy.Effect),
				Trust: string(tool.Policy.Trust), Execution: string(tool.Policy.Execution),
			}
			if tool.Policy.CallableByCodeMode != nil {
				policy.CallableByCodeMode = *tool.Policy.CallableByCodeMode
			}
			if tool.Policy.SourceProjection != nil {
				policy.SourceProjection = *tool.Policy.SourceProjection
			}
			if tool.Policy.Streaming != nil {
				policy.Streaming = *tool.Policy.Streaming
			}
			if tool.Policy.UiKind != nil {
				policy.UIKind = string(*tool.Policy.UiKind)
			}
			planning := domain.AgentPluginToolPlanning{Summary: tool.Planning.Summary}
			if tool.Planning.Constraints != nil {
				planning.Constraints = append([]string(nil), (*tool.Planning.Constraints)...)
			}
			if tool.Planning.Prerequisites != nil {
				planning.Prerequisites = append([]string(nil), (*tool.Planning.Prerequisites)...)
			}
			if tool.Planning.Parallelizable != nil {
				planning.Parallelizable = *tool.Planning.Parallelizable
			}
			var output json.RawMessage
			if tool.OutputSchema != nil {
				output = rawObject(*tool.OutputSchema)
			}
			tools = append(tools, domain.AgentPluginMCPTool{
				Name: tool.Name, Description: tool.Description, InputSchema: rawObject(tool.InputSchema),
				OutputSchema: output, Policy: policy, Planning: planning,
			})
		}
		mapped := domain.AgentPluginMCPServer{Name: server.Name, URL: server.Url, Tools: tools}
		if server.RequiredBindings != nil {
			mapped.RequiredBindings = append([]string(nil), (*server.RequiredBindings)...)
		}
		if server.OptionalBindings != nil {
			mapped.OptionalBindings = append([]string(nil), (*server.OptionalBindings)...)
		}
		if server.BindingHeaders != nil {
			mapped.BindingHeaders = *server.BindingHeaders
		}
		if server.ConfigHeaders != nil {
			mapped.ConfigHeaders = *server.ConfigHeaders
		}
		if server.SecretHeaders != nil {
			mapped.SecretHeaders = *server.SecretHeaders
		}
		servers = append(servers, mapped)
	}
	skills := make([]domain.AgentPluginSkill, 0)
	if value.Skills != nil {
		for _, skill := range *value.Skills {
			skills = append(skills, domain.AgentPluginSkill{
				ID: skill.Id, Name: skill.Name, Description: skill.Description,
				AssetID: skill.AssetId, RevisionID: skill.RevisionId, SHA256: skill.Sha256,
			})
		}
	}
	return domain.AgentPluginManifest{
		SchemaVersion: int(value.SchemaVersion), ID: value.Id, Version: value.Version,
		DisplayName: value.DisplayName, Description: value.Description,
		Source: domain.AgentPluginSourceKind(value.Source), Trust: domain.AgentPluginTrustLevel(value.Trust),
		MCPServers: servers, Skills: skills,
	}
}

func pluginManifestDTO(value domain.AgentPluginManifest) adminapi.AgentPluginManifest {
	servers := make([]adminapi.AgentPluginMCPServer, 0, len(value.MCPServers))
	for _, server := range value.MCPServers {
		tools := make([]adminapi.AgentPluginMCPTool, 0, len(server.Tools))
		for _, tool := range server.Tools {
			policy := adminapi.AgentPluginToolPolicy{
				Capability: adminapi.AgentPluginToolPolicyCapability(tool.Policy.Capability),
				Effect:     adminapi.AgentPluginToolPolicyEffect(tool.Policy.Effect),
				Trust:      adminapi.AgentPluginToolPolicyTrust(tool.Policy.Trust),
				Execution:  adminapi.AgentPluginToolPolicyExecution(tool.Policy.Execution),
			}
			if tool.Policy.CallableByCodeMode {
				policy.CallableByCodeMode = pointer(true)
			}
			if tool.Policy.SourceProjection != nil {
				policy.SourceProjection = &tool.Policy.SourceProjection
			}
			if tool.Policy.Streaming {
				policy.Streaming = pointer(true)
			}
			if tool.Policy.UIKind != "" {
				kind := adminapi.AgentPluginToolPolicyUiKind(tool.Policy.UIKind)
				policy.UiKind = &kind
			}
			planning := adminapi.AgentPluginToolPlanning{Summary: tool.Planning.Summary}
			if len(tool.Planning.Constraints) > 0 {
				values := append([]string(nil), tool.Planning.Constraints...)
				planning.Constraints = &values
			}
			if len(tool.Planning.Prerequisites) > 0 {
				values := append([]string(nil), tool.Planning.Prerequisites...)
				planning.Prerequisites = &values
			}
			if tool.Planning.Parallelizable {
				planning.Parallelizable = pointer(true)
			}
			mapped := adminapi.AgentPluginMCPTool{
				Name: tool.Name, Description: tool.Description, InputSchema: object(tool.InputSchema),
				Policy: policy, Planning: planning,
			}
			if len(tool.OutputSchema) > 0 {
				output := object(tool.OutputSchema)
				mapped.OutputSchema = &output
			}
			tools = append(tools, mapped)
		}
		mapped := adminapi.AgentPluginMCPServer{Name: server.Name, Url: server.URL, Tools: tools}
		if len(server.RequiredBindings) > 0 {
			values := append([]string(nil), server.RequiredBindings...)
			mapped.RequiredBindings = &values
		}
		if len(server.OptionalBindings) > 0 {
			values := append([]string(nil), server.OptionalBindings...)
			mapped.OptionalBindings = &values
		}
		if len(server.BindingHeaders) > 0 {
			values := server.BindingHeaders
			mapped.BindingHeaders = &values
		}
		if len(server.ConfigHeaders) > 0 {
			values := server.ConfigHeaders
			mapped.ConfigHeaders = &values
		}
		if len(server.SecretHeaders) > 0 {
			values := server.SecretHeaders
			mapped.SecretHeaders = &values
		}
		servers = append(servers, mapped)
	}
	result := adminapi.AgentPluginManifest{
		SchemaVersion: adminapi.AgentPluginManifestSchemaVersion(value.SchemaVersion),
		Id:            value.ID, Version: value.Version, Digest: value.Digest,
		DisplayName: value.DisplayName, Description: value.Description,
		Source: adminapi.AgentPluginManifestSource(value.Source), Trust: adminapi.AgentPluginManifestTrust(value.Trust),
		McpServers: servers,
	}
	if len(value.Skills) > 0 {
		skills := make([]adminapi.AgentPluginSkill, 0, len(value.Skills))
		for _, skill := range value.Skills {
			skills = append(skills, adminapi.AgentPluginSkill{
				Id: skill.ID, Name: skill.Name, Description: skill.Description,
				AssetId: skill.AssetID, RevisionId: skill.RevisionID, Sha256: skill.SHA256,
			})
		}
		result.Skills = &skills
	}
	return result
}

func pluginListItemDTO(value domain.AgentPluginListItem) adminapi.AgentPluginListItem {
	return adminapi.AgentPluginListItem{
		PluginId: value.Catalog.ID, DisplayName: value.Catalog.DisplayName, Description: value.Catalog.Description,
		Source: adminapi.AgentPluginListItemSource(value.Catalog.Source), Trust: adminapi.AgentPluginListItemTrust(value.Catalog.Trust),
		InstallPolicy: adminapi.AgentPluginListItemInstallPolicy(value.Catalog.InstallPolicy),
		Availability:  value.Catalog.Availability, LatestReleaseDigest: value.Catalog.LatestReleaseDigest,
		Listed: value.Catalog.Listed, Manifest: pluginManifestDTO(value.Manifest),
		Installed: value.Installed, Enabled: value.Enabled, StateRevision: value.StateRevision,
	}
}

func pluginInstallationDTO(value domain.AgentPluginInstallation) adminapi.AgentPluginInstallation {
	return adminapi.AgentPluginInstallation{
		PluginId: value.PluginID, ReleaseDigest: value.ReleaseDigest, Enabled: value.Enabled,
		Revision: value.Revision, Config: value.Config, UpdatedAt: value.UpdatedAt,
	}
}

func pluginSelectionOptionDTO(value domain.AgentPluginSelectionOption) adminapi.AgentPluginSelectionOption {
	return adminapi.AgentPluginSelectionOption{
		PluginId: value.PluginID, DisplayName: value.DisplayName, Description: value.Description,
		SelectedByDefault: value.SelectedByDefault, RequiresBindings: value.RequiresBindings, CloudOnly: value.CloudOnly,
	}
}

func (h *Handler) ListAgentPluginOptions(c *gin.Context) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	values, err := h.Plugins.ListSelectionOptions(r.Context(), a)
	if err != nil {
		writeError(w, err)
		return
	}
	result := make([]adminapi.AgentPluginSelectionOption, 0, len(values))
	for _, value := range values {
		result = append(result, pluginSelectionOptionDTO(value))
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) ListAgentPlugins(c *gin.Context) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	values, err := h.Plugins.List(r.Context(), a)
	if err != nil {
		writeError(w, err)
		return
	}
	result := make([]adminapi.AgentPluginListItem, 0, len(values))
	for _, value := range values {
		result = append(result, pluginListItemDTO(value))
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) PublishAgentPlugin(c *gin.Context) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	var body adminapi.PublishAgentPluginInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&body); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	catalog, manifest, err := h.Plugins.PublishRelease(r.Context(), a, application.PublishAgentPluginInput{
		Manifest:      pluginManifestFromInput(body.Manifest),
		InstallPolicy: domain.AgentPluginInstallPolicy(body.InstallPolicy),
		Availability:  body.Availability, Listed: body.Listed,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, pluginListItemDTO(domain.AgentPluginListItem{Catalog: catalog, Manifest: manifest}))
}

func (h *Handler) InstallAgentPlugin(c *gin.Context, pluginID string) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	var body adminapi.InstallAgentPluginInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&body); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	config, secrets := map[string]string{}, map[string]string{}
	if body.Config != nil {
		config = *body.Config
	}
	if body.Secrets != nil {
		secrets = *body.Secrets
	}
	value, err := h.Plugins.Install(r.Context(), a, application.InstallAgentPluginInput{
		PluginID: pluginID, ReleaseDigest: body.ReleaseDigest, Enabled: body.Enabled,
		Config: config, Secrets: secrets,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, pluginInstallationDTO(value))
}

func (h *Handler) SetAgentPluginEnabled(c *gin.Context, pluginID string) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	var body adminapi.SetAgentPluginEnabledInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&body); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	value, err := h.Plugins.SetEnabled(r.Context(), a, pluginID, body.Enabled)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, pluginInstallationDTO(value))
}

func (h *Handler) UninstallAgentPlugin(c *gin.Context, pluginID string) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err == nil {
		err = h.Plugins.Uninstall(r.Context(), a, pluginID)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
