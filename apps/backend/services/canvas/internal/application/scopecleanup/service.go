package scopecleanup

import (
	"context"
	"errors"
	"fmt"
)

var ErrInvalidScope = errors.New("invalid IAM deletion scope")

type TenantCleaner interface {
	DeleteByTenant(context.Context, string, string) error
}

type ScopeCleaner interface {
	TenantCleaner
	DeleteByWorkspace(context.Context, string, string, string) error
}

type ClearReporter interface {
	ReportTenantClear(context.Context, string, string) error
	ReportWorkspaceClear(context.Context, string, string, string) error
}

type Service struct {
	fence           Fence
	benefitPackages TenantCleaner
	defaultModels   TenantCleaner
	projects        ScopeCleaner
	official        ScopeCleaner
	agents          ScopeCleaner
	assets          ScopeCleaner
	reporter        ClearReporter
}

type Fence interface {
	Close(context.Context, string, *string) error
}

func NewService(
	fence Fence,
	benefitPackages TenantCleaner,
	defaultModels TenantCleaner,
	projects ScopeCleaner,
	official ScopeCleaner,
	agents ScopeCleaner,
	assets ScopeCleaner,
	reporter ClearReporter,
) *Service {
	return &Service{
		fence:           fence,
		benefitPackages: benefitPackages,
		defaultModels:   defaultModels,
		projects:        projects,
		official:        official,
		agents:          agents,
		assets:          assets,
		reporter:        reporter,
	}
}

func (s *Service) DeleteTenant(ctx context.Context, tenantID, operatorID string) error {
	if tenantID == "" || operatorID == "" {
		return ErrInvalidScope
	}
	if err := s.fence.Close(ctx, tenantID, nil); err != nil {
		return err
	}
	steps := []struct {
		name string
		run  func() error
	}{
		{name: "delete tenant benefit packages", run: func() error {
			return s.benefitPackages.DeleteByTenant(ctx, tenantID, operatorID)
		}},
		{name: "delete tenant default models", run: func() error {
			return s.defaultModels.DeleteByTenant(ctx, tenantID, operatorID)
		}},
		{name: "delete tenant projects", run: func() error {
			return s.projects.DeleteByTenant(ctx, tenantID, operatorID)
		}},
		{name: "delete tenant official resources", run: func() error {
			return s.official.DeleteByTenant(ctx, tenantID, operatorID)
		}},
		{name: "delete tenant personal agents", run: func() error {
			return s.agents.DeleteByTenant(ctx, tenantID, operatorID)
		}},
		{name: "delete tenant assets", run: func() error {
			return s.assets.DeleteByTenant(ctx, tenantID, operatorID)
		}},
		{name: "report tenant clear", run: func() error {
			return s.reporter.ReportTenantClear(ctx, tenantID, operatorID)
		}},
	}
	return runSteps(steps)
}

func (s *Service) DeleteWorkspace(ctx context.Context, tenantID, workspaceID, operatorID string) error {
	if tenantID == "" || workspaceID == "" || operatorID == "" {
		return ErrInvalidScope
	}
	if err := s.fence.Close(ctx, tenantID, &workspaceID); err != nil {
		return err
	}
	steps := []struct {
		name string
		run  func() error
	}{
		{name: "delete workspace projects", run: func() error {
			return s.projects.DeleteByWorkspace(ctx, tenantID, workspaceID, operatorID)
		}},
		{name: "delete workspace official resources", run: func() error {
			return s.official.DeleteByWorkspace(ctx, tenantID, workspaceID, operatorID)
		}},
		{name: "delete workspace personal agents", run: func() error {
			return s.agents.DeleteByWorkspace(ctx, tenantID, workspaceID, operatorID)
		}},
		{name: "delete workspace assets", run: func() error {
			return s.assets.DeleteByWorkspace(ctx, tenantID, workspaceID, operatorID)
		}},
		{name: "report workspace clear", run: func() error {
			return s.reporter.ReportWorkspaceClear(ctx, tenantID, workspaceID, operatorID)
		}},
	}
	return runSteps(steps)
}

func runSteps(steps []struct {
	name string
	run  func() error
}) error {
	for _, step := range steps {
		if err := step.run(); err != nil {
			return fmt.Errorf("%s: %w", step.name, err)
		}
	}
	return nil
}
