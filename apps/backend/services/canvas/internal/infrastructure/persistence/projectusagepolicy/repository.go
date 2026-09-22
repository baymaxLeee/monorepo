package projectusagepolicy

import (
	"context"
	"errors"
	"strings"

	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository struct{ db *gorm.DB }

func New(db *gorm.DB) *Repository { return &Repository{db: db} }

type row struct {
	ProjectID        string `gorm:"column:project_id;primaryKey"`
	TenantID         string `gorm:"column:tenant_id"`
	WorkspaceID      string `gorm:"column:workspace_id"`
	UsageLimitMicros *int64 `gorm:"column:usage_limit_micros"`
	UsedAmountMicros int64  `gorm:"column:used_amount_micros"`
	Currency         string `gorm:"column:currency"`
}

func (row) TableName() string { return "project_usage_policies" }

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
	item := row{ProjectID: projectID, TenantID: scope.TenantID, WorkspaceID: workspaceID, UsageLimitMicros: limit, Currency: "CNY"}
	err = persistencetransaction.DB(ctx, repository.db).Clauses(clause.OnConflict{DoNothing: true}).Create(&item).Error
	if err != nil {
		return applicationproject.ProjectUsagePolicy{}, err
	}
	return repository.value(item), nil
}

func (repository *Repository) Find(ctx context.Context, scope applicationproject.Scope, projectID string) (*applicationproject.ProjectUsagePolicy, error) {
	workspaceID, err := workspace(scope)
	if err != nil {
		return nil, err
	}
	var item row
	err = persistencetransaction.DB(ctx, repository.db).Where("project_id = ? AND tenant_id = ? AND workspace_id = ?", projectID, scope.TenantID, workspaceID).Take(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	value := repository.value(item)
	return &value, nil
}

func (repository *Repository) Update(ctx context.Context, scope applicationproject.Scope, current applicationproject.ProjectUsagePolicy, limit *int64) (applicationproject.ProjectUsagePolicy, error) {
	workspaceID, err := workspace(scope)
	if err != nil {
		return applicationproject.ProjectUsagePolicy{}, err
	}
	result := persistencetransaction.DB(ctx, repository.db).Model(&row{}).
		Where("project_id = ? AND tenant_id = ? AND workspace_id = ?", current.ProjectID, scope.TenantID, workspaceID).
		Update("usage_limit_micros", limit)
	if result.Error != nil {
		return applicationproject.ProjectUsagePolicy{}, result.Error
	}
	if result.RowsAffected == 0 {
		return applicationproject.ProjectUsagePolicy{}, gorm.ErrRecordNotFound
	}
	current.Limit = limit
	return current, nil
}

func (repository *Repository) Delete(ctx context.Context, scope applicationproject.Scope, id string) error {
	workspaceID, err := workspace(scope)
	if err != nil {
		return err
	}
	return persistencetransaction.DB(ctx, repository.db).Where("project_id = ? AND tenant_id = ? AND workspace_id = ?", id, scope.TenantID, workspaceID).Delete(&row{}).Error
}

func (*Repository) value(item row) applicationproject.ProjectUsagePolicy {
	return applicationproject.ProjectUsagePolicy{ID: item.ProjectID, ProjectID: item.ProjectID, Limit: item.UsageLimitMicros, UsedAmount: float64(item.UsedAmountMicros)}
}

var _ applicationproject.ProjectUsagePolicyGateway = (*Repository)(nil)
