package modelcatalog

import (
	"context"
	"encoding/json"
	"strings"

	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	"github.com/example/monorepo/canvas/internal/infrastructure/admin"
)

// Catalog projects the custom providers owned by the monorepo Admin service
// into Canvas model selections and capabilities.
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
			capabilities := imageCapabilities(provider.Model)
			features := []string{"text2image"}
			if capabilities.MaxInputReferences != nil && *capabilities.MaxInputReferences > 0 {
				features = append(features, "image2image")
			}
			value["Type"], value["FeaturesConfig"] = "vision", features
			value["Property"] = imageProperty(capabilities)
		case "video":
			capabilities := videoCapabilities(provider.Model)
			features := []string{"text2video"}
			if capabilities.MaxImageReferences != nil && *capabilities.MaxImageReferences > 0 {
				features = append(features, "image2video")
			}
			value["Type"], value["FeaturesConfig"] = "vision", features
			value["Property"] = videoProperty(capabilities)
		default:
			continue
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
	workspaceID := ""
	if actor.WorkspaceID != nil {
		workspaceID = strings.TrimSpace(*actor.WorkspaceID)
	}
	if workspaceID == "" {
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
			capabilities := videoCapabilities(provider.Model)
			item.VideoCapabilities = &capabilities
		case applicationmodel.CapabilityResourceTextToImage, applicationmodel.CapabilityResourceImageToImage:
			capabilities := imageCapabilities(provider.Model)
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

func videoCapabilities(model string) applicationmodel.VideoCapabilities {
	minimum, maximum := int32(5), int32(10)
	recommends := []int32{5, 10}
	imageReferences, videoReferences, audioReferences := 0, 0, 0
	normalized := normalizeModelName(model)
	switch {
	case strings.Contains(normalized, "seedance-2-5"):
		minimum, maximum = 4, 30
		recommends = []int32{-1, 5, 10, 15, 30}
		imageReferences, videoReferences, audioReferences = 9, 3, 3
	case strings.Contains(normalized, "seedance-2"):
		minimum, maximum = 4, 15
		recommends = []int32{-1, 5, 10, 15}
		imageReferences, videoReferences, audioReferences = 9, 3, 3
	case strings.Contains(normalized, "seedance-1-5"):
		minimum, maximum = 4, 12
		recommends = []int32{-1, 5, 10, 12}
	}
	defaultDuration := int32(5)
	defaultRatio := "9:16"
	watermarkSupported := true
	return applicationmodel.VideoCapabilities{
		DurationMinSeconds: minimum, DurationMaxSeconds: maximum, DurationDefaultSeconds: &defaultDuration,
		DurationRecommends: recommends, DurationRecommendDefault: &recommends[0],
		Resolutions:         []string{"480p", "720p", "1080p", "4k"},
		AspectRatios:        []string{"16:9", "4:3", "1:1", "3:4", "9:16", "21:9"},
		AspectRatioAdaptive: true, AspectRatioDefault: &defaultRatio, GenerateAudio: []bool{false, true},
		WatermarkSupported: &watermarkSupported, MaxImageReferences: &imageReferences,
		MaxVideoReferences: &videoReferences, MaxAudioReferences: &audioReferences,
	}
}

func imageCapabilities(model string) applicationmodel.ImageCapabilities {
	maximumReferences := 0
	if normalized := normalizeModelName(model); strings.Contains(normalized, "seedream-4") || strings.Contains(normalized, "seedream-5") {
		maximumReferences = 10
	}
	watermarkSupported := true
	return applicationmodel.ImageCapabilities{
		Width: applicationmodel.IntRange{Min: 512, Max: 4096}, Height: applicationmodel.IntRange{Min: 512, Max: 4096},
		AspectRatio: applicationmodel.FloatRange{Min: 0.25, Max: 4}, TotalPixels: applicationmodel.IntRange{Max: 4096 * 4096},
		WatermarkSupported: &watermarkSupported, MaxInputReferences: &maximumReferences,
	}
}

func normalizeModelName(value string) string {
	return strings.NewReplacer("_", "-", ".", "-", " ", "-").Replace(strings.ToLower(strings.TrimSpace(value)))
}

func videoProperty(capabilities applicationmodel.VideoCapabilities) map[string]any {
	return map[string]any{"Vision": map[string]any{"Video": map[string]any{
		"Duration": map[string]any{
			"Min": capabilities.DurationMinSeconds, "Max": capabilities.DurationMaxSeconds,
			"Default": capabilities.DurationDefaultSeconds, "Recommends": capabilities.DurationRecommends,
			"RecommendDefault": capabilities.DurationRecommendDefault,
		},
		"Ratio":         map[string]any{"Values": capabilities.AspectRatios, "Adaptive": capabilities.AspectRatioAdaptive, "Default": capabilities.AspectRatioDefault},
		"Resolutions":   capabilities.Resolutions,
		"GenerateAudio": map[string]any{"Types": switchValues(capabilities.GenerateAudio), "Default": "enabled"},
		"Watermark":     map[string]any{"Supported": capabilities.WatermarkSupported, "Enabled": false},
		"Reference": map[string]any{
			"Image": referenceProperty(capabilities.MaxImageReferences),
			"Video": referenceProperty(capabilities.MaxVideoReferences),
			"Audio": referenceProperty(capabilities.MaxAudioReferences),
		},
	}}}
}

func imageProperty(capabilities applicationmodel.ImageCapabilities) map[string]any {
	return map[string]any{"Vision": map[string]any{"Image": map[string]any{
		"TextToImage":  map[string]any{},
		"ImageToImage": map[string]any{"InputConfig": map[string]any{"Min": 1, "Max": capabilities.MaxInputReferences}},
		"HW": map[string]any{
			"Width": capabilities.Width, "Height": capabilities.Height,
			"Ratio": capabilities.AspectRatio, "Total": capabilities.TotalPixels,
		},
		"Watermark": map[string]any{"Supported": capabilities.WatermarkSupported, "Enabled": false},
	}}}
}

func switchValues(values []bool) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value {
			result = append(result, "enabled")
		} else {
			result = append(result, "disabled")
		}
	}
	return result
}

func referenceProperty(maximum *int) map[string]any {
	value := 0
	if maximum != nil {
		value = *maximum
	}
	return map[string]any{"Supported": value > 0, "Max": value}
}
