package canvas

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/plugin/soft_delete"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationcoverimage "github.com/example/monorepo/canvas/internal/application/coverimage"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

const maxActiveCanvasesPerProject = 100

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) dbFor(ctx context.Context) *gorm.DB {
	return persistencetransaction.DB(ctx, r.db)
}

func (r *Repository) Create(ctx context.Context, item domaincanvas.Canvas) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	err = r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		// Locking the parent project serializes the count-and-insert invariant across
		// all Canvas names, so concurrent creates cannot exceed the product limit.
		if err := lockProject(tx, item.TenantID, item.WorkspaceID, row.ProjectID); err != nil {
			return err
		}
		var count int64
		query := tx.Model(&canvasRow{}).
			Where("tenant_id = ? AND project_id = ?", item.TenantID, row.ProjectID)
		query = applyWorkspaceScope(query, item.WorkspaceID)
		if err := query.Count(&count).Error; err != nil {
			return err
		}
		if count >= maxActiveCanvasesPerProject {
			return applicationcanvas.ErrLimitExceeded
		}
		return tx.Create(&row).Error
	})
	return translateWriteError(err)
}

func (r *Repository) Get(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID string) (domaincanvas.Canvas, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return domaincanvas.Canvas{}, applicationcanvas.ErrNotFound
	}
	canvasUUID, err := persistenceid.Parse(canvasID)
	if err != nil {
		return domaincanvas.Canvas{}, applicationcanvas.ErrNotFound
	}
	db := r.dbFor(ctx)
	if err = findProject(db, scope.TenantID, scope.WorkspaceID, projectUUID); err != nil {
		return domaincanvas.Canvas{}, translateReadError(err)
	}
	var row canvasRow
	query := db.
		Where("id = ? AND tenant_id = ? AND project_id = ?", canvasUUID, scope.TenantID, projectUUID)
	query = applyWorkspaceScope(query, scope.WorkspaceID)
	if err := query.First(&row).Error; err != nil {
		return domaincanvas.Canvas{}, translateReadError(err)
	}
	return domainFromRow(row), nil
}

func (r *Repository) Validate(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID string) error {
	_, err := r.Get(ctx, scope, projectID, canvasID)
	return err
}

func (r *Repository) BatchGet(
	ctx context.Context,
	scope applicationcanvas.Scope,
	projectID string,
	canvasIDs []string,
) ([]domaincanvas.Canvas, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return []domaincanvas.Canvas{}, nil
	}
	ids := persistenceid.ParseValid(canvasIDs)
	if len(ids) == 0 {
		return []domaincanvas.Canvas{}, nil
	}
	db := r.dbFor(ctx)
	if err = findProject(db, scope.TenantID, scope.WorkspaceID, projectUUID); errors.Is(err, gorm.ErrRecordNotFound) {
		return []domaincanvas.Canvas{}, nil
	} else if err != nil {
		return nil, err
	}
	var rows []canvasRow
	query := db.
		Where("tenant_id = ? AND project_id = ? AND id IN ?", scope.TenantID, projectUUID, ids)
	query = applyWorkspaceScope(query, scope.WorkspaceID)
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	items := make([]domaincanvas.Canvas, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row))
	}
	return items, nil
}

func (r *Repository) List(ctx context.Context, query applicationcanvas.ListQuery) ([]domaincanvas.Canvas, int64, error) {
	projectID, err := persistenceid.Parse(query.ProjectID)
	if err != nil {
		return nil, 0, applicationcanvas.ErrNotFound
	}
	db := r.dbFor(ctx)
	if err := findProject(db, query.TenantID, query.WorkspaceID, projectID); err != nil {
		return nil, 0, translateReadError(err)
	}
	base := db.Model(&canvasRow{}).
		Where("tenant_id = ? AND project_id = ?", query.TenantID, projectID)
	base = applyWorkspaceScope(base, query.WorkspaceID)
	if query.CreatedBy != "" {
		base = base.Where("created_by = ?", query.CreatedBy)
	}
	if query.Keyword != "" {
		base = base.Where("name LIKE ?", "%"+query.Keyword+"%")
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	direction := "DESC"
	if query.SortDirection == applicationcanvas.SortAscending {
		direction = "ASC"
	}
	var rows []canvasRow
	offset := (query.PageNum - 1) * query.PageSize
	if err := base.Order("updated_at " + direction).Order("id " + direction).
		Offset(offset).Limit(query.PageSize).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	items := make([]domaincanvas.Canvas, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row))
	}
	return items, total, nil
}

func (r *Repository) Update(ctx context.Context, item domaincanvas.Canvas) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	err = r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockProject(tx, item.TenantID, item.WorkspaceID, row.ProjectID); err != nil {
			return err
		}
		var current canvasRow
		query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND tenant_id = ? AND project_id = ?", row.ID, item.TenantID, row.ProjectID)
		query = applyWorkspaceScope(query, item.WorkspaceID)
		if err := query.First(&current).Error; err != nil {
			return err
		}
		return tx.Model(&current).Updates(map[string]any{
			"name":                         item.Name,
			"cover_image_revision_id":      nullableString(item.CoverImageRevisionID),
			"cover_image_asset_id":         row.CoverImageAssetID,
			"cover_image_sha256":           nullableString(item.CoverImageSHA256),
			"cover_image_content_type":     nullableString(item.CoverImageContentType),
			"cover_image_size_bytes":       item.CoverImageSizeBytes,
			"cover_image_claim_generation": item.CoverImageClaimGeneration,
			"revision":                     item.Revision,
			"updated_at":                   item.UpdatedAt,
		}).Error
	})
	return translateWriteError(err)
}

func (r *Repository) UpdateView(
	ctx context.Context,
	scope applicationcanvas.Scope,
	projectID, canvasID string,
	defaultView *domaincanvas.ViewMode,
) error {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return applicationcanvas.ErrNotFound
	}
	canvasUUID, err := persistenceid.Parse(canvasID)
	if err != nil {
		return applicationcanvas.ErrNotFound
	}
	err = r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockProject(tx, scope.TenantID, scope.WorkspaceID, projectUUID); err != nil {
			return err
		}
		var current canvasRow
		query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND tenant_id = ? AND project_id = ?", canvasUUID, scope.TenantID, projectUUID)
		query = applyWorkspaceScope(query, scope.WorkspaceID)
		if err := query.First(&current).Error; err != nil {
			return err
		}
		return tx.Model(&current).UpdateColumn("default_view", int16(*defaultView)).Error
	})
	return translateWriteError(err)
}

func (r *Repository) Delete(ctx context.Context, item domaincanvas.Canvas) error {
	if item.DeletedAt == nil {
		return applicationcanvas.ErrNotFound
	}
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	err = r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockProject(tx, item.TenantID, item.WorkspaceID, row.ProjectID); err != nil {
			return err
		}
		var current canvasRow
		query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND tenant_id = ? AND project_id = ?", row.ID, item.TenantID, row.ProjectID)
		query = applyWorkspaceScope(query, item.WorkspaceID)
		if err := query.First(&current).Error; err != nil {
			return err
		}
		deletedAt := soft_delete.DeletedAt(item.DeletedAt.UnixMilli())
		if err := tx.Model(&current).Updates(map[string]any{
			"cover_image_revision_id": nil, "cover_image_asset_id": nil, "cover_image_sha256": nil,
			"cover_image_content_type":     nil,
			"cover_image_size_bytes":       0,
			"cover_image_claim_generation": 0,
			"revision":                     item.Revision, "updated_at": item.UpdatedAt, "deleted_at": deletedAt,
		}).Error; err != nil {
			return err
		}
		return nil
	})
	return translateWriteError(err)
}

func (r *Repository) DeleteByProject(
	ctx context.Context,
	scope applicationcanvas.Scope,
	projectID string,
	now time.Time,
) ([]applicationcanvas.DeletionTarget, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return nil, applicationcanvas.ErrNotFound
	}
	var targets []applicationcanvas.DeletionTarget
	err = r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []canvasRow
		query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id", "revision", "cover_image_revision_id", "cover_image_asset_id", "cover_image_sha256", "cover_image_content_type", "cover_image_size_bytes", "cover_image_claim_generation").
			Where("tenant_id = ? AND project_id = ?", scope.TenantID, projectUUID)
		query = applyWorkspaceScope(query, scope.WorkspaceID)
		if err := query.Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		ids := make([]persistenceid.UUID, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.ID)
			targets = append(targets, applicationcanvas.DeletionTarget{
				CanvasID: row.ID.String(), Revision: row.Revision,
				Cover: coverImageRegistrationFromRow(row),
			})
		}
		deletedAt := soft_delete.DeletedAt(now.UnixMilli())
		return tx.Model(&canvasRow{}).Where("id IN ?", ids).Updates(map[string]any{
			"cover_image_revision_id": nil, "cover_image_asset_id": nil, "cover_image_sha256": nil,
			"cover_image_content_type":     nil,
			"cover_image_size_bytes":       0,
			"cover_image_claim_generation": 0,
			"updated_at":                   now, "deleted_at": deletedAt,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return targets, nil
}

func (r *Repository) DeletionMatches(
	ctx context.Context,
	scope applicationcanvas.Scope,
	projectID, canvasID string,
	revision int64,
	deletedAt time.Time,
) (bool, error) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return false, nil
	}
	canvas, err := persistenceid.Parse(canvasID)
	if err != nil {
		return false, nil
	}
	query := r.dbFor(ctx).Unscoped().Model(&canvasRow{}).
		Where("id = ? AND project_id = ? AND tenant_id = ? AND revision = ? AND deleted_at = ?",
			canvas, project, scope.TenantID, revision, deletedAt.UnixMilli())
	query = applyWorkspaceScope(query, scope.WorkspaceID)
	var count int64
	if err = query.Count(&count).Error; err != nil {
		return false, err
	}
	return count == 1, nil
}

func coverImageRegistrationFromRow(row canvasRow) *applicationcoverimage.Registration {
	if row.CoverImageRevisionID == nil || row.CoverImageAssetID == nil || row.CoverImageSHA256 == nil || *row.CoverImageSHA256 == "" {
		return nil
	}
	return &applicationcoverimage.Registration{
		TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, Revision: applicationcoverimage.RevisionRef{AssetID: row.CoverImageAssetID.String(), RevisionID: *row.CoverImageRevisionID}, OwnerType: "canvas_cover", OwnerID: row.ID.String(), Generation: row.CoverImageClaimGeneration,
		SHA256: *row.CoverImageSHA256, ContentType: stringValue(row.CoverImageContentType),
		SizeBytes: row.CoverImageSizeBytes,
	}
}

type projectScopeRow struct {
	ID          persistenceid.UUID
	TenantID    string
	WorkspaceID *string
	DeletedAt   soft_delete.DeletedAt `gorm:"softDelete:milli"`
}

func (projectScopeRow) TableName() string { return "projects" }

func lockProject(db *gorm.DB, tenantID string, workspaceID *string, projectID persistenceid.UUID) error {
	return findProject(db.Clauses(clause.Locking{Strength: "UPDATE"}), tenantID, workspaceID, projectID)
}

func findProject(db *gorm.DB, tenantID string, workspaceID *string, projectID persistenceid.UUID) error {
	var project projectScopeRow
	query := db.Select("id").Where("id = ? AND tenant_id = ?", projectID, tenantID)
	query = applyWorkspaceScope(query, workspaceID)
	return query.First(&project).Error
}

func rowFromDomain(item domaincanvas.Canvas) (canvasRow, error) {
	id, err := persistenceid.Parse(item.ID)
	if err != nil {
		return canvasRow{}, fmt.Errorf("map Canvas ID: %w", err)
	}
	projectID, err := persistenceid.Parse(item.ProjectID)
	if err != nil {
		return canvasRow{}, fmt.Errorf("map Canvas Project ID: %w", err)
	}
	coverImageID, err := persistenceid.ParseOptional(item.CoverImageAssetID)
	if err != nil {
		return canvasRow{}, fmt.Errorf("map Canvas cover image ID: %w", err)
	}
	row := canvasRow{
		ID: id, TenantID: item.TenantID, WorkspaceID: cloneString(item.WorkspaceID),
		ProjectID: projectID, Name: item.Name,
		CoverImageRevisionID: nullableString(item.CoverImageRevisionID), CoverImageAssetID: coverImageID,
		CoverImageSHA256:      nullableString(item.CoverImageSHA256),
		CoverImageContentType: nullableString(item.CoverImageContentType),
		CoverImageSizeBytes:   item.CoverImageSizeBytes, CreatedBy: item.CreatedBy,
		CoverImageClaimGeneration: item.CoverImageClaimGeneration,
		DefaultView:               int16(item.DefaultView),
		Revision:                  item.Revision,
		CreatedAt:                 item.CreatedAt, UpdatedAt: item.UpdatedAt,
	}
	if item.DeletedAt != nil {
		row.DeletedAt = soft_delete.DeletedAt(item.DeletedAt.UnixMilli())
	}
	return row, nil
}

func domainFromRow(row canvasRow) domaincanvas.Canvas {
	item := domaincanvas.Canvas{
		ID: row.ID.String(), TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID),
		ProjectID: row.ProjectID.String(), Name: row.Name, CoverImageRevisionID: stringValue(row.CoverImageRevisionID),
		CoverImageAssetID: uuidStringValue(row.CoverImageAssetID), CoverImageSHA256: stringValue(row.CoverImageSHA256),
		CoverImageContentType:     stringValue(row.CoverImageContentType),
		CoverImageSizeBytes:       row.CoverImageSizeBytes,
		CoverImageClaimGeneration: row.CoverImageClaimGeneration,
		CreatedBy:                 row.CreatedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		CanvasNodeCount: row.CanvasNodeCount, SelectedVideoDurationMillis: row.SelectedVideoDurationMillis,
		DefaultView: domaincanvas.ViewMode(row.DefaultView), Revision: row.Revision,
	}
	if row.DeletedAt != 0 {
		deletedAt := time.UnixMilli(int64(row.DeletedAt)).UTC()
		item.DeletedAt = &deletedAt
	}
	return item
}

func uuidStringValue(value *persistenceid.UUID) string {
	if value == nil {
		return ""
	}
	return value.String()
}

func applyWorkspaceScope(db *gorm.DB, workspaceID *string) *gorm.DB {
	if workspaceID == nil {
		return db.Where("workspace_id IS NULL")
	}
	return db.Where("workspace_id = ?", *workspaceID)
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func translateReadError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return applicationcanvas.ErrNotFound
	}
	return err
}

func translateWriteError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, applicationcanvas.ErrNotFound), errors.Is(err, applicationcanvas.ErrLimitExceeded),
		errors.Is(err, applicationcanvas.ErrNameConflict), errors.Is(err, applicationcanvas.ErrRevisionConflict):
		return err
	case errors.Is(err, gorm.ErrRecordNotFound):
		return applicationcanvas.ErrNotFound
	case errors.Is(err, gorm.ErrDuplicatedKey):
		return applicationcanvas.ErrNameConflict
	default:
		return err
	}
}
