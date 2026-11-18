package persistence

import (
	"context"
	"errors"
	"time"

	"github.com/example/monorepo/admin/internal/domain"
	"github.com/example/monorepo/admin/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AppRepository struct{ Pool *pgxpool.Pool }

func appFromRow(row sqlc.App) domain.App {
	return domain.App{
		ID: row.ID, Title: row.Title, BasePath: row.BasePath, RemoteName: row.RemoteName,
		ExposeKey: row.ExposeKey, Entry: row.Entry, RequiresAdmin: row.RequiresAdmin,
		IsEnabled: row.IsEnabled, SortOrder: int(row.SortOrder), CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}
}

func (r AppRepository) List(ctx context.Context, includeDisabled, includeAdmin bool) ([]domain.App, error) {
	rows, err := sqlc.New(r.Pool).ListApps(ctx, sqlc.ListAppsParams{
		IncludeDisabled: includeDisabled, IncludeAdmin: includeAdmin,
	})
	if err != nil {
		return nil, err
	}
	apps := make([]domain.App, len(rows))
	for i, row := range rows {
		apps[i] = appFromRow(row)
	}
	return apps, nil
}

func (r AppRepository) Get(ctx context.Context, id string) (domain.App, error) {
	row, err := sqlc.New(r.Pool).GetApp(ctx, id)
	return appFromRow(row), err
}

func (r AppRepository) Create(ctx context.Context, a domain.App) (domain.App, error) {
	row, err := sqlc.New(r.Pool).CreateApp(ctx, sqlc.CreateAppParams{
		ID: a.ID, Title: a.Title, BasePath: a.BasePath, RemoteName: a.RemoteName, ExposeKey: a.ExposeKey,
		Entry: a.Entry, RequiresAdmin: a.RequiresAdmin, IsEnabled: a.IsEnabled, SortOrder: int64(a.SortOrder),
		CreatedAt: time.Now().UTC(),
	})
	return appFromRow(row), err
}

func (r AppRepository) Save(ctx context.Context, a domain.App) (domain.App, error) {
	row, err := sqlc.New(r.Pool).UpdateApp(ctx, sqlc.UpdateAppParams{
		ID: a.ID, Title: a.Title, BasePath: a.BasePath, RemoteName: a.RemoteName, ExposeKey: a.ExposeKey,
		Entry: a.Entry, RequiresAdmin: a.RequiresAdmin, IsEnabled: a.IsEnabled, SortOrder: int64(a.SortOrder),
	})
	return appFromRow(row), err
}

func (r AppRepository) Delete(ctx context.Context, id string) error {
	count, err := sqlc.New(r.Pool).DeleteApp(ctx, id)
	if err == nil && count == 0 {
		return pgx.ErrNoRows
	}
	return err
}
func IsNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

type ErrorClassifier struct{}

func (ErrorClassifier) IsNotFound(err error) bool { return IsNoRows(err) }
