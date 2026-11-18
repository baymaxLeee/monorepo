package project

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	domainproject "github.com/example/monorepo/canvas/internal/domain/project"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	scopelifecycle "github.com/example/monorepo/canvas/internal/infrastructure/persistence/scopelifecycle"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *persistencetransaction.Store }

func NewRepository(db *persistencetransaction.Store) *Repository { return &Repository{db: db} }

func (r *Repository) Create(ctx context.Context, project domainproject.Project) error {
	row, err := rowFromDomain(project)
	if err != nil {
		return err
	}
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if err := scopelifecycle.LockActive(ctx, r.db, project.TenantID, project.WorkspaceID); err != nil {
			return err
		}
		if err := r.db.Queries(ctx).InsertProject(ctx, sqlc.InsertProjectParams{
			DeletedAt:                   row.DeletedAt,
			ID:                          row.ID,
			TenantID:                    row.TenantID,
			WorkspaceID:                 row.WorkspaceID,
			Name:                        row.Name,
			CreatedBy:                   row.CreatedBy,
			CoverImageRevisionID:        row.CoverImageRevisionID,
			CoverImageAssetID:           row.CoverImageAssetID,
			CoverImageSha256:            row.CoverImageSha256,
			CoverImageContentType:       row.CoverImageContentType,
			CoverImageSizeBytes:         row.CoverImageSizeBytes,
			CoverImageClaimGeneration:   row.CoverImageClaimGeneration,
			CanvasCount:                 row.CanvasCount,
			SelectedVideoDurationMillis: row.SelectedVideoDurationMillis,
			ResourceCount:               row.ResourceCount,
			CreatedAt:                   row.CreatedAt,
			UpdatedAt:                   row.UpdatedAt,
		}); err != nil {
			return err
		}
		for _, id := range project.MemberIDs {
			if err := r.db.Queries(ctx).InsertProjectMember(ctx, sqlc.InsertProjectMemberParams{
				TenantID:    row.TenantID,
				WorkspaceID: row.WorkspaceID,
				ProjectID:   row.ID,
				UserID:      id,
				CreatedAt:   row.UpdatedAt,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	return translateWriteError(err)
}

func (r *Repository) Update(ctx context.Context, project domainproject.Project) error {
	row, err := rowFromDomain(project)
	if err != nil {
		return err
	}
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if _, err := r.db.Queries(ctx).LockScopedProject(ctx, sqlc.LockScopedProjectParams{
			TenantID:    row.TenantID,
			WorkspaceID: row.WorkspaceID,
			ID:          row.ID,
		}); err != nil {
			return err
		}
		if err := r.db.Queries(ctx).ModifyProject(ctx, sqlc.ModifyProjectParams{
			Name:                      row.Name,
			CoverImageRevisionID:      row.CoverImageRevisionID,
			CoverImageAssetID:         row.CoverImageAssetID,
			CoverImageSha256:          row.CoverImageSha256,
			CoverImageContentType:     row.CoverImageContentType,
			CoverImageSizeBytes:       row.CoverImageSizeBytes,
			CoverImageClaimGeneration: row.CoverImageClaimGeneration,
			UpdatedAt:                 row.UpdatedAt,
			TenantID:                  row.TenantID,
			WorkspaceID:               row.WorkspaceID,
			ID:                        row.ID,
		}); err != nil {
			return err
		}
		if err := r.db.Queries(ctx).RetireProjectMembers(ctx, sqlc.RetireProjectMembersParams{
			RetiredAt: time.Now().UnixMilli(),
			ProjectID: row.ID,
		}); err != nil {
			return err
		}
		for _, id := range project.MemberIDs {
			if err := r.db.Queries(ctx).InsertProjectMember(ctx, sqlc.InsertProjectMemberParams{
				TenantID:    row.TenantID,
				WorkspaceID: row.WorkspaceID,
				ProjectID:   row.ID,
				UserID:      id,
				CreatedAt:   row.UpdatedAt,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	return translateWriteError(err)
}

func (r *Repository) Delete(ctx context.Context, project domainproject.Project) error {
	if project.DeletedAt == nil {
		return applicationproject.ErrNotFound
	}
	row, err := rowFromDomain(project)
	if err != nil {
		return err
	}
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if _, err := r.db.Queries(ctx).LockScopedProject(ctx, sqlc.LockScopedProjectParams{
			TenantID:    row.TenantID,
			WorkspaceID: row.WorkspaceID,
			ID:          row.ID,
		}); err != nil {
			return err
		}
		if err := r.db.Queries(ctx).RetireProjectMembers(ctx, sqlc.RetireProjectMembersParams{
			RetiredAt: time.Now().UnixMilli(),
			ProjectID: row.ID,
		}); err != nil {
			return err
		}
		return r.db.Queries(ctx).RetireProject(ctx, sqlc.RetireProjectParams{
			UpdatedAt:   row.UpdatedAt,
			RetiredAt:   project.DeletedAt.UnixMilli(),
			TenantID:    row.TenantID,
			WorkspaceID: row.WorkspaceID,
			ID:          row.ID,
		})
	})
	return translateWriteError(err)
}

func (r *Repository) UpdateByMember(ctx context.Context, project domainproject.Project) error {
	row, err := rowFromDomain(project)
	if err != nil {
		return err
	}
	n, err := r.db.Queries(ctx).ModifyProjectCover(ctx, sqlc.ModifyProjectCoverParams{
		CoverImageRevisionID:      row.CoverImageRevisionID,
		CoverImageAssetID:         row.CoverImageAssetID,
		CoverImageSha256:          row.CoverImageSha256,
		CoverImageContentType:     row.CoverImageContentType,
		CoverImageSizeBytes:       row.CoverImageSizeBytes,
		CoverImageClaimGeneration: row.CoverImageClaimGeneration,
		UpdatedAt:                 row.UpdatedAt,
		TenantID:                  row.TenantID,
		WorkspaceID:               row.WorkspaceID,
		ID:                        row.ID,
	})
	if err != nil {
		return translateWriteError(err)
	}
	if n == 0 {
		return applicationproject.ErrNotFound
	}
	return nil
}

func (r *Repository) Get(ctx context.Context, scope applicationproject.Scope, projectID string) (domainproject.Project, error) {
	id, err := persistenceid.Parse(projectID)
	if err != nil {
		return domainproject.Project{}, applicationproject.ErrNotFound
	}
	row, err := r.db.Queries(ctx).ReadProject(ctx, sqlc.ReadProjectParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		Admin:       scope.Access == applicationproject.AccessAdmin,
		Member:      scope.Access == applicationproject.AccessMember,
		CallerID:    scope.CallerID,
		ID:          id.String(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainproject.Project{}, applicationproject.ErrNotFound
	}
	if err != nil {
		return domainproject.Project{}, err
	}
	items, err := r.hydrate(ctx, []sqlc.Project{row})
	if err != nil {
		return domainproject.Project{}, err
	}
	return items[0], nil
}

func (r *Repository) GetByTenant(ctx context.Context, tenantID string, projectID string) (domainproject.Project, error) {
	id, err := persistenceid.Parse(projectID)
	if err != nil {
		return domainproject.Project{}, applicationproject.ErrNotFound
	}
	row, err := r.db.Queries(ctx).ReadTenantProject(ctx, sqlc.ReadTenantProjectParams{
		TenantID: tenantID,
		ID:       id.String(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainproject.Project{}, applicationproject.ErrNotFound
	}
	if err != nil {
		return domainproject.Project{}, err
	}
	items, err := r.hydrate(ctx, []sqlc.Project{row})
	if err != nil {
		return domainproject.Project{}, err
	}
	return items[0], nil
}

func (r *Repository) BatchGet(
	ctx context.Context,
	scope applicationproject.Scope,
	projectIDs []string,
) ([]domainproject.Project, error) {
	ids := persistenceid.ParseValidStrings(projectIDs)
	if len(ids) == 0 {
		return []domainproject.Project{}, nil
	}
	rows, err := r.db.Queries(ctx).ReadProjects(ctx, sqlc.ReadProjectsParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		Admin:       scope.Access == applicationproject.AccessAdmin,
		Member:      scope.Access == applicationproject.AccessMember,
		CallerID:    scope.CallerID,
		Ids:         ids,
	})
	if err != nil {
		return nil, err
	}
	return r.hydrate(ctx, rows)
}

func (r *Repository) List(ctx context.Context, query applicationproject.ListQuery) ([]domainproject.Project, int64, error) {
	total, err := r.db.Queries(ctx).CountProjects(ctx, sqlc.CountProjectsParams{
		TenantID:    query.TenantID,
		WorkspaceID: query.WorkspaceID,
		Admin:       query.Access == applicationproject.AccessAdmin,
		Member:      query.Access == applicationproject.AccessMember,
		CallerID:    query.CallerID,
		Keyword:     query.Keyword,
	})
	if err != nil {
		return nil, 0, err
	}
	rows, err := r.db.Queries(ctx).PageProjects(ctx, sqlc.PageProjectsParams{
		TenantID:    query.TenantID,
		WorkspaceID: query.WorkspaceID,
		Admin:       query.Access == applicationproject.AccessAdmin,
		Member:      query.Access == applicationproject.AccessMember,
		CallerID:    query.CallerID,
		Keyword:     query.Keyword,
		Ascending:   query.SortDirection == applicationproject.SortAscending,
		PageOffset:  int64(query.PageNum-1) * int64(query.PageSize),
		PageSize:    int32(query.PageSize),
	})
	if err != nil {
		return nil, 0, err
	}
	items, err := r.hydrate(ctx, rows)
	return items, total, err
}

func (r *Repository) ListByTenant(ctx context.Context, tenantID string) ([]domainproject.Project, error) {
	rows, err := r.db.Queries(ctx).CleanupProjects(ctx, sqlc.CleanupProjectsParams{
		TenantID:    tenantID,
		WorkspaceID: nil,
	})
	if err != nil {
		return nil, err
	}
	return r.hydrate(ctx, rows)
}

func (r *Repository) ListByWorkspace(
	ctx context.Context,
	tenantID string,
	workspaceID string,
) ([]domainproject.Project, error) {
	rows, err := r.db.Queries(ctx).CleanupProjects(ctx, sqlc.CleanupProjectsParams{
		TenantID:    tenantID,
		WorkspaceID: &workspaceID,
	})
	if err != nil {
		return nil, err
	}
	return r.hydrate(ctx, rows)
}

func (r *Repository) hydrate(ctx context.Context, rows []sqlc.Project) ([]domainproject.Project, error) {
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	members, err := r.db.Queries(ctx).ReadProjectMembers(ctx, ids)
	if err != nil {
		return nil, err
	}
	byProject := make(map[string][]string, len(ids))
	for _, member := range members {
		byProject[member.ProjectID] = append(byProject[member.ProjectID], member.UserID)
	}
	items := make([]domainproject.Project, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row, byProject[row.ID]))
	}
	return items, nil
}

func rowFromDomain(project domainproject.Project) (sqlc.Project, error) {
	id, err := persistenceid.Parse(project.ID)
	if err != nil {
		return sqlc.Project{}, fmt.Errorf("map Project ID: %w", err)
	}
	coverImageID, err := persistenceid.ParseOptional(project.CoverImageAssetID)
	if err != nil {
		return sqlc.Project{}, fmt.Errorf("map Project cover image ID: %w", err)
	}
	row := sqlc.Project{
		ID: id.String(), TenantID: project.TenantID, WorkspaceID: cloneString(project.WorkspaceID),
		Name: project.Name, CreatedBy: project.CreatedBy,
		CoverImageRevisionID: nullableString(project.CoverImageRevisionID), CoverImageAssetID: persistenceid.OptionalText(coverImageID),
		CoverImageSha256:          nullableString(project.CoverImageSHA256),
		CoverImageContentType:     nullableString(project.CoverImageContentType),
		CoverImageSizeBytes:       project.CoverImageSizeBytes,
		CoverImageClaimGeneration: project.CoverImageClaimGeneration,
		CreatedAt:                 project.CreatedAt, UpdatedAt: project.UpdatedAt,
	}
	if project.DeletedAt != nil {
		millis := project.DeletedAt.UnixMilli()
		row.DeletedAt = &millis
	}
	return row, nil
}

func domainFromRow(row sqlc.Project, memberIDs []string) domainproject.Project {
	return domainproject.Project{
		ID: row.ID, TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID),
		Name: row.Name, CreatedBy: row.CreatedBy, CoverImageRevisionID: stringValue(row.CoverImageRevisionID),
		CoverImageAssetID: stringValue(row.CoverImageAssetID), CoverImageSHA256: stringValue(row.CoverImageSha256),
		CoverImageContentType:     stringValue(row.CoverImageContentType),
		CoverImageSizeBytes:       row.CoverImageSizeBytes,
		CoverImageClaimGeneration: row.CoverImageClaimGeneration,
		CanvasCount:               row.CanvasCount, SelectedVideoDurationMillis: row.SelectedVideoDurationMillis, ResourceCount: row.ResourceCount,
		MemberIDs: append([]string(nil), memberIDs...), CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		DeletedAt: deletedAt(row.DeletedAt),
	}
}

func deletedAt(value *int64) *time.Time {
	if value == nil || *value == 0 {
		return nil
	}
	deletedAt := time.UnixMilli(*value).UTC()
	return &deletedAt
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
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) && databaseError.Code == "23505" {
		return applicationproject.ErrNameConflict
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return applicationproject.ErrNotFound
	}
	return err
}
