package persistence

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/example/monorepo/admin/internal/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type BotRepository struct{ Pool *pgxpool.Pool }

const botColumns = `id,user_id,workspace_id,tenant_id,name,status,role_description,domain_description,audience,tone,welcome_message,suggested_questions,text_provider_id,image_provider_id,video_provider_id,created_at,updated_at`

func scanBot(row scanner) (domain.Bot, error) {
	var b domain.Bot
	var questions []byte
	err := row.Scan(&b.ID, &b.UserID, &b.WorkspaceID, &b.TenantID, &b.Name, &b.Status, &b.RoleDescription, &b.DomainDescription, &b.Audience, &b.Tone, &b.WelcomeMessage, &questions, &b.TextProviderID, &b.ImageProviderID, &b.VideoProviderID, &b.CreatedAt, &b.UpdatedAt)
	if err == nil {
		_ = json.Unmarshal(questions, &b.SuggestedQuestions)
	}
	return b, err
}
func (r BotRepository) List(ctx context.Context, workspaceID, tenantID string) ([]domain.Bot, error) {
	rows, err := r.Pool.Query(ctx, `SELECT `+botColumns+` FROM bots WHERE workspace_id=$1 AND tenant_id=$2 ORDER BY created_at`, workspaceID, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Bot{}
	for rows.Next() {
		b, err := scanBot(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
func (r BotRepository) Get(ctx context.Context, id, workspaceID, tenantID string) (domain.Bot, error) {
	return scanBot(r.Pool.QueryRow(ctx, `SELECT `+botColumns+` FROM bots WHERE id=$1 AND workspace_id=$2 AND tenant_id=$3`, id, workspaceID, tenantID))
}
func (r BotRepository) Create(ctx context.Context, name, userID, workspaceID, tenantID string) (domain.Bot, error) {
	now := time.Now().UTC()
	id := strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	return scanBot(r.Pool.QueryRow(ctx, `INSERT INTO bots(id,user_id,workspace_id,tenant_id,name,status,tone,suggested_questions,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'draft','professional','[]',$6,$6) RETURNING `+botColumns, id, userID, workspaceID, tenantID, name, now))
}
func (r BotRepository) Save(ctx context.Context, b domain.Bot) (domain.Bot, error) {
	questions, _ := json.Marshal(b.SuggestedQuestions)
	return scanBot(r.Pool.QueryRow(ctx, `UPDATE bots SET name=$2,status=$3,role_description=$4,domain_description=$5,audience=$6,tone=$7,welcome_message=$8,suggested_questions=$9,text_provider_id=$10,image_provider_id=$11,video_provider_id=$12,updated_at=now() WHERE id=$1 AND workspace_id=$13 AND tenant_id=$14 RETURNING `+botColumns, b.ID, b.Name, b.Status, b.RoleDescription, b.DomainDescription, b.Audience, b.Tone, b.WelcomeMessage, questions, b.TextProviderID, b.ImageProviderID, b.VideoProviderID, b.WorkspaceID, b.TenantID))
}
func (r BotRepository) Delete(ctx context.Context, id, workspaceID, tenantID string) error {
	tag, err := r.Pool.Exec(ctx, `DELETE FROM bots WHERE id=$1 AND workspace_id=$2 AND tenant_id=$3`, id, workspaceID, tenantID)
	if err == nil && tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return err
}
func (r BotRepository) Skills(ctx context.Context, botID string, activeOnly bool) ([]domain.SkillSummary, error) {
	filter := ""
	if activeOnly {
		filter = " AND s.status='published' AND s.is_enabled"
	}
	rows, err := r.Pool.Query(ctx, `SELECT s.id,s.user_id,s.workspace_id,s.tenant_id,s.username,s.name,s.description,s.status,s.is_enabled,s.workspace_sha256 IS DISTINCT FROM s.published_sha256,s.published_at,s.created_at,s.updated_at FROM skills s JOIN bot_skills b ON b.skill_id=s.id WHERE b.bot_id=$1`+filter+` ORDER BY b.sort,s.updated_at DESC`, botID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.SkillSummary{}
	for rows.Next() {
		var s domain.SkillSummary
		if err := rows.Scan(&s.ID, &s.UserID, &s.WorkspaceID, &s.TenantID, &s.Username, &s.Name, &s.Description, &s.Status, &s.IsEnabled, &s.HasUnpublishedChanges, &s.PublishedAt, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
func (r BotRepository) AttachSkill(ctx context.Context, botID, skillID, workspaceID, tenantID string) error {
	var exists bool
	if err := r.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM skills WHERE id=$1 AND workspace_id=$2 AND tenant_id=$3)`, skillID, workspaceID, tenantID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return pgx.ErrNoRows
	}
	_, err := r.Pool.Exec(ctx, `INSERT INTO bot_skills(bot_id,skill_id,sort) VALUES($1,$2,0) ON CONFLICT DO NOTHING`, botID, skillID)
	return err
}
func (r BotRepository) DetachSkill(ctx context.Context, botID, skillID string) error {
	_, err := r.Pool.Exec(ctx, `DELETE FROM bot_skills WHERE bot_id=$1 AND skill_id=$2`, botID, skillID)
	return err
}

var _ = errors.Is
