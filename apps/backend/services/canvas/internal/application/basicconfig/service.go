package basicconfig

import (
	"context"
	"errors"
	"fmt"
	"strings"

	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

// Service exposes the AgentFrame-owned subset of tenant basic configuration.
type Service struct {
	defaults applicationmodel.DefaultStore
	catalog  applicationmodel.Catalog
}

func NewService(defaults applicationmodel.DefaultStore, catalog applicationmodel.Catalog) *Service {
	return &Service{defaults: defaults, catalog: catalog}
}

// Update validates every selection against current AIGW metadata before the
// complete tenant configuration is replaced atomically.
func (s *Service) Update(
	ctx context.Context,
	tenantID, userID string,
	config applicationmodel.DefaultModels,
) (applicationmodel.DefaultModels, error) {
	tenantID, userID = strings.TrimSpace(tenantID), strings.TrimSpace(userID)
	if tenantID == "" || userID == "" {
		return applicationmodel.DefaultModels{}, errors.New("tenant ID and user ID must not be empty")
	}
	if s == nil || s.defaults == nil || s.catalog == nil {
		return applicationmodel.DefaultModels{}, errors.New("default model dependencies must not be nil")
	}
	config.InferenceModel.ModelID = strings.TrimSpace(config.InferenceModel.ModelID)
	config.ImageModel.ModelID = strings.TrimSpace(config.ImageModel.ModelID)
	config.VideoModel.ModelID = strings.TrimSpace(config.VideoModel.ModelID)
	if config.InferenceModel.ModelID == "" || config.ImageModel.ModelID == "" || config.VideoModel.ModelID == "" {
		return applicationmodel.DefaultModels{}, errno.New(errno.ErrModelUnavailable)
	}
	requirements := []applicationmodel.Requirement{
		{Capability: applicationmodel.CapabilityStoryboardInference, ModelID: config.InferenceModel.ModelID},
		{Capability: applicationmodel.CapabilityResourceTextToImage, ModelID: config.ImageModel.ModelID},
		{Capability: applicationmodel.CapabilityCanvasNodeVideo, ModelID: config.VideoModel.ModelID},
	}
	resolved, err := s.catalog.Resolve(ctx, applicationmodel.Actor{TenantID: tenantID, UserID: userID}, requirements)
	if err != nil {
		if errors.Is(err, applicationmodel.ErrUnavailable) {
			return applicationmodel.DefaultModels{}, errno.Wrap(errno.ErrModelUnavailable, err)
		}
		return applicationmodel.DefaultModels{}, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	if len(resolved) != len(requirements) {
		return applicationmodel.DefaultModels{}, errno.New(errno.ErrModelUnavailable)
	}
	for _, model := range resolved {
		if !model.IsPublic {
			return applicationmodel.DefaultModels{}, errno.New(errno.ErrModelUnavailable)
		}
	}
	if err = s.defaults.Save(ctx, tenantID, userID, config); err != nil {
		return applicationmodel.DefaultModels{}, fmt.Errorf("save default models: %w", err)
	}
	return config, nil
}

func (s *Service) Get(ctx context.Context, tenantID string) (applicationmodel.DefaultModels, error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return applicationmodel.DefaultModels{}, errors.New("tenant ID must not be empty")
	}
	if s == nil || s.defaults == nil {
		return applicationmodel.DefaultModels{}, errors.New("default models must not be nil")
	}
	config, err := s.defaults.GetAll(ctx, tenantID)
	if err != nil {
		return applicationmodel.DefaultModels{}, fmt.Errorf("get default models: %w", err)
	}
	return config, nil
}
