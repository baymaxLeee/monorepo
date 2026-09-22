package modelcatalog

import (
	"context"
	"encoding/json"
	"strings"

	requestcontext "github.com/example/monorepo/canvas/internal/api/requestcontext"
	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	"github.com/example/monorepo/canvas/internal/infrastructure/admin"
)

// Catalog keeps the mature application model contract while resolving the
// provider from the monorepo Admin service instead of the former AIGW/IAM SDK.
type Catalog struct{ providers *admin.Directory }

func New(providers *admin.Directory) *Catalog { return &Catalog{providers: providers} }

func (catalog *Catalog) List(ctx context.Context, scope applicationproject.Scope, input applicationproject.ListModelsInput) (applicationproject.ProjectModelList, error) {
	workspaceID := ""
	if scope.WorkspaceID != nil {
		workspaceID = *scope.WorkspaceID
	}
	providers, err := catalog.providers.List(ctx, scope.TenantID, workspaceID)
	if err != nil {
		return applicationproject.ProjectModelList{}, err
	}
	items := make([]json.RawMessage, 0, len(providers))
	for _, provider := range providers {
		if input.IsGranted != nil && *input.IsGranted && !provider.IsEnabled {
			continue
		}
		value := map[string]any{
			"ID": provider.ID, "Name": provider.Name, "ModelName": provider.Model,
			"Provider": provider.ProviderKind, "IsPublic": true, "IsDefault": provider.IsDefault,
			"Granted": provider.IsEnabled, "Status": map[bool]string{true: "Running", false: "Disabled"}[provider.IsEnabled],
		}
		switch provider.ProviderKind {
		case "chat":
			value["Type"], value["FeaturesConfig"] = "text-generation", []string{"tool-call"}
		case "image":
			value["Type"], value["FeaturesConfig"] = "vision", []string{"text2image"}
		case "video":
			value["Type"], value["FeaturesConfig"] = "vision", []string{"text2video"}
		default:
			continue
		}
		if capabilities, ok := provider.ExtraBody["canvas_capabilities"].(map[string]any); ok {
			if video, exists := capabilities["video"]; exists {
				value["Property"] = map[string]any{"Vision": map[string]any{"Video": video}}
			}
		}
		encoded, marshalErr := json.Marshal(value)
		if marshalErr != nil {
			return applicationproject.ProjectModelList{}, marshalErr
		}
		items = append(items, encoded)
	}
	start := int(input.PageNumber-1) * int(input.PageSize)
	if start >= len(items) {
		return applicationproject.ProjectModelList{Total: int32(len(items))}, nil
	}
	end := min(start+int(input.PageSize), len(items))
	return applicationproject.ProjectModelList{Items: items[start:end], Total: int32(len(items))}, nil
}

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

func (catalog *Catalog) LoadSelection(ctx context.Context, tenantID string, workspaceID *string, capability applicationmodel.Capability, modelID string) (applicationmodel.Selection, error) {
	workspace := ""
	if workspaceID != nil {
		workspace = strings.TrimSpace(*workspaceID)
	}
	if catalog == nil || catalog.providers == nil || strings.TrimSpace(tenantID) == "" || workspace == "" {
		return applicationmodel.Selection{}, applicationmodel.ErrUnavailable
	}
	provider, err := catalog.provider(ctx, tenantID, workspace, applicationmodel.Requirement{Capability: capability, ModelID: modelID})
	if err != nil {
		return applicationmodel.Selection{}, err
	}
	return applicationmodel.Selection{ModelID: provider.ID}, nil
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
