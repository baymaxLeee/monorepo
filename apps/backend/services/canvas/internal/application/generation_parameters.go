package application

import (
	"context"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	adminclient "github.com/example/monorepo/canvas/internal/infrastructure/admin"
)

type inferenceDefaultsReader interface {
	InferenceDefaults(context.Context, string, string) (adminclient.InferenceSelection, error)
}

type canvasDefaultsReader interface {
	CanvasDefaults(context.Context, string, string) (adminclient.CanvasDefaults, error)
}

func (s *Service) ResolveDefaultProvider(ctx context.Context, actor Actor, kind string) (string, error) {
	reader, ok := s.ProviderDirectory.(canvasDefaultsReader)
	if !ok {
		return "", &Error{Status: 503, Code: "settings_unavailable", Message: "创作默认模型不可用"}
	}
	defaults, err := reader.CanvasDefaults(ctx, actor.TenantID, actor.WorkspaceID)
	if err != nil {
		return "", &Error{Status: 503, Code: "settings_unavailable", Message: "创作默认模型不可用"}
	}
	var selection *adminclient.InferenceSelection
	switch kind {
	case "image":
		selection = defaults.Image
	case "video":
		selection = defaults.Video
	default:
		selection = defaults.Inference
	}
	if selection == nil {
		return "", nil
	}
	return selection.ProviderID, nil
}

func (s *Service) ResolveInferenceParameters(ctx context.Context, actor Actor, providerID string) (*c.InferenceParameters, error) {
	reader, ok := s.ProviderDirectory.(inferenceDefaultsReader)
	if !ok {
		return nil, &Error{Status: 503, Code: "settings_unavailable", Message: "创作默认参数不可用"}
	}
	defaults, err := reader.InferenceDefaults(ctx, actor.TenantID, actor.WorkspaceID)
	if err != nil {
		return nil, err
	}
	if defaults.ProviderID != providerID {
		return nil, nil
	}
	p := defaults.Parameters
	return &c.InferenceParameters{Temperature: p.Temperature, TopP: p.TopP, MaxOutputTokens: p.MaxOutputTokens, ReasoningEffort: p.ReasoningEffort}, nil
}
