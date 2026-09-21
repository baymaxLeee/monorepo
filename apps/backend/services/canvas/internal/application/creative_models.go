package application

import (
	"context"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
)

// CreativeProviders projects the platform catalog through the project's grants.
// Ordinary project members must not need access to management APIs to create.
func (s *Service) CreativeProviders(ctx context.Context, actor Actor, projectID string) (c.ProjectProviderList, error) {
	db := s.DB.WithContext(ctx)
	if _, err := access(db, actor, projectID, false); err != nil {
		return c.ProjectProviderList{}, err
	}
	if s.ProviderDirectory == nil {
		return c.ProjectProviderList{}, &Error{Status: 503, Code: "provider_directory_unavailable", Message: "模型目录不可用"}
	}
	providers, err := s.ProviderDirectory.List(ctx, actor.TenantID, actor.WorkspaceID)
	if err != nil {
		return c.ProjectProviderList{}, &Error{Status: 503, Code: "provider_directory_unavailable", Message: "模型目录不可用"}
	}
	var ids []string
	if err := db.Model(&projectModelGrant{}).Where("project_id = ? AND tenant_id = ? AND workspace_id = ?", projectID, actor.TenantID, actor.WorkspaceID).Pluck("provider_id", &ids).Error; err != nil {
		return c.ProjectProviderList{}, err
	}
	granted := make(map[string]bool, len(ids))
	for _, id := range ids {
		granted[id] = true
	}
	result := c.ProjectProviderList{Items: []c.ProjectProvider{}}
	for _, provider := range providers {
		if !provider.IsEnabled || (!provider.IsDefault && !granted[provider.ID]) {
			continue
		}
		item := c.ProjectProvider{ID: provider.ID, Name: provider.Name, Model: provider.Model, ProviderKind: provider.ProviderKind, IsDefault: provider.IsDefault, IsEnabled: true, Granted: granted[provider.ID]}
		if provider.Pricing != nil {
			item.Currency = provider.Pricing.Currency
			item.UnitPriceMicros = provider.Pricing.UnitPriceMicros
		}
		result.Items = append(result.Items, item)
	}
	return result, nil
}
