package persistence

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CanvasSettingsRepository struct{ Pool *pgxpool.Pool }

func (r CanvasSettingsRepository) Get(ctx context.Context, workspaceID, tenantID string) (application.CanvasSettings, error) {
	row, err := sqlc.New(r.Pool).GetCanvasSettings(ctx, sqlc.GetCanvasSettingsParams{
		WorkspaceID: workspaceID, TenantID: tenantID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return application.CanvasSettings{Defaults: json.RawMessage(`{"inference":null,"image":null,"video":null}`)}, nil
	}
	return application.CanvasSettings{Revision: int(row.Revision), Defaults: json.RawMessage(row.DefaultsJson)}, err
}

func (r CanvasSettingsRepository) Update(ctx context.Context, actor application.Actor, expected int, defaults json.RawMessage) (application.CanvasSettings, error) {
	queries := sqlc.New(r.Pool)
	var count int64
	var err error
	if expected == 0 {
		count, err = queries.CreateCanvasSettings(ctx, sqlc.CreateCanvasSettingsParams{
			WorkspaceID: actor.WorkspaceID, TenantID: actor.TenantID,
			DefaultsJson: string(defaults), UpdatedBy: actor.UserID,
		})
	} else {
		count, err = queries.UpdateCanvasSettings(ctx, sqlc.UpdateCanvasSettingsParams{
			WorkspaceID: actor.WorkspaceID, TenantID: actor.TenantID, Revision: int64(expected),
			DefaultsJson: string(defaults), UpdatedBy: actor.UserID,
		})
	}
	if err != nil {
		return application.CanvasSettings{}, err
	}
	if count == 0 {
		return application.CanvasSettings{}, application.Conflict("Canvas settings changed; reload before saving")
	}
	return application.CanvasSettings{Revision: expected + 1, Defaults: defaults}, nil
}
