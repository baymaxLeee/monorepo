package videogeneration

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	app "github.com/example/monorepo/canvas/internal/server/application/videogeneration"
)

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) dbFor(ctx context.Context) *gorm.DB {
	return persistencetransaction.DB(ctx, r.db)
}

func scopeQuery(db *gorm.DB, scope app.Scope) *gorm.DB {
	query := db.Where("tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return query.Where("workspace_id IS NULL")
	}
	return query.Where("workspace_id = ?", *scope.WorkspaceID)
}

func qualifiedScopeQuery(db *gorm.DB, table string, scope app.Scope) *gorm.DB {
	query := db.Where(table+".tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return query.Where(table + ".workspace_id IS NULL")
	}
	return query.Where(table+".workspace_id = ?", *scope.WorkspaceID)
}

// canvasCanvasNodeRow is only used so Select can honor canvas_nodes soft-delete
// while writing selected_output_id. Generation facts stay in this package.
type canvasCanvasNodeRow struct {
	SelectedAssetID *persistenceid.UUID
	DeletedAt       soft_delete.DeletedAt `gorm:"softDelete:milli"`
}

func (canvasCanvasNodeRow) TableName() string { return "canvas_nodes" }

func parseHistoryScopeIDs(projectID, canvasID, canvasnodeID string) (
	persistenceid.UUID,
	persistenceid.UUID,
	persistenceid.UUID,
	error,
) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return persistenceid.UUID{}, persistenceid.UUID{}, persistenceid.UUID{}, err
	}
	canvas, err := persistenceid.Parse(canvasID)
	if err != nil {
		return persistenceid.UUID{}, persistenceid.UUID{}, persistenceid.UUID{}, err
	}
	canvasnode, err := persistenceid.Parse(canvasnodeID)
	if err != nil {
		return persistenceid.UUID{}, persistenceid.UUID{}, persistenceid.UUID{}, err
	}
	return project, canvas, canvasnode, nil
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
