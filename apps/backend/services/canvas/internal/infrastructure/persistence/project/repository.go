package project

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/plugin/soft_delete"

	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	domainproject "github.com/example/monorepo/canvas/internal/domain/project"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	scopelifecycle "github.com/example/monorepo/canvas/internal/infrastructure/persistence/scopelifecycle"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, project domainproject.Project) error {
	row, err := rowFromDomain(project)
	if err != nil {
		return err
	}
	members := memberRowsFromDomain(project, row.ID)
	err = persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		if err := scopelifecycle.LockActive(tx, project.TenantID, project.WorkspaceID); err != nil {
			return err
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		if len(members) == 0 {
			return nil
		}
		return tx.Create(&members).Error
	})
	return translateWriteError(err)
}

func (r *Repository) Update(ctx context.Context, project domainproject.Project) error {
	row, err := rowFromDomain(project)
	if err != nil {
		return err
	}
	members := memberRowsFromDomain(project, row.ID)
	err = persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		var current projectRow
		query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND tenant_id = ?", row.ID, project.TenantID)
		query = applyWorkspaceScope(query, clause.Column{Name: "workspace_id"}, project.WorkspaceID)
		if err := query.First(&current).Error; err != nil {
			return err
		}

		if err := tx.Model(&current).Updates(map[string]any{
			"name":                         project.Name,
			"cover_image_revision_id":      nullableString(project.CoverImageRevisionID),
			"cover_image_asset_id":         row.CoverImageAssetID,
			"cover_image_sha256":           nullableString(project.CoverImageSHA256),
			"cover_image_content_type":     nullableString(project.CoverImageContentType),
			"cover_image_size_bytes":       project.CoverImageSizeBytes,
			"cover_image_claim_generation": project.CoverImageClaimGeneration,
			"updated_at":                   project.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", row.ID).Delete(&projectMemberRow{}).Error; err != nil {
			return err
		}
		if len(members) == 0 {
			return nil
		}
		return tx.Create(&members).Error
	})
	return translateWriteError(err)
}

func (r *Repository) UpdateByMember(ctx context.Context, project domainproject.Project) error {
	row, err := rowFromDomain(project)
	if err != nil {
		return err
	}
	db := persistencetransaction.DB(ctx, r.db)
	result := r.scopeQuery(db, row.TenantID, row.WorkspaceID).
		Where("projects.id = ?", row.ID).
		Updates(map[string]any{
			"cover_image_revision_id":      row.CoverImageRevisionID,
			"cover_image_asset_id":         row.CoverImageAssetID,
			"cover_image_sha256":           row.CoverImageSHA256,
			"cover_image_content_type":     row.CoverImageContentType,
			"cover_image_size_bytes":       row.CoverImageSizeBytes,
			"cover_image_claim_generation": row.CoverImageClaimGeneration,
			"updated_at":                   row.UpdatedAt,
		})
	if result.Error != nil {
		return translateWriteError(result.Error)
	}
	if result.RowsAffected == 0 {
		var count int64
		if err = r.scopeQuery(db, row.TenantID, row.WorkspaceID).
			Where("projects.id = ?", row.ID).
			Count(&count).Error; err != nil {
			return translateWriteError(err)
		}
		if count == 0 {
			return applicationproject.ErrNotFound
		}
	}
	return nil
}

func (r *Repository) Delete(ctx context.Context, project domainproject.Project) error {
	if project.DeletedAt == nil {
		return applicationproject.ErrNotFound
	}
	row, err := rowFromDomain(project)
	if err != nil {
		return err
	}
	err = persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		var current projectRow
		query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND tenant_id = ?", row.ID, project.TenantID)
		query = applyWorkspaceScope(query, clause.Column{Name: "workspace_id"}, project.WorkspaceID)
		if err := query.First(&current).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", row.ID).Delete(&projectMemberRow{}).Error; err != nil {
			return err
		}
		return tx.Model(&current).Updates(map[string]any{
			"cover_image_revision_id": nil, "cover_image_asset_id": nil, "cover_image_sha256": nil,
			"cover_image_content_type":     nil,
			"cover_image_size_bytes":       0,
			"cover_image_claim_generation": 0,
			"updated_at":                   project.UpdatedAt, "deleted_at": project.DeletedAt.UnixMilli(),
		}).Error
	})
	return translateWriteError(err)
}

func (r *Repository) Get(ctx context.Context, scope applicationproject.Scope, projectID string) (domainproject.Project, error) {
	id, err := persistenceid.Parse(projectID)
	if err != nil {
		return domainproject.Project{}, applicationproject.ErrNotFound
	}
	query := r.scopeQuery(r.db.WithContext(ctx), scope.TenantID, scope.WorkspaceID)
	query = applyProjectAccess(query, scope.CallerID, scope.Access)
	var row projectRow
	if err := query.Where("projects.id = ?", id).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domainproject.Project{}, applicationproject.ErrNotFound
		}
		return domainproject.Project{}, err
	}
	members, err := r.loadMembers(ctx, []persistenceid.UUID{row.ID})
	if err != nil {
		return domainproject.Project{}, err
	}
	return domainFromRow(row, members[row.ID.String()]), nil
}

// GetByTenant verifies project ownership without applying workspace scope. Project model
// permissions are tenant/project scoped and deliberately independent from workspaces.
func (r *Repository) GetByTenant(ctx context.Context, tenantID string, projectID string) (domainproject.Project, error) {
	id, err := persistenceid.Parse(projectID)
	if err != nil {
		return domainproject.Project{}, applicationproject.ErrNotFound
	}
	var row projectRow
	if err := r.db.WithContext(ctx).Model(&projectRow{}).
		Where("projects.tenant_id = ? AND projects.id = ?", tenantID, id).
		First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domainproject.Project{}, applicationproject.ErrNotFound
		}
		return domainproject.Project{}, err
	}
	members, err := r.loadMembers(ctx, []persistenceid.UUID{row.ID})
	if err != nil {
		return domainproject.Project{}, err
	}
	return domainFromRow(row, members[row.ID.String()]), nil
}

func (r *Repository) BatchGet(
	ctx context.Context,
	scope applicationproject.Scope,
	projectIDs []string,
) ([]domainproject.Project, error) {
	ids := persistenceid.ParseValid(projectIDs)
	if len(ids) == 0 {
		return []domainproject.Project{}, nil
	}
	var rows []projectRow
	if err := r.scopeQuery(r.db.WithContext(ctx), scope.TenantID, scope.WorkspaceID).
		Scopes(func(db *gorm.DB) *gorm.DB { return applyProjectAccess(db, scope.CallerID, scope.Access) }).
		Where("projects.id IN ?", ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	members, err := r.loadMembers(ctx, rowIDs(rows))
	if err != nil {
		return nil, err
	}
	items := make([]domainproject.Project, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row, members[row.ID.String()]))
	}
	return items, nil
}

func (r *Repository) List(ctx context.Context, query applicationproject.ListQuery) ([]domainproject.Project, int64, error) {
	db := r.scopeQuery(r.db.WithContext(ctx), query.TenantID, query.WorkspaceID)
	db = applyProjectAccess(db, query.CallerID, query.Access)
	if query.Keyword != "" {
		db = db.Where("projects.name LIKE ?", "%"+query.Keyword+"%")
	}

	var total int64
	if err := db.Distinct("projects.id").Count(&total).Error; err != nil {
		return nil, 0, err
	}
	direction := "DESC"
	if query.SortDirection == applicationproject.SortAscending {
		direction = "ASC"
	}
	var rows []projectRow
	if err := db.Select("projects.*").Distinct().
		Order("projects.updated_at " + direction).
		Order("projects.id " + direction).
		Limit(query.PageSize).
		Offset((query.PageNum - 1) * query.PageSize).
		Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	ids := rowIDs(rows)
	members, err := r.loadMembers(ctx, ids)
	if err != nil {
		return nil, 0, err
	}
	projects := make([]domainproject.Project, 0, len(rows))
	for _, row := range rows {
		projects = append(projects, domainFromRow(row, members[row.ID.String()]))
	}
	return projects, total, nil
}

func (r *Repository) ListByTenant(ctx context.Context, tenantID string) ([]domainproject.Project, error) {
	return r.listForCleanup(ctx, r.db.WithContext(ctx).Where("projects.tenant_id = ?", tenantID))
}

func (r *Repository) ListByWorkspace(
	ctx context.Context,
	tenantID string,
	workspaceID string,
) ([]domainproject.Project, error) {
	return r.listForCleanup(ctx, r.db.WithContext(ctx).
		Where("projects.tenant_id = ? AND projects.workspace_id = ?", tenantID, workspaceID))
}

func (r *Repository) listForCleanup(ctx context.Context, db *gorm.DB) ([]domainproject.Project, error) {
	var rows []projectRow
	if err := db.Model(&projectRow{}).Order("projects.id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	members, err := r.loadMembers(ctx, rowIDs(rows))
	if err != nil {
		return nil, err
	}
	items := make([]domainproject.Project, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row, members[row.ID.String()]))
	}
	return items, nil
}

func (r *Repository) scopeQuery(db *gorm.DB, tenantID string, workspaceID *string) *gorm.DB {
	db = db.Model(&projectRow{}).Where("projects.tenant_id = ?", tenantID)
	return applyWorkspaceScope(db, clause.Column{Table: "projects", Name: "workspace_id"}, workspaceID)
}

func applyWorkspaceScope(db *gorm.DB, column clause.Column, workspaceID *string) *gorm.DB {
	if workspaceID == nil {
		return db.Where(clause.Eq{Column: column, Value: nil})
	}
	return db.Where(clause.Eq{Column: column, Value: *workspaceID})
}

func applyProjectAccess(db *gorm.DB, callerID string, access applicationproject.Access) *gorm.DB {
	switch access {
	case applicationproject.AccessAdmin:
		return db
	case applicationproject.AccessMember:
		memberProjects := db.Session(&gorm.Session{NewDB: true}).
			Model(&projectMemberRow{}).
			Select("project_id").
			Where("user_id = ?", callerID)
		return db.Where("projects.id IN (?)", memberProjects)
	default:
		return db.Where("1 = 0")
	}
}

func (r *Repository) loadMembers(ctx context.Context, projectIDs []persistenceid.UUID) (map[string][]string, error) {
	result := make(map[string][]string, len(projectIDs))
	if len(projectIDs) == 0 {
		return result, nil
	}
	var rows []projectMemberRow
	if err := r.db.WithContext(ctx).
		Where("project_id IN ?", projectIDs).
		Order("id ASC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		projectID := row.ProjectID.String()
		result[projectID] = append(result[projectID], row.UserID)
	}
	return result, nil
}

func rowIDs(rows []projectRow) []persistenceid.UUID {
	ids := make([]persistenceid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids
}

func rowFromDomain(project domainproject.Project) (projectRow, error) {
	id, err := persistenceid.Parse(project.ID)
	if err != nil {
		return projectRow{}, fmt.Errorf("map Project ID: %w", err)
	}
	coverImageID, err := persistenceid.ParseOptional(project.CoverImageAssetID)
	if err != nil {
		return projectRow{}, fmt.Errorf("map Project cover image ID: %w", err)
	}
	row := projectRow{
		ID: id, TenantID: project.TenantID, WorkspaceID: cloneString(project.WorkspaceID),
		Name: project.Name, CreatedBy: project.CreatedBy,
		CoverImageRevisionID: nullableString(project.CoverImageRevisionID), CoverImageAssetID: coverImageID,
		CoverImageSHA256:          nullableString(project.CoverImageSHA256),
		CoverImageContentType:     nullableString(project.CoverImageContentType),
		CoverImageSizeBytes:       project.CoverImageSizeBytes,
		CoverImageClaimGeneration: project.CoverImageClaimGeneration,
		CreatedAt:                 project.CreatedAt, UpdatedAt: project.UpdatedAt,
	}
	if project.DeletedAt != nil {
		row.DeletedAt = soft_delete.DeletedAt(project.DeletedAt.UnixMilli())
	}
	return row, nil
}

func memberRowsFromDomain(project domainproject.Project, projectID persistenceid.UUID) []projectMemberRow {
	rows := make([]projectMemberRow, 0, len(project.MemberIDs))
	for _, memberID := range project.MemberIDs {
		rows = append(rows, projectMemberRow{
			TenantID: project.TenantID, WorkspaceID: cloneString(project.WorkspaceID),
			ProjectID: projectID, UserID: memberID, CreatedAt: project.UpdatedAt,
		})
	}
	return rows
}

func domainFromRow(row projectRow, memberIDs []string) domainproject.Project {
	return domainproject.Project{
		ID: row.ID.String(), TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID),
		Name: row.Name, CreatedBy: row.CreatedBy, CoverImageRevisionID: stringValue(row.CoverImageRevisionID),
		CoverImageAssetID: uuidStringValue(row.CoverImageAssetID), CoverImageSHA256: stringValue(row.CoverImageSHA256),
		CoverImageContentType:     stringValue(row.CoverImageContentType),
		CoverImageSizeBytes:       row.CoverImageSizeBytes,
		CoverImageClaimGeneration: row.CoverImageClaimGeneration,
		CanvasCount:               row.CanvasCount, SelectedVideoDurationMillis: row.SelectedVideoDurationMillis, ResourceCount: row.ResourceCount,
		MemberIDs: append([]string(nil), memberIDs...), CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		DeletedAt: deletedAt(row.DeletedAt),
	}
}

func deletedAt(value soft_delete.DeletedAt) *time.Time {
	if value == 0 {
		return nil
	}
	deletedAt := time.UnixMilli(int64(value)).UTC()
	return &deletedAt
}

func uuidStringValue(value *persistenceid.UUID) string {
	if value == nil {
		return ""
	}
	return value.String()
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
	return cloneString(&value)
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func translateWriteError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return applicationproject.ErrNameConflict
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return applicationproject.ErrNotFound
	}
	return err
}
