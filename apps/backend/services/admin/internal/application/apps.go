package application

import (
	"context"
	"strings"

	"github.com/example/monorepo/admin/internal/domain"
)

type AppService struct {
	Repository AppRepository
	Errors     ErrorClassifier
}

func (s AppService) List(ctx context.Context, a Actor) ([]domain.App, error) {
	return s.Repository.List(ctx, a.IsSuperAdmin(), a.IsSuperAdmin() || a.WorkspaceRole == "workspace_admin")
}
func (s AppService) Get(ctx context.Context, a Actor, id string) (domain.App, error) {
	value, err := s.Repository.Get(ctx, id)
	if s.Errors.IsNotFound(err) || err == nil && !a.IsSuperAdmin() && (!value.IsEnabled || (value.RequiresAdmin && a.WorkspaceRole != "workspace_admin")) {
		return domain.App{}, NotFound("app %s not found", id)
	}
	return value, err
}
func (s AppService) Create(ctx context.Context, a Actor, value domain.App) (domain.App, error) {
	if !a.IsSuperAdmin() {
		return domain.App{}, Forbidden("super_admin role required")
	}
	if err := validateApp(value); err != nil {
		return domain.App{}, err
	}
	_, err := s.Repository.Get(ctx, value.ID)
	if err == nil {
		return domain.App{}, Conflict("app " + value.ID + " already exists")
	}
	if !s.Errors.IsNotFound(err) {
		return domain.App{}, err
	}
	return s.Repository.Create(ctx, value)
}
func (s AppService) Update(ctx context.Context, a Actor, value domain.App) (domain.App, error) {
	if !a.IsSuperAdmin() {
		return domain.App{}, Forbidden("super_admin role required")
	}
	if err := validateApp(value); err != nil {
		return domain.App{}, err
	}
	return s.Repository.Save(ctx, value)
}
func (s AppService) Delete(ctx context.Context, a Actor, id string) error {
	if !a.IsSuperAdmin() {
		return Forbidden("super_admin role required")
	}
	if err := s.Repository.Delete(ctx, id); s.Errors.IsNotFound(err) {
		return NotFound("app %s not found", id)
	} else {
		return err
	}
}
func validateApp(a domain.App) error {
	if strings.TrimSpace(a.ID) == "" || strings.TrimSpace(a.Title) == "" || strings.TrimSpace(a.BasePath) == "" || strings.TrimSpace(a.RemoteName) == "" || strings.TrimSpace(a.ExposeKey) == "" {
		return BadRequest("required app fields must not be empty")
	}
	if a.SortOrder < 0 {
		return BadRequest("sort_order must be non-negative")
	}
	return nil
}
