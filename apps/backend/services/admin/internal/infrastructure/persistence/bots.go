package persistence

import (
	"context"
	"encoding/json"

	"strings"
	"time"

	"github.com/example/monorepo/admin/internal/domain"
	"github.com/example/monorepo/admin/internal/infrastructure/persistence/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type BotRepository struct{ Pool *pgxpool.Pool }

func (r BotRepository) List(ctx context.Context, workspaceID, tenantID string) ([]domain.Bot, error) {
	rows, err := sqlc.New(r.Pool).ListBots(ctx, sqlc.ListBotsParams{WorkspaceID: workspaceID, TenantID: tenantID})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Bot, len(rows))
	for i, row := range rows {
		out[i] = toBot(sqlc.GetBotRow(row))
	}
	return out, nil
}
func (r BotRepository) Get(ctx context.Context, id, workspaceID, tenantID string) (domain.Bot, error) {
	row, err := sqlc.New(r.Pool).GetBot(ctx, sqlc.GetBotParams{ID: id, WorkspaceID: workspaceID, TenantID: tenantID})
	return toBot(row), err
}
func (r BotRepository) Create(ctx context.Context, name, userID, workspaceID, tenantID string) (domain.Bot, error) {
	now := time.Now().UTC()
	id := strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	row, err := sqlc.New(r.Pool).CreateBot(ctx, sqlc.CreateBotParams{ID: id, UserID: userID, WorkspaceID: workspaceID, TenantID: tenantID, Name: name, CreatedAt: now})
	return toBot(sqlc.GetBotRow(row)), err
}
func (r BotRepository) Save(ctx context.Context, b domain.Bot) (domain.Bot, error) {
	questions, _ := json.Marshal(b.SuggestedQuestions)
	row, err := sqlc.New(r.Pool).SaveBot(ctx, sqlc.SaveBotParams{
		ID:                 b.ID,
		Name:               b.Name,
		Status:             b.Status,
		RoleDescription:    b.RoleDescription,
		DomainDescription:  b.DomainDescription,
		Audience:           b.Audience,
		Tone:               b.Tone,
		WelcomeMessage:     b.WelcomeMessage,
		SuggestedQuestions: questions,
		TextProviderID:     b.TextProviderID,
		ImageProviderID:    b.ImageProviderID,
		VideoProviderID:    b.VideoProviderID,
		WorkspaceID:        b.WorkspaceID,
		TenantID:           b.TenantID,
	})
	return toBot(sqlc.GetBotRow(row)), err
}
func (r BotRepository) Delete(ctx context.Context, id, workspaceID, tenantID string) error {
	tag, err := sqlc.New(r.Pool).DeleteBot(ctx, sqlc.DeleteBotParams{ID: id, WorkspaceID: workspaceID, TenantID: tenantID})
	if err == nil && tag == 0 {
		return pgx.ErrNoRows
	}
	return err
}
func (r BotRepository) Skills(ctx context.Context, botID string, activeOnly bool) ([]domain.SkillSummary, error) {
	rows, err := sqlc.New(r.Pool).ListBotSkills(ctx, sqlc.ListBotSkillsParams{BotID: botID, ActiveOnly: activeOnly})
	if err != nil {
		return nil, err
	}
	out := make([]domain.SkillSummary, len(rows))
	for i, row := range rows {
		out[i] = toSkillSummary(row)
	}
	return out, nil
}
func (r BotRepository) AttachSkill(ctx context.Context, botID, skillID, workspaceID, tenantID string) error {
	var exists bool
	exists, err := sqlc.New(r.Pool).SkillExists(ctx, sqlc.SkillExistsParams{ID: skillID, WorkspaceID: workspaceID, TenantID: tenantID})
	if err != nil {
		return err
	}
	if !exists {
		return pgx.ErrNoRows
	}
	err = sqlc.New(r.Pool).AttachBotSkill(ctx, sqlc.AttachBotSkillParams{BotID: botID, SkillID: skillID})
	return err
}
func (r BotRepository) DetachSkill(ctx context.Context, botID, skillID string) error {
	return sqlc.New(r.Pool).DetachBotSkill(ctx, sqlc.DetachBotSkillParams{BotID: botID, SkillID: skillID})
}

func toBot(row sqlc.GetBotRow) domain.Bot {
	value := domain.Bot{
		ID:                row.ID,
		UserID:            row.UserID,
		WorkspaceID:       row.WorkspaceID,
		TenantID:          row.TenantID,
		Name:              row.Name,
		Status:            row.Status,
		RoleDescription:   row.RoleDescription,
		DomainDescription: row.DomainDescription,
		Audience:          row.Audience,
		Tone:              row.Tone,
		WelcomeMessage:    row.WelcomeMessage,
		TextProviderID:    row.TextProviderID,
		ImageProviderID:   row.ImageProviderID,
		VideoProviderID:   row.VideoProviderID,
		CreatedAt:         row.CreatedAt,
		UpdatedAt:         row.UpdatedAt,
	}
	_ = json.Unmarshal(row.SuggestedQuestions, &value.SuggestedQuestions)
	return value
}

func toSkillSummary(row sqlc.ListBotSkillsRow) domain.SkillSummary {
	value := domain.SkillSummary{
		ID:                    row.ID,
		UserID:                row.UserID,
		WorkspaceID:           row.WorkspaceID,
		TenantID:              row.TenantID,
		Username:              row.Username,
		Name:                  row.Name,
		Description:           row.Description,
		Status:                row.Status,
		IsEnabled:             row.IsEnabled,
		HasUnpublishedChanges: row.HasUnpublishedChanges,
		PublishedAt:           row.PublishedAt,
		CreatedAt:             row.CreatedAt,
		UpdatedAt:             row.UpdatedAt,
	}
	return value
}
