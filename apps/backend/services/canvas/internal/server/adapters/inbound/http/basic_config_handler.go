package http

import (
	"context"
	"errors"

	applicationbasicconfig "github.com/example/monorepo/canvas/internal/server/application/basicconfig"
	applicationmodel "github.com/example/monorepo/canvas/internal/server/application/model"
	contractbasicconfig "github.com/example/monorepo/canvas/internal/server/contracts/basicconfig"
)

type basicConfigService interface {
	Get(context.Context, string) (applicationmodel.DefaultModels, error)
	Update(context.Context, string, string, applicationmodel.DefaultModels) (applicationmodel.DefaultModels, error)
}

func (h *BasicConfigHandler) UpdateBasicConfig(
	ctx context.Context,
	request *contractbasicconfig.UpdateBasicConfigRequest,
) (*contractbasicconfig.UpdateBasicConfigResponse, error) {
	if err := requireAction(ctx, "UpdateBasicConfig"); err != nil {
		return nil, err
	}
	if request == nil || request.DefaultModels == nil {
		return nil, errors.New("default models must not be nil")
	}
	request.Top = topParam(ctx)
	config, err := h.service.Update(
		ctx,
		request.Top.TenantID,
		request.Top.GetUserID(),
		defaultModelsFromDTO(request.DefaultModels),
	)
	if err != nil {
		return nil, err
	}
	return &contractbasicconfig.UpdateBasicConfigResponse{DefaultModels: defaultModelsDTO(config)}, nil
}

type BasicConfigHandler struct {
	service basicConfigService
}

func NewBasicConfigHandler(service *applicationbasicconfig.Service) *BasicConfigHandler {
	return &BasicConfigHandler{service: service}
}

func (h *BasicConfigHandler) GetBasicConfig(
	ctx context.Context,
	request *contractbasicconfig.GetBasicConfigRequest,
) (*contractbasicconfig.GetBasicConfigResponse, error) {
	return h.getBasicConfig(ctx, request, "GetBasicConfig")
}

func (h *BasicConfigHandler) GetRuntimeBasicConfig(
	ctx context.Context,
	request *contractbasicconfig.GetBasicConfigRequest,
) (*contractbasicconfig.GetBasicConfigResponse, error) {
	return h.getBasicConfig(ctx, request, "GetRuntimeBasicConfig")
}

func (h *BasicConfigHandler) getBasicConfig(
	ctx context.Context,
	request *contractbasicconfig.GetBasicConfigRequest,
	action string,
) (*contractbasicconfig.GetBasicConfigResponse, error) {
	if err := requireAction(ctx, action); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	config, err := h.service.Get(ctx, request.Top.TenantID)
	if err != nil {
		return nil, err
	}
	return &contractbasicconfig.GetBasicConfigResponse{DefaultModels: defaultModelsDTO(config)}, nil
}

func defaultModelsDTO(config applicationmodel.DefaultModels) *contractbasicconfig.DefaultModels {
	return &contractbasicconfig.DefaultModels{
		InferenceModel: modelSelectionDTO(config.InferenceModel),
		ImageModel:     modelSelectionDTO(config.ImageModel),
		VideoModel:     modelSelectionDTO(config.VideoModel),
	}
}

func modelSelectionDTO(selection applicationmodel.Selection) *contractbasicconfig.ModelSelection {
	return &contractbasicconfig.ModelSelection{
		ModelID: selection.ModelID,
		ModelConfig: &contractbasicconfig.ModelConfig{
			Temperature:         selection.ModelConfig.Temperature,
			TopP:                selection.ModelConfig.TopP,
			MaxTokens:           selection.ModelConfig.MaxTokens,
			ReasoningEffortType: optionalString(selection.ModelConfig.ReasoningEffortType),
		},
	}
}

func defaultModelsFromDTO(config *contractbasicconfig.DefaultModels) applicationmodel.DefaultModels {
	return applicationmodel.DefaultModels{
		InferenceModel: modelSelectionFromDTO(config.InferenceModel),
		ImageModel:     modelSelectionFromDTO(config.ImageModel),
		VideoModel:     modelSelectionFromDTO(config.VideoModel),
	}
}

func modelSelectionFromDTO(selection *contractbasicconfig.ModelSelection) applicationmodel.Selection {
	if selection == nil {
		return applicationmodel.Selection{}
	}
	result := applicationmodel.Selection{ModelID: selection.ModelID}
	if selection.ModelConfig != nil {
		result.ModelConfig = applicationmodel.Config{
			Temperature:         selection.ModelConfig.Temperature,
			TopP:                selection.ModelConfig.TopP,
			MaxTokens:           selection.ModelConfig.MaxTokens,
			ReasoningEffortType: selection.ModelConfig.GetReasoningEffortType(),
		}
	}
	return result
}
