package scopelifecycle

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	"github.com/jackc/pgx/v5"
)

type Repository struct{ db *transaction.Store }

func NewRepository(db *transaction.Store) *Repository { return &Repository{db: db} }
func fenceID(tenantID string, workspaceID *string) string {
	key := tenantID + "\x00tenant"
	if workspaceID != nil {
		key = tenantID + "\x00workspace\x00" + *workspaceID
	}
	hash := sha256.Sum256([]byte(key))
	return hex.EncodeToString(hash[:])
}

// LockActive holds shared locks until the writer commits, always admitting the tenant first.
func LockActive(ctx context.Context, store *transaction.Store, tenantID string, workspaceID *string) error {
	if tenantID == "" || workspaceID != nil && *workspaceID == "" {
		return pgx.ErrNoRows
	}
	q := store.Queries(ctx)
	check := func(workspace *string) error {
		id := fenceID(tenantID, workspace)
		active, err := q.ReadScopeFence(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			if err = q.EnsureScopeFence(ctx, sqlc.EnsureScopeFenceParams{ID: id, TenantID: tenantID, WorkspaceID: workspace}); err != nil {
				return err
			}
			active, err = q.ReadScopeFence(ctx, id)
		}
		if err == nil && !active {
			return pgx.ErrNoRows
		}
		return err
	}
	if err := check(nil); err != nil {
		return err
	}
	if workspaceID != nil {
		return check(workspaceID)
	}
	return nil
}

func (r *Repository) Close(ctx context.Context, tenantID string, workspaceID *string) error {
	if tenantID == "" || workspaceID != nil && *workspaceID == "" {
		return errors.New("invalid deletion scope")
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		id := fenceID(tenantID, workspaceID)
		if err := q.EnsureScopeFence(ctx, sqlc.EnsureScopeFenceParams{ID: id, TenantID: tenantID, WorkspaceID: workspaceID}); err != nil {
			return err
		}
		return q.CloseScopeFence(ctx, id)
	})
}
