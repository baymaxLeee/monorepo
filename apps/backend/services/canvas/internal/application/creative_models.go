package application

import (
	"context"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
)

// CreativeProviders exposes the admin-owned provider catalog to project members.
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
	result := c.ProjectProviderList{Items: []c.ProjectProvider{}}
	for _, provider := range providers {
		if !provider.IsEnabled {
			continue
		}
		item := c.ProjectProvider{ID: provider.ID, Name: provider.Name, Model: provider.Model, ProviderKind: provider.ProviderKind, IsDefault: provider.IsDefault, IsEnabled: true, Granted: true}
		if provider.Pricing != nil {
			item.Currency = provider.Pricing.Currency
			item.UnitPriceMicros = provider.Pricing.UnitPriceMicros
		}
		result.Items = append(result.Items, item)
	}
	return result, nil
}
