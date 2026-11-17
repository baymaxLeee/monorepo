package persistence

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CanvasSettingsRepository struct{ Pool *pgxpool.Pool }

func (r CanvasSettingsRepository) Get(ctx context.Context, workspaceID, tenantID string) (application.CanvasSettings, error) {
	var revision int
	var raw string
	err := r.Pool.QueryRow(ctx, `SELECT revision,defaults_json FROM canvas_settings WHERE workspace_id=$1 AND tenant_id=$2`, workspaceID, tenantID).Scan(&revision, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return application.CanvasSettings{Defaults: json.RawMessage(`{"inference":null,"image":null,"video":null}`)}, nil
	}
	return application.CanvasSettings{Revision: revision, Defaults: json.RawMessage(raw)}, err
}

func (r CanvasSettingsRepository) Update(ctx context.Context, actor application.Actor, expected int, defaults json.RawMessage) (application.CanvasSettings, error) {
	raw := string(defaults)
	var tag pgconn.CommandTag
	var err error
	if expected == 0 {
		tag, err = r.Pool.Exec(ctx, `INSERT INTO canvas_settings(workspace_id,tenant_id,revision,defaults_json,updated_by,updated_at) VALUES($1,$2,1,$3,$4,now()) ON CONFLICT DO NOTHING`, actor.WorkspaceID, actor.TenantID, raw, actor.UserID)
	} else {
		tag, err = r.Pool.Exec(ctx, `UPDATE canvas_settings SET revision=$3+1,defaults_json=$4,updated_by=$5,updated_at=now() WHERE workspace_id=$1 AND tenant_id=$2 AND revision=$3`, actor.WorkspaceID, actor.TenantID, expected, raw, actor.UserID)
	}
	if err != nil {
		return application.CanvasSettings{}, err
	}
	if tag.RowsAffected() == 0 {
		return application.CanvasSettings{}, application.Conflict("Canvas settings changed; reload before saving")
	}
	return application.CanvasSettings{Revision: expected + 1, Defaults: defaults}, nil
}
