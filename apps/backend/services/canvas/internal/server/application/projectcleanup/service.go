package projectcleanup

import (
	"context"
	"errors"

	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
	applicationcanvas "github.com/example/monorepo/canvas/internal/server/application/canvas"
	applicationproject "github.com/example/monorepo/canvas/internal/server/application/project"
	applicationresource "github.com/example/monorepo/canvas/internal/server/application/resource"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
)

type CanvasDeleter interface {
	DeleteByProject(context.Context, applicationcanvas.DeleteByProjectInput) error
}

type AssetDeleter interface {
	DeleteByOwner(context.Context, applicationasset.DeleteByOwnerInput) error
}

type ResourceDeleter interface {
	DeleteByProject(context.Context, applicationresource.DeleteByProjectInput) error
}

type Service struct {
	canvases  CanvasDeleter
	assets    AssetDeleter
	resources ResourceDeleter
}

func NewService(canvases CanvasDeleter, assets AssetDeleter, resources ResourceDeleter) *Service {
	return &Service{canvases: canvases, assets: assets, resources: resources}
}

func (s *Service) Cleanup(ctx context.Context, scope applicationproject.Scope, projectID string) error {
	canvasErr := s.canvases.DeleteByProject(ctx, applicationcanvas.DeleteByProjectInput{
		Scope: applicationcanvas.Scope{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
		},
		ProjectID: projectID,
	})
	assetErr := s.assets.DeleteByOwner(ctx, applicationasset.DeleteByOwnerInput{
		Scope: applicationasset.Scope{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
		},
		OwnerType: domainasset.OwnerProject,
		OwnerID:   projectID,
	})
	resourceErr := s.resources.DeleteByProject(ctx, applicationresource.DeleteByProjectInput{Scope: applicationresource.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID}, ProjectID: projectID})
	return errors.Join(canvasErr, assetErr, resourceErr)
}
