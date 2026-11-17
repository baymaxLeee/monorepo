package admin

import (
	"context"
	"errors"
	"time"

	adminv1 "github.com/example/monorepo/inner-api-go/gen/admin/v1"
)

type InferenceParameters struct {
	Temperature     *float64 `json:"temperature"`
	TopP            *float64 `json:"top_p"`
	MaxOutputTokens *int64   `json:"max_tokens"`
	ReasoningEffort *string  `json:"reasoning_effort"`
}

type InferenceSelection struct {
	ProviderID string              `json:"provider_id"`
	Parameters InferenceParameters `json:"parameters"`
}

type CanvasDefaults struct {
	Inference *InferenceSelection `json:"inference"`
	Image     *InferenceSelection `json:"image"`
	Video     *InferenceSelection `json:"video"`
}

func (d *Directory) CanvasDefaults(ctx context.Context, tenantID, workspaceID string) (CanvasDefaults, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	response, err := d.settings.GetCanvasSettings(ctx, &adminv1.GetCanvasSettingsRequest{Actor: actor(tenantID, workspaceID)})
	if err != nil {
		return CanvasDefaults{}, err
	}
	if response.GetSettings() == nil || response.GetSettings().GetDefaults() == nil {
		return CanvasDefaults{}, errors.New("admin returned no canvas settings")
	}
	value := response.GetSettings().GetDefaults()
	return CanvasDefaults{
		Inference: inferenceSelectionFromProto(value.GetInference()),
		Image:     inferenceSelectionFromProto(value.GetImage()),
		Video:     inferenceSelectionFromProto(value.GetVideo()),
	}, nil
}

func inferenceSelectionFromProto(value *adminv1.CanvasModelSelection) *InferenceSelection {
	if value == nil {
		return nil
	}
	result := &InferenceSelection{ProviderID: value.GetProviderId()}
	parameters := map[string]any{}
	if value.GetParameters() != nil {
		parameters = value.GetParameters().AsMap()
	}
	if raw, ok := parameters["temperature"].(float64); ok {
		result.Parameters.Temperature = &raw
	}
	if raw, ok := parameters["top_p"].(float64); ok {
		result.Parameters.TopP = &raw
	}
	if raw, ok := parameters["max_tokens"].(float64); ok {
		converted := int64(raw)
		result.Parameters.MaxOutputTokens = &converted
	}
	if raw, ok := parameters["reasoning_effort"].(string); ok {
		result.Parameters.ReasoningEffort = &raw
	}
	return result
}

func (d *Directory) InferenceDefaults(ctx context.Context, tenantID, workspaceID string) (InferenceSelection, error) {
	defaults, err := d.CanvasDefaults(ctx, tenantID, workspaceID)
	if err != nil {
		return InferenceSelection{}, err
	}
	if defaults.Inference == nil {
		return InferenceSelection{}, nil
	}
	return *defaults.Inference, nil
}
