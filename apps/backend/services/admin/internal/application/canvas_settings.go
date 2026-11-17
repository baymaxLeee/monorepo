package application

import (
	"context"
	"encoding/json"
)

type CanvasSettingsService struct {
	Store     CanvasSettingsStore
	Providers ProviderRepository
}
type CanvasSettings struct {
	Revision int
	Defaults json.RawMessage
}

func (s CanvasSettingsService) Get(ctx context.Context, workspaceID, tenantID string) (CanvasSettings, error) {
	if workspaceID == "" {
		return CanvasSettings{}, Forbidden("active workspace required")
	}
	return s.Store.Get(ctx, workspaceID, tenantID)
}
func (s CanvasSettingsService) Update(ctx context.Context, a Actor, expected int, defaults json.RawMessage) (CanvasSettings, error) {
	if err := RequireWorkspaceAdmin(a); err != nil {
		return CanvasSettings{}, err
	}
	var selections map[string]*struct {
		ProviderID string `json:"provider_id"`
		Parameters struct {
			MaxTokens *int `json:"max_tokens"`
		} `json:"parameters"`
	}
	if err := json.Unmarshal(defaults, &selections); err != nil {
		return CanvasSettings{}, BadRequest("invalid Canvas defaults")
	}
	for slot, kind := range map[string]string{"inference": "chat", "image": "image", "video": "video"} {
		selection := selections[slot]
		if selection == nil {
			continue
		}
		provider, err := s.Providers.Get(ctx, selection.ProviderID, a.WorkspaceID, a.TenantID)
		if err != nil || !provider.IsEnabled || provider.Kind != kind {
			return CanvasSettings{}, BadRequest(slot + " requires an enabled " + kind + " provider in this workspace")
		}
		if selection.Parameters.MaxTokens != nil && *selection.Parameters.MaxTokens > provider.MaxOutputTokens {
			return CanvasSettings{}, BadRequest("max_tokens exceeds the provider output budget")
		}
	}
	return s.Store.Update(ctx, a, expected, defaults)
}
