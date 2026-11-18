package canvas

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationcoverimage "github.com/example/monorepo/canvas/internal/application/coverimage"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

const maxActiveCanvasesPerProject = 100

type Repository struct{ db *persistencetransaction.Store }

func NewRepository(db *persistencetransaction.Store) *Repository { return &Repository{db: db} }

func (r *Repository) Create(ctx context.Context, item domaincanvas.Canvas) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if _, err := r.db.Queries(ctx).LockScopedProject(ctx, sqlc.LockScopedProjectParams{
			TenantID:    row.TenantID,
			WorkspaceID: row.WorkspaceID,
			ID:          row.ProjectID,
		}); err != nil {
			return err
		}
		n, err := r.db.Queries(ctx).CountActiveCanvases(ctx, sqlc.CountActiveCanvasesParams{
			TenantID:    row.TenantID,
			WorkspaceID: row.WorkspaceID,
			ProjectID:   row.ProjectID,
		})
		if err != nil {
			return err
		}
		if n >= maxActiveCanvasesPerProject {
			return applicationcanvas.ErrLimitExceeded
		}
		return r.db.Queries(ctx).InsertCanvas(ctx, sqlc.InsertCanvasParams{
			DeletedAt:                   row.DeletedAt,
			ID:                          row.ID,
			TenantID:                    row.TenantID,
			WorkspaceID:                 row.WorkspaceID,
			ProjectID:                   row.ProjectID,
			Name:                        row.Name,
			CoverImageRevisionID:        row.CoverImageRevisionID,
			CoverImageAssetID:           row.CoverImageAssetID,
			CoverImageSha256:            row.CoverImageSha256,
			CoverImageContentType:       row.CoverImageContentType,
			CoverImageSizeBytes:         row.CoverImageSizeBytes,
			CoverImageClaimGeneration:   row.CoverImageClaimGeneration,
			CanvasNodeCount:             row.CanvasNodeCount,
			SelectedVideoDurationMillis: row.SelectedVideoDurationMillis,
			DefaultView:                 row.DefaultView,
			Revision:                    row.Revision,
			CreatedBy:                   row.CreatedBy,
			CreatedAt:                   row.CreatedAt,
			UpdatedAt:                   row.UpdatedAt,
		})
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
	if _, err := r.db.Queries(ctx).FindScopedProject(ctx, sqlc.FindScopedProjectParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ID:          projectUUID.String(),
	}); err != nil {
		return domaincanvas.Canvas{}, translateReadError(err)
	}
	row, err := r.db.Queries(ctx).ReadCanvas(ctx, sqlc.ReadCanvasParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   projectUUID.String(),
		ID:          canvasUUID.String(),
	})
	if err != nil {
		return domaincanvas.Canvas{}, translateReadError(err)
	}
	return domainFromRow(row), nil
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
	ids := persistenceid.ParseValidStrings(canvasIDs)
	if len(ids) == 0 {
		return []domaincanvas.Canvas{}, nil
	}
	if _, err := r.db.Queries(ctx).FindScopedProject(ctx, sqlc.FindScopedProjectParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ID:          projectUUID.String(),
	}); errors.Is(err, pgx.ErrNoRows) {
		return []domaincanvas.Canvas{}, nil
	} else if err != nil {
		return nil, err
	}
	rows, err := r.db.Queries(ctx).ReadCanvases(ctx, sqlc.ReadCanvasesParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   projectUUID.String(),
		Ids:         ids,
	})
	if err != nil {
		return nil, err
	}
	return domains(rows), nil
}

func (r *Repository) Validate(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID string) error {
	_, err := r.Get(ctx, scope, projectID, canvasID)
	return err
}

func (r *Repository) List(ctx context.Context, query applicationcanvas.ListQuery) ([]domaincanvas.Canvas, int64, error) {
	projectID, err := persistenceid.Parse(query.ProjectID)
	if err != nil {
		return nil, 0, applicationcanvas.ErrNotFound
	}
	if _, err := r.db.Queries(ctx).FindScopedProject(ctx, sqlc.FindScopedProjectParams{
		TenantID:    query.TenantID,
		WorkspaceID: query.WorkspaceID,
		ID:          projectID.String(),
	}); err != nil {
		return nil, 0, translateReadError(err)
	}
	total, err := r.db.Queries(ctx).CountFilteredCanvases(ctx, sqlc.CountFilteredCanvasesParams{
		TenantID:    query.TenantID,
		WorkspaceID: query.WorkspaceID,
		ProjectID:   projectID.String(),
		Author:      query.CreatedBy,
		Keyword:     query.Keyword,
	})
	if err != nil {
		return nil, 0, err
	}
	rows, err := r.db.Queries(ctx).PageCanvases(ctx, sqlc.PageCanvasesParams{
		TenantID:    query.TenantID,
		WorkspaceID: query.WorkspaceID,
		ProjectID:   projectID.String(),
		Author:      query.CreatedBy,
		Keyword:     query.Keyword,
		Ascending:   query.SortDirection == applicationcanvas.SortAscending,
		PageOffset:  int64(query.PageNum-1) * int64(query.PageSize),
		PageSize:    int32(query.PageSize),
	})
	if err != nil {
		return nil, 0, err
	}
	return domains(rows), total, nil
}

func (r *Repository) Update(ctx context.Context, item domaincanvas.Canvas) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if _, err := r.db.Queries(ctx).LockScopedProject(ctx, sqlc.LockScopedProjectParams{
			TenantID:    row.TenantID,
			WorkspaceID: row.WorkspaceID,
			ID:          row.ProjectID,
		}); err != nil {
			return err
		}
		n, err := r.db.Queries(ctx).ModifyCanvas(ctx, sqlc.ModifyCanvasParams{
			Name:                      row.Name,
			CoverImageRevisionID:      row.CoverImageRevisionID,
			CoverImageAssetID:         row.CoverImageAssetID,
			CoverImageSha256:          row.CoverImageSha256,
			CoverImageContentType:     row.CoverImageContentType,
			CoverImageSizeBytes:       row.CoverImageSizeBytes,
			CoverImageClaimGeneration: row.CoverImageClaimGeneration,
			Revision:                  row.Revision,
			UpdatedAt:                 row.UpdatedAt,
			TenantID:                  row.TenantID,
			WorkspaceID:               row.WorkspaceID,
			ProjectID:                 row.ProjectID,
			ID:                        row.ID,
		})
		if err == nil && n == 0 {
			return applicationcanvas.ErrNotFound
		}
		return err
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
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if _, err := r.db.Queries(ctx).LockScopedProject(ctx, sqlc.LockScopedProjectParams{
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			ID:          projectUUID.String(),
		}); err != nil {
			return err
		}
		n, err := r.db.Queries(ctx).ModifyCanvasView(ctx, sqlc.ModifyCanvasViewParams{
			DefaultView: int16(*defaultView),
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			ProjectID:   projectUUID.String(),
			ID:          canvasUUID.String(),
		})
		if err == nil && n == 0 {
			return applicationcanvas.ErrNotFound
		}
		return err
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
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if _, err := r.db.Queries(ctx).LockScopedProject(ctx, sqlc.LockScopedProjectParams{
			TenantID:    row.TenantID,
			WorkspaceID: row.WorkspaceID,
			ID:          row.ProjectID,
		}); err != nil {
			return err
		}
		n, err := r.db.Queries(ctx).RetireCanvas(ctx, sqlc.RetireCanvasParams{
			Revision:    row.Revision,
			UpdatedAt:   row.UpdatedAt,
			RetiredAt:   item.DeletedAt.UnixMilli(),
			TenantID:    row.TenantID,
			WorkspaceID: row.WorkspaceID,
			ProjectID:   row.ProjectID,
			ID:          row.ID,
		})
		if err == nil && n == 0 {
			return applicationcanvas.ErrNotFound
		}
		return err
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
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		rows, err := r.db.Queries(ctx).LockProjectCanvases(ctx, sqlc.LockProjectCanvasesParams{
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			ProjectID:   projectUUID.String(),
		})
		if err != nil {
			return err
		}
		ids := make([]string, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.ID)
			targets = append(targets, applicationcanvas.DeletionTarget{CanvasID: row.ID, Revision: row.Revision, Cover: coverImageRegistrationFromRow(row)})
		}
		return r.db.Queries(ctx).RetireProjectCanvases(ctx, sqlc.RetireProjectCanvasesParams{
			UpdatedAt: now,
			RetiredAt: now.UnixMilli(),
			Ids:       ids,
		})
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
	return r.db.Queries(ctx).MatchDeletedCanvas(ctx, sqlc.MatchDeletedCanvasParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ID:          canvas.String(),
		ProjectID:   project.String(),
		Revision:    revision,
		RetiredAt:   deletedAt.UnixMilli(),
	})
}

func coverImageRegistrationFromRow(row sqlc.Canvase) *applicationcoverimage.Registration {
	if row.CoverImageRevisionID == nil || row.CoverImageAssetID == nil || row.CoverImageSha256 == nil || *row.CoverImageSha256 == "" {
		return nil
	}
	return &applicationcoverimage.Registration{
		TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, Revision: applicationcoverimage.RevisionRef{AssetID: *row.CoverImageAssetID, RevisionID: *row.CoverImageRevisionID}, OwnerType: "canvas_cover", OwnerID: row.ID, Generation: row.CoverImageClaimGeneration,
		SHA256: *row.CoverImageSha256, ContentType: stringValue(row.CoverImageContentType),
		SizeBytes: row.CoverImageSizeBytes,
	}
}

func rowFromDomain(item domaincanvas.Canvas) (sqlc.Canvase, error) {
	id, err := persistenceid.Parse(item.ID)
	if err != nil {
		return sqlc.Canvase{}, fmt.Errorf("map Canvas ID: %w", err)
	}
	projectID, err := persistenceid.Parse(item.ProjectID)
	if err != nil {
		return sqlc.Canvase{}, fmt.Errorf("map Canvas Project ID: %w", err)
	}
	coverImageID, err := persistenceid.ParseOptional(item.CoverImageAssetID)
	if err != nil {
		return sqlc.Canvase{}, fmt.Errorf("map Canvas cover image ID: %w", err)
	}
	row := sqlc.Canvase{
		ID: id.String(), TenantID: item.TenantID, WorkspaceID: cloneString(item.WorkspaceID),
		ProjectID: projectID.String(), Name: item.Name,
		CoverImageRevisionID: nullableString(item.CoverImageRevisionID), CoverImageAssetID: persistenceid.OptionalText(coverImageID),
		CoverImageSha256:      nullableString(item.CoverImageSHA256),
		CoverImageContentType: nullableString(item.CoverImageContentType),
		CoverImageSizeBytes:   item.CoverImageSizeBytes, CreatedBy: item.CreatedBy,
		CoverImageClaimGeneration: item.CoverImageClaimGeneration,
		DefaultView:               int16(item.DefaultView),
		Revision:                  item.Revision,
		CreatedAt:                 item.CreatedAt, UpdatedAt: item.UpdatedAt,
	}
	if item.DeletedAt != nil {
		millis := item.DeletedAt.UnixMilli()
		row.DeletedAt = &millis
	}
	return row, nil
}

func domainFromRow(row sqlc.Canvase) domaincanvas.Canvas {
	item := domaincanvas.Canvas{
		ID: row.ID, TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID),
		ProjectID: row.ProjectID, Name: row.Name, CoverImageRevisionID: stringValue(row.CoverImageRevisionID),
		CoverImageAssetID: stringValue(row.CoverImageAssetID), CoverImageSHA256: stringValue(row.CoverImageSha256),
		CoverImageContentType:     stringValue(row.CoverImageContentType),
		CoverImageSizeBytes:       row.CoverImageSizeBytes,
		CoverImageClaimGeneration: row.CoverImageClaimGeneration,
		CreatedBy:                 row.CreatedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		CanvasNodeCount: row.CanvasNodeCount, SelectedVideoDurationMillis: row.SelectedVideoDurationMillis,
		DefaultView: domaincanvas.ViewMode(row.DefaultView), Revision: row.Revision,
	}
	if row.DeletedAt != nil && *row.DeletedAt != 0 {
		deletedAt := time.UnixMilli(*row.DeletedAt).UTC()
		item.DeletedAt = &deletedAt
	}
	return item
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

func domains(rows []sqlc.Canvase) []domaincanvas.Canvas {
	items := make([]domaincanvas.Canvas, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row))
	}
	return items
}

func translateReadError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return applicationcanvas.ErrNotFound
	}
	return err
}

func translateWriteError(err error) error {
	var databaseError *pgconn.PgError
	switch {
	case err == nil:
		return nil
	case errors.Is(err, applicationcanvas.ErrNotFound), errors.Is(err, applicationcanvas.ErrLimitExceeded),
		errors.Is(err, applicationcanvas.ErrNameConflict), errors.Is(err, applicationcanvas.ErrRevisionConflict):
		return err
	case errors.Is(err, pgx.ErrNoRows):
		return applicationcanvas.ErrNotFound
	case errors.As(err, &databaseError) && databaseError.Code == "23505":
		return applicationcanvas.ErrNameConflict
	default:
		return err
	}
}
