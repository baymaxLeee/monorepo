package modelcatalog

import (
	"context"
	"encoding/json"
	"strings"

	requestcontext "github.com/example/monorepo/canvas/internal/api/requestcontext"
	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	"github.com/example/monorepo/canvas/internal/infrastructure/admin"
)

// Catalog keeps the mature application model contract while resolving the
// provider from the monorepo Admin service instead of the former AIGW/IAM SDK.
type Catalog struct{ providers *admin.Directory }

func New(providers *admin.Directory) *Catalog { return &Catalog{providers: providers} }

func (catalog *Catalog) Resolve(ctx context.Context, actor applicationmodel.Actor, requirements []applicationmodel.Requirement) ([]applicationmodel.Resolution, error) {
	if catalog == nil || catalog.providers == nil || strings.TrimSpace(actor.TenantID) == "" || len(requirements) == 0 {
		return nil, applicationmodel.ErrUnavailable
	}
	workspaceID, ok := requestcontext.WorkspaceIDFromContext(ctx)
	if !ok || strings.TrimSpace(workspaceID) == "" {
		return nil, applicationmodel.ErrUnavailable
	}
	resolved := make([]applicationmodel.Resolution, len(requirements))
	for index, requirement := range requirements {
		provider, err := catalog.provider(ctx, actor.TenantID, workspaceID, requirement)
		if err != nil {
			return nil, err
		}
		item := applicationmodel.Resolution{
			Selection:   applicationmodel.Selection{ModelID: provider.ID},
			ModelName:   provider.Name,
			ModelSource: applicationmodel.SourceSystemDistributed,
		}
		switch requirement.Capability {
		case applicationmodel.CapabilityCanvasNodeVideo:
			var capabilities applicationmodel.VideoCapabilities
			if !decodeCapabilities(provider.ExtraBody, "video", &capabilities) {
				return nil, applicationmodel.ErrUnavailable
			}
			item.VideoCapabilities = &capabilities
		case applicationmodel.CapabilityResourceTextToImage, applicationmodel.CapabilityResourceImageToImage:
			var capabilities applicationmodel.ImageCapabilities
			if !decodeCapabilities(provider.ExtraBody, "image", &capabilities) {
				return nil, applicationmodel.ErrUnavailable
			}
			item.ImageCapabilities = &capabilities
		}
		resolved[index] = item
	}
	return resolved, nil
}

func (catalog *Catalog) LoadSelection(ctx context.Context, tenantID string, capability applicationmodel.Capability, modelID string) (applicationmodel.Selection, error) {
	items, err := catalog.Resolve(ctx, applicationmodel.Actor{TenantID: tenantID, UserID: "model-selection"}, []applicationmodel.Requirement{{Capability: capability, ModelID: modelID}})
	if err != nil {
		return applicationmodel.Selection{}, err
	}
	return items[0].Selection, nil
}

func (catalog *Catalog) provider(ctx context.Context, tenantID, workspaceID string, requirement applicationmodel.Requirement) (admin.Provider, error) {
	if modelID := strings.TrimSpace(requirement.ModelID); modelID != "" {
		provider, err := catalog.providers.Get(ctx, tenantID, workspaceID, modelID)
		if err != nil || !provider.IsEnabled || !supports(provider.ProviderKind, requirement.Capability) {
			return admin.Provider{}, applicationmodel.ErrUnavailable
		}
		return provider, nil
	}
	providers, err := catalog.providers.List(ctx, tenantID, workspaceID)
	if err != nil {
		return admin.Provider{}, applicationmodel.ErrUnavailable
	}
	for _, provider := range providers {
		if provider.IsEnabled && supports(provider.ProviderKind, requirement.Capability) {
			return provider, nil
		}
	}
	return admin.Provider{}, applicationmodel.ErrDefaultModelNotConfigured
}

func supports(kind string, capability applicationmodel.Capability) bool {
	switch capability {
	case applicationmodel.CapabilityStoryboardInference, applicationmodel.CapabilityCanvasTextGeneration:
		return kind == "chat"
	case applicationmodel.CapabilityCanvasNodeVideo:
		return kind == "video"
	case applicationmodel.CapabilityResourceTextToImage, applicationmodel.CapabilityResourceImageToImage:
		return kind == "image"
	default:
		return false
	}
}

func decodeCapabilities(extra map[string]any, key string, output any) bool {
	capabilities, ok := extra["canvas_capabilities"].(map[string]any)
	if !ok {
		return false
	}
	value, ok := capabilities[key]
	if !ok {
		return false
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return false
	}
	return json.Unmarshal(encoded, output) == nil
}
