package projectusagepolicy

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *persistencetransaction.Store }

func New(db *persistencetransaction.Store) *Repository { return &Repository{db: db} }

func workspace(scope applicationproject.Scope) (string, error) {
	if scope.WorkspaceID == nil || strings.TrimSpace(*scope.WorkspaceID) == "" {
		return "", errors.New("workspace is required")
	}
	return strings.TrimSpace(*scope.WorkspaceID), nil
}

func (repository *Repository) Create(ctx context.Context, scope applicationproject.Scope, projectID string, limit *int64) (applicationproject.ProjectUsagePolicy, error) {
	workspaceID, err := workspace(scope)
	if err != nil {
		return applicationproject.ProjectUsagePolicy{}, err
	}
	err = repository.db.Queries(ctx).CreateProjectUsagePolicy(ctx, sqlc.CreateProjectUsagePolicyParams{ProjectID: projectID, TenantID: scope.TenantID, WorkspaceID: workspaceID, UsageLimitMicros: limit})
	if err != nil {
		return applicationproject.ProjectUsagePolicy{}, err
	}
	return applicationproject.ProjectUsagePolicy{ID: projectID, ProjectID: projectID, Limit: limit}, nil
}

func (repository *Repository) Find(ctx context.Context, scope applicationproject.Scope, projectID string) (*applicationproject.ProjectUsagePolicy, error) {
	workspaceID, err := workspace(scope)
	if err != nil {
		return nil, err
	}
	item, err := repository.db.Queries(ctx).FindProjectUsagePolicy(ctx, sqlc.FindProjectUsagePolicyParams{ProjectID: projectID, TenantID: scope.TenantID, WorkspaceID: workspaceID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	value := applicationproject.ProjectUsagePolicy{ID: item.ProjectID, ProjectID: item.ProjectID, Limit: item.UsageLimitMicros, UsedAmount: float64(item.UsedAmountMicros)}
	return &value, nil
}

func (repository *Repository) Update(ctx context.Context, scope applicationproject.Scope, current applicationproject.ProjectUsagePolicy, limit *int64) (applicationproject.ProjectUsagePolicy, error) {
	workspaceID, err := workspace(scope)
	if err != nil {
		return applicationproject.ProjectUsagePolicy{}, err
	}
	count, err := repository.db.Queries(ctx).UpdateProjectUsageLimit(ctx, sqlc.UpdateProjectUsageLimitParams{ProjectID: current.ProjectID, TenantID: scope.TenantID, WorkspaceID: workspaceID, UsageLimitMicros: limit})
	if err != nil {
		return applicationproject.ProjectUsagePolicy{}, err
	}
	if count == 0 {
		return applicationproject.ProjectUsagePolicy{}, pgx.ErrNoRows
	}
	current.Limit = limit
	return current, nil
}

func (repository *Repository) Delete(ctx context.Context, scope applicationproject.Scope, id string) error {
	workspaceID, err := workspace(scope)
	if err != nil {
		return err
	}
	return repository.db.Queries(ctx).DeleteProjectUsagePolicy(ctx, sqlc.DeleteProjectUsagePolicyParams{ProjectID: id, TenantID: scope.TenantID, WorkspaceID: workspaceID})
}

var _ applicationproject.ProjectUsagePolicyGateway = (*Repository)(nil)
