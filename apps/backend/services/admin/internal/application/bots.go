package application

import (
	"context"
	"strings"

	"github.com/example/monorepo/admin/internal/domain"
)

type BotService struct {
	Repository BotRepository
	Providers  ProviderService
	Errors     ErrorClassifier
}

func (s BotService) List(ctx context.Context, a Actor) ([]domain.Bot, error) {
	return s.Repository.List(ctx, a.WorkspaceID, a.TenantID)
}
func (s BotService) Get(ctx context.Context, a Actor, id string) (domain.Bot, error) {
	b, err := s.Repository.Get(ctx, id, a.WorkspaceID, a.TenantID)
	if s.Errors.IsNotFound(err) {
		return b, NotFound("bot %s not found", id)
	}
	return b, err
}
func (s BotService) Create(ctx context.Context, a Actor, name string) (domain.Bot, error) {
	if err := RequireWorkspaceAdmin(a); err != nil {
		return domain.Bot{}, err
	}
	if strings.TrimSpace(name) == "" {
		return domain.Bot{}, BadRequest("name is required")
	}
	return s.Repository.Create(ctx, name, a.UserID, a.WorkspaceID, a.TenantID)
}
func (s BotService) Save(ctx context.Context, a Actor, b domain.Bot) (domain.Bot, error) {
	if err := RequireWorkspaceAdmin(a); err != nil {
		return b, err
	}
	for id, kind := range map[*string]string{b.TextProviderID: "chat", b.ImageProviderID: "image", b.VideoProviderID: "video"} {
		if id == nil {
			continue
		}
		p, err := s.Providers.Repository.Get(ctx, *id, a.WorkspaceID, a.TenantID)
		if err != nil || !p.IsEnabled || p.Kind != kind {
			return b, BadRequest("model provider is unavailable or has the wrong kind")
		}
	}
	return s.Repository.Save(ctx, b)
}
func (s BotService) Delete(ctx context.Context, a Actor, id string) error {
	if err := RequireWorkspaceAdmin(a); err != nil {
		return err
	}
	err := s.Repository.Delete(ctx, id, a.WorkspaceID, a.TenantID)
	if s.Errors.IsNotFound(err) {
		return NotFound("bot %s not found", id)
	}
	return err
}
func (s BotService) Skills(ctx context.Context, a Actor, id string, active bool) ([]domain.SkillSummary, error) {
	if _, err := s.Get(ctx, a, id); err != nil {
		return nil, err
	}
	return s.Repository.Skills(ctx, id, active)
}
func (s BotService) Attach(ctx context.Context, a Actor, id, skillID string) ([]domain.SkillSummary, error) {
	if err := RequireWorkspaceAdmin(a); err != nil {
		return nil, err
	}
	if _, err := s.Get(ctx, a, id); err != nil {
		return nil, err
	}
	if err := s.Repository.AttachSkill(ctx, id, skillID, a.WorkspaceID, a.TenantID); s.Errors.IsNotFound(err) {
		return nil, BadRequest("skill " + skillID + " not found")
	} else if err != nil {
		return nil, err
	}
	return s.Repository.Skills(ctx, id, false)
}
func (s BotService) Detach(ctx context.Context, a Actor, id, skillID string) ([]domain.SkillSummary, error) {
	if err := RequireWorkspaceAdmin(a); err != nil {
		return nil, err
	}
	if _, err := s.Get(ctx, a, id); err != nil {
		return nil, err
	}
	if err := s.Repository.DetachSkill(ctx, id, skillID); err != nil {
		return nil, err
	}
	return s.Repository.Skills(ctx, id, false)
}
