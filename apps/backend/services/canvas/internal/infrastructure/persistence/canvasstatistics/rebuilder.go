package canvasstatistics

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	applicationcanvasnode "github.com/example/monorepo/canvas/internal/application/canvas"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Rebuilder struct {
	db *transaction.Store
}

func New(db *transaction.Store) *Rebuilder {
	return &Rebuilder{db: db}
}

func (p *Rebuilder) Rebuild(ctx context.Context, scope applicationcanvasnode.Scope, projectID, canvasID string) error {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return err
	}
	canvasUUID, err := persistenceid.Parse(canvasID)
	if err != nil {
		return err
	}
	return p.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := p.db.Queries(ctx)
		key := sqlc.LockCanvasStatisticsParams{CanvasID: canvasUUID.String(), ProjectID: projectUUID.String(), TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}
		if _, err := q.LockCanvasStatistics(ctx, key); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		return q.RebuildCanvasStatistics(ctx, sqlc.RebuildCanvasStatisticsParams{
			CanvasID: key.CanvasID, ProjectID: key.ProjectID, TenantID: key.TenantID, WorkspaceID: key.WorkspaceID,
			NodeType: int16(domaincanvas.NodeTypeVideoGeneration),
		})
	})
}
