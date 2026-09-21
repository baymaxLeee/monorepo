package projectstatistics

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	applicationprojectstatistics "github.com/example/monorepo/canvas/internal/server/application/projectstatistics"
	domainresource "github.com/example/monorepo/canvas/internal/server/domain/resource"
)

type Rebuilder struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Rebuilder {
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
	db := persistencetransaction.DB(ctx, r.db)
	return db.Transaction(func(tx *gorm.DB) error {
		return r.rebuild(tx, scope, projectUUID, fields)
	})
}

func (r *Rebuilder) rebuild(db *gorm.DB, scope applicationprojectstatistics.Scope, projectUUID persistenceid.UUID, fields applicationprojectstatistics.Fields) error {
	// Serialize rebuilders on the Project row. Canvas and Asset mutations commit
	// independently, but a slower older rebuild must not overwrite a newer snapshot.
	var project struct{ ID persistenceid.UUID }
	projects := scopedQuery(db.Table("projects"), scope, "projects").
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id").
		Where("id = ? AND deleted_at = 0", projectUUID)
	if err := projects.Take(&project).Error; err != nil {
		return err
	}

	updates := make(map[string]any, 3)
	if fields.Has(applicationprojectstatistics.CanvasCountField) || fields.Has(applicationprojectstatistics.SelectedVideoDurationField) {
		var canvasStatistics struct {
			CanvasCount                 int32
			SelectedVideoDurationMillis int64
		}
		selects := make([]string, 0, 2)
		if fields.Has(applicationprojectstatistics.CanvasCountField) {
			selects = append(selects, "COUNT(id) AS canvas_count")
		}
		if fields.Has(applicationprojectstatistics.SelectedVideoDurationField) {
			selects = append(selects, "COALESCE(SUM(selected_video_duration_millis), 0) AS selected_video_duration_millis")
		}
		canvases := scopedQuery(db.Table("canvases"), scope, "canvases").
			Select(selects).
			Where("project_id = ? AND deleted_at = 0", projectUUID)
		if err := canvases.Scan(&canvasStatistics).Error; err != nil {
			return err
		}
		if fields.Has(applicationprojectstatistics.CanvasCountField) {
			updates["canvas_count"] = canvasStatistics.CanvasCount
		}
		if fields.Has(applicationprojectstatistics.SelectedVideoDurationField) {
			updates["selected_video_duration_millis"] = canvasStatistics.SelectedVideoDurationMillis
		}
	}

	if fields.Has(applicationprojectstatistics.ResourceCountField) {
		var resourceStatistics struct{ ResourceCount int32 }
		resources := scopedQuery(db.Table("resources"), scope, "resources").
			Select("COUNT(id) AS resource_count").
			Where("owner_type = ? AND owner_id = ? AND deleted_at = 0", domainresource.OwnerProject, projectUUID)
		if err := resources.Scan(&resourceStatistics).Error; err != nil {
			return err
		}
		updates["resource_count"] = resourceStatistics.ResourceCount
	}

	projects = scopedQuery(db.Table("projects"), scope, "projects").
		Where("id = ? AND deleted_at = 0", projectUUID)
	return projects.Updates(updates).Error
}

func scopedQuery(db *gorm.DB, scope applicationprojectstatistics.Scope, table string) *gorm.DB {
	db = db.Where(table+".tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return db.Where(table + ".workspace_id IS NULL")
	}
	return db.Where(table+".workspace_id = ?", *scope.WorkspaceID)
}
