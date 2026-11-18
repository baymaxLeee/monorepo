package projectstatistics

import (
	"context"

	applicationprojectstatistics "github.com/example/monorepo/canvas/internal/application/projectstatistics"
	domainresource "github.com/example/monorepo/canvas/internal/domain/resource"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Rebuilder struct {
	db *persistencetransaction.Store
}

func New(db *persistencetransaction.Store) *Rebuilder {
	return &Rebuilder{db: db}
}

func (r *Rebuilder) Rebuild(ctx context.Context, scope applicationprojectstatistics.Scope, projectID string, fields applicationprojectstatistics.Fields) error {
	fields &= applicationprojectstatistics.AllFields
	if fields == 0 {
		return nil
	}
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return err
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		key := sqlc.LockProjectStatisticsParams{ProjectID: projectUUID.String(), TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}
		// Acquire the row before reading aggregates so overlapping rebuilders see the latest committed child changes.
		if _, err := q.LockProjectStatistics(ctx, key); err != nil {
			return err
		}
		return q.RebuildProjectStatistics(ctx, sqlc.RebuildProjectStatisticsParams{
			ProjectID: key.ProjectID, TenantID: key.TenantID, WorkspaceID: key.WorkspaceID,
			UpdateCanvasCount:   fields.Has(applicationprojectstatistics.CanvasCountField),
			UpdateResourceCount: fields.Has(applicationprojectstatistics.ResourceCountField),
			UpdateDuration:      fields.Has(applicationprojectstatistics.SelectedVideoDurationField),
			ProjectOwnerType:    int16(domainresource.OwnerProject),
		})
	})
}
