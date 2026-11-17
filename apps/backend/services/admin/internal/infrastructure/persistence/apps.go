package persistence

import (
	"context"
	"errors"
	"time"

	"github.com/example/monorepo/admin/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AppRepository struct{ Pool *pgxpool.Pool }

const appColumns = `id,title,base_path,remote_name,expose_key,entry,requires_admin,is_enabled,sort_order,created_at,updated_at`

func scanApp(row scanner) (domain.App, error) {
	var a domain.App
	err := row.Scan(&a.ID, &a.Title, &a.BasePath, &a.RemoteName, &a.ExposeKey, &a.Entry, &a.RequiresAdmin, &a.IsEnabled, &a.SortOrder, &a.CreatedAt, &a.UpdatedAt)
	return a, err
}
func (r AppRepository) List(ctx context.Context, includeDisabled, includeAdmin bool) ([]domain.App, error) {
	query := `SELECT ` + appColumns + ` FROM apps WHERE ($1 OR is_enabled) AND ($2 OR NOT requires_admin) ORDER BY sort_order,title`
	rows, err := r.Pool.Query(ctx, query, includeDisabled, includeAdmin)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.App{}
	for rows.Next() {
		a, err := scanApp(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
func (r AppRepository) Get(ctx context.Context, id string) (domain.App, error) {
	return scanApp(r.Pool.QueryRow(ctx, `SELECT `+appColumns+` FROM apps WHERE id=$1`, id))
}
func (r AppRepository) Create(ctx context.Context, a domain.App) (domain.App, error) {
	now := time.Now().UTC()
	return scanApp(r.Pool.QueryRow(ctx, `INSERT INTO apps (`+appColumns+`) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING `+appColumns, a.ID, a.Title, a.BasePath, a.RemoteName, a.ExposeKey, a.Entry, a.RequiresAdmin, a.IsEnabled, a.SortOrder, now))
}
func (r AppRepository) Save(ctx context.Context, a domain.App) (domain.App, error) {
	return scanApp(r.Pool.QueryRow(ctx, `UPDATE apps SET title=$2,base_path=$3,remote_name=$4,expose_key=$5,entry=$6,requires_admin=$7,is_enabled=$8,sort_order=$9,updated_at=now() WHERE id=$1 RETURNING `+appColumns, a.ID, a.Title, a.BasePath, a.RemoteName, a.ExposeKey, a.Entry, a.RequiresAdmin, a.IsEnabled, a.SortOrder))
}
func (r AppRepository) Delete(ctx context.Context, id string) error {
	tag, err := r.Pool.Exec(ctx, `DELETE FROM apps WHERE id=$1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return err
}
func IsNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

type ErrorClassifier struct{}

func (ErrorClassifier) IsNotFound(err error) bool { return IsNoRows(err) }
