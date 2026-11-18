package resource

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	applicationpackage "github.com/example/monorepo/canvas/internal/application/benefitpackage"
	applicationresource "github.com/example/monorepo/canvas/internal/application/resource"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domainresource "github.com/example/monorepo/canvas/internal/domain/resource"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *persistencetransaction.Store }

func NewRepository(db *persistencetransaction.Store) *Repository { return &Repository{db: db} }

const maxActiveResourcesPerProjectType = 10_000

func (r *Repository) ValidateReviewAsset(ctx context.Context, scope applicationpackage.ReviewScope, projectID, resourceID, assetID string) error {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return applicationresource.ErrNotFound
	}
	resourceUUID, err := persistenceid.Parse(resourceID)
	if err != nil {
		return applicationresource.ErrNotFound
	}
	assetUUID, err := persistenceid.Parse(assetID)
	if err != nil {
		return applicationresource.ErrNotFound
	}
	n, err := r.db.Queries(ctx).CountAssetsForReview(ctx, sqlc.CountAssetsForReviewParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ID:          resourceUUID.String(),
		ProjectID:   projectUUID.String(),
		AssetID:     assetUUID.String(),
	})
	if err != nil {
		return err
	}
	if n != 1 {
		return applicationresource.ErrNotFound
	}
	return nil
}

func (r *Repository) Create(ctx context.Context, item domainresource.Resource) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		_, err := r.db.Queries(ctx).LockScopedProject(ctx, sqlc.LockScopedProjectParams{
			TenantID:    row.TenantID,
			WorkspaceID: row.WorkspaceID,
			ID:          row.OwnerID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return applicationresource.ErrProjectNotFound
		}
		if err != nil {
			return err
		}
		n, err := r.db.Queries(ctx).CountOwnedResourceType(ctx, sqlc.CountOwnedResourceTypeParams{
			OwnerType: row.OwnerType,
			OwnerID:   row.OwnerID,
			Type:      row.Type,
		})
		if err != nil {
			return err
		}
		if n >= maxActiveResourcesPerProjectType {
			return applicationresource.ErrLimitExceeded
		}
		if err := r.db.Queries(ctx).InsertResource(ctx, sqlc.InsertResourceParams{
			DeletedAt:              row.DeletedAt,
			ID:                     row.ID,
			TenantID:               row.TenantID,
			WorkspaceID:            row.WorkspaceID,
			OwnerType:              row.OwnerType,
			OwnerID:                row.OwnerID,
			Type:                   row.Type,
			Name:                   row.Name,
			Description:            row.Description,
			PrimaryResourceAssetID: row.PrimaryResourceAssetID,
			Revision:               row.Revision,
			ResourceAssetCount:     row.ResourceAssetCount,
			CreatedBy:              row.CreatedBy,
			CreatedAt:              row.CreatedAt,
			UpdatedAt:              row.UpdatedAt,
		}); err != nil {
			return err
		}
		return r.db.Queries(ctx).InsertResourceRelation(ctx, sqlc.InsertResourceRelationParams{
			ProjectID:  row.OwnerID,
			ResourceID: row.ID,
			CreatedAt:  row.CreatedAt,
		})
	})
	return translateWriteError(err)
}

func (r *Repository) ValidateCreate(ctx context.Context, item domainresource.Resource) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	_, err = r.db.Queries(ctx).FindScopedProject(ctx, sqlc.FindScopedProjectParams{
		TenantID:    row.TenantID,
		WorkspaceID: row.WorkspaceID,
		ID:          row.OwnerID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return applicationresource.ErrProjectNotFound
	}
	if err != nil {
		return err
	}
	n, err := r.db.Queries(ctx).CountOwnedResourceType(ctx, sqlc.CountOwnedResourceTypeParams{
		OwnerType: row.OwnerType,
		OwnerID:   row.OwnerID,
		Type:      row.Type,
	})
	if err != nil {
		return err
	}
	if n >= maxActiveResourcesPerProjectType {
		return applicationresource.ErrLimitExceeded
	}
	exists, err := r.db.Queries(ctx).OwnedResourceNameExists(ctx, sqlc.OwnedResourceNameExistsParams{
		OwnerType: row.OwnerType,
		OwnerID:   row.OwnerID,
		Name:      row.Name,
	})
	if err != nil {
		return err
	}
	if exists {
		return applicationresource.ErrNameConflict
	}
	return nil
}

func (r *Repository) Get(ctx context.Context, scope applicationresource.Scope, projectID, resourceID string) (domainresource.Resource, error) {
	resourceUUID, err := persistenceid.Parse(resourceID)
	if err != nil {
		return domainresource.Resource{}, applicationresource.ErrNotFound
	}
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return domainresource.Resource{}, applicationresource.ErrNotFound
	}
	row, err := r.db.Queries(ctx).ReadVisibleResource(ctx, sqlc.ReadVisibleResourceParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   projectUUID.String(),
		ID:          resourceUUID.String(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainresource.Resource{}, applicationresource.ErrNotFound
	}
	if err != nil {
		return domainresource.Resource{}, err
	}
	items := []domainresource.Resource{domainFromRow(row)}
	if err := r.hydrateApprovedResourceAssetCounts(ctx, items); err != nil {
		return domainresource.Resource{}, err
	}
	return items[0], nil
}

func (r *Repository) GetForUpdate(ctx context.Context, scope applicationresource.Scope, projectID, resourceID string) (domainresource.Resource, error) {
	resourceUUID, err := persistenceid.Parse(resourceID)
	if err != nil {
		return domainresource.Resource{}, applicationresource.ErrNotFound
	}
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return domainresource.Resource{}, applicationresource.ErrNotFound
	}
	_, err = r.db.Queries(ctx).LockScopedProject(ctx, sqlc.LockScopedProjectParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ID:          projectUUID.String(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainresource.Resource{}, applicationresource.ErrNotFound
	}
	if err != nil {
		return domainresource.Resource{}, err
	}
	row, err := r.db.Queries(ctx).LockProjectResource(ctx, sqlc.LockProjectResourceParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   projectUUID.String(),
		ID:          resourceUUID.String(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainresource.Resource{}, applicationresource.ErrNotFound
	}
	if err != nil {
		return domainresource.Resource{}, err
	}
	return domainFromRow(row), nil
}

func (r *Repository) BatchGet(ctx context.Context, scope applicationresource.Scope, projectID string, resourceIDs []string) ([]domainresource.Resource, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return []domainresource.Resource{}, nil
	}
	ids := persistenceid.ParseValidStrings(resourceIDs)
	if len(ids) == 0 {
		return []domainresource.Resource{}, nil
	}
	rows, err := r.db.Queries(ctx).ReadVisibleResources(ctx, sqlc.ReadVisibleResourcesParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   projectUUID.String(),
		Ids:         ids,
	})
	if err != nil {
		return nil, err
	}
	items := domainsFromRows(rows)
	if err := r.hydrateApprovedResourceAssetCounts(ctx, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *Repository) List(ctx context.Context, query applicationresource.ListQuery) ([]domainresource.Resource, int64, error) {
	projectID, err := persistenceid.Parse(query.ProjectID)
	if err != nil {
		return []domainresource.Resource{}, 0, nil
	}
	if query.SortField != applicationresource.SortCreatedAt && query.SortField != applicationresource.SortUpdatedAt && query.SortField != applicationresource.SortUnspecified {
		return nil, 0, fmt.Errorf("invalid resource sort field %d", query.SortField)
	}
	if query.SortDirection != applicationresource.SortAscending && query.SortDirection != applicationresource.SortDescending && query.SortDirection != applicationresource.SortDirectionUnspecified {
		return nil, 0, fmt.Errorf("invalid resource sort direction %d", query.SortDirection)
	}
	var resourceType *int16
	if query.Type != nil {
		v := int16(*query.Type)
		resourceType = &v
	}
	total, err := r.db.Queries(ctx).CountVisibleResources(ctx, sqlc.CountVisibleResourcesParams{
		TenantID:     query.TenantID,
		WorkspaceID:  query.WorkspaceID,
		ProjectID:    projectID.String(),
		ResourceType: resourceType,
		Keyword:      query.Keyword,
	})
	if err != nil {
		return nil, 0, err
	}
	rows, err := r.db.Queries(ctx).PageVisibleResources(ctx, sqlc.PageVisibleResourcesParams{
		TenantID:     query.TenantID,
		WorkspaceID:  query.WorkspaceID,
		ProjectID:    projectID.String(),
		ResourceType: resourceType,
		Keyword:      query.Keyword,
		Ascending:    query.SortDirection == applicationresource.SortAscending,
		ByCreated:    query.SortField == applicationresource.SortCreatedAt,
		PageOffset:   int64(query.PageNum-1) * int64(query.PageSize),
		PageSize:     int32(query.PageSize),
	})
	if err != nil {
		return nil, 0, err
	}
	items := domainsFromRows(rows)
	if err := r.hydrateApprovedResourceAssetCounts(ctx, items); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *Repository) StatsByProject(ctx context.Context, scope applicationresource.Scope, projectID string) (applicationresource.ResourceStats, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return applicationresource.ResourceStats{}, nil
	}
	rows, err := r.db.Queries(ctx).VisibleResourceStats(ctx, sqlc.VisibleResourceStatsParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   projectUUID.String(),
	})
	if err != nil {
		return applicationresource.ResourceStats{}, err
	}
	var stats applicationresource.ResourceStats
	for _, row := range rows {
		switch domainresource.Type(row.Type) {
		case domainresource.TypeCharacter:
			stats.CharacterCount = row.Count
		case domainresource.TypeScene:
			stats.SceneCount = row.Count
		case domainresource.TypeProp:
			stats.PropCount = row.Count
		case domainresource.TypeAudio:
			stats.AudioCount = row.Count
		}
	}
	return stats, nil
}

func (r *Repository) hydrateApprovedResourceAssetCounts(ctx context.Context, items []domainresource.Resource) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	rows, err := r.db.Queries(ctx).ResourceApprovalCounts(ctx, ids)
	if err != nil {
		return fmt.Errorf("count approved ResourceAssets: %w", err)
	}
	counts := make(map[string]int32, len(rows))
	for _, row := range rows {
		counts[row.ResourceID] = row.ApprovedCount
	}
	for index := range items {
		items[index].ApprovedResourceAssetCount = counts[items[index].ID]
	}
	return nil
}

func (r *Repository) Update(ctx context.Context, item domainresource.Resource) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	if item.Revision < 2 {
		return applicationresource.ErrRevisionConflict
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		n, err := r.db.Queries(ctx).ModifyResource(ctx, sqlc.ModifyResourceParams{
			Name:                   row.Name,
			Description:            row.Description,
			PrimaryResourceAssetID: row.PrimaryResourceAssetID,
			Revision:               row.Revision,
			ResourceAssetCount:     row.ResourceAssetCount,
			UpdatedAt:              row.UpdatedAt,
			TenantID:               row.TenantID,
			WorkspaceID:            row.WorkspaceID,
			ID:                     row.ID,
			OwnerType:              row.OwnerType,
			OwnerID:                row.OwnerID,
			ExpectedRevision:       item.Revision - 1,
		})
		if err != nil {
			return translateWriteError(err)
		}
		if n != 1 {
			return applicationresource.ErrRevisionConflict
		}
		return nil
	})
}

func (r *Repository) NextResourceAssetSequence(ctx context.Context, resourceID string) (int64, error) {
	id, err := persistenceid.Parse(resourceID)
	if err != nil {
		return 0, applicationresource.ErrNotFound
	}
	return r.db.Queries(ctx).NextAssetSlotSequence(ctx, id.String())
}

func (r *Repository) ResourceAssetNameExists(ctx context.Context, resourceID, name string) (bool, error) {
	id, err := persistenceid.Parse(resourceID)
	if err != nil {
		return false, applicationresource.ErrNotFound
	}
	return r.db.Queries(ctx).AssetSlotNameExists(ctx, sqlc.AssetSlotNameExistsParams{
		ResourceID: id.String(),
		Name:       name,
	})
}

func (r *Repository) CreateResourceAsset(ctx context.Context, item domainresource.ResourceAsset, assetID string) error {
	id, err := persistenceid.Parse(item.ID)
	if err != nil {
		return fmt.Errorf("map ResourceAsset ID: %w", err)
	}
	resourceID, err := persistenceid.Parse(item.ResourceID)
	if err != nil {
		return fmt.Errorf("map ResourceAsset resource ID: %w", err)
	}
	currentAssetID, err := persistenceid.ParseOptional(item.CurrentAssetID)
	if err != nil {
		return fmt.Errorf("map ResourceAsset current Asset ID: %w", err)
	}
	imageGenerationDraftID, err := persistenceid.ParseOptional(item.ImageGenerationDraftID)
	if err != nil {
		return fmt.Errorf("map ResourceAsset image generation ID: %w", err)
	}
	if !item.SourceType.Valid() ||
		item.SourceType == domainresource.SourceUpload && (currentAssetID == nil || imageGenerationDraftID != nil) ||
		item.SourceType == domainresource.SourceGenerated && imageGenerationDraftID == nil {
		return domainresource.ErrInvalidResourceAsset
	}
	if assetID != item.CurrentAssetID {
		return domainresource.ErrInvalidResourceAsset
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if err := r.db.Queries(ctx).InsertAssetSlot(ctx, sqlc.InsertAssetSlotParams{
			ID:                     id.String(),
			ResourceID:             resourceID.String(),
			Name:                   item.Name,
			SequenceNo:             item.SequenceNo,
			SourceType:             int16(item.SourceType),
			CurrentAssetID:         persistenceid.OptionalText(currentAssetID),
			ImageGenerationDraftID: persistenceid.OptionalText(imageGenerationDraftID),
			MediaType:              int16(item.MediaType),
			Revision:               item.Revision,
			CreatedAt:              item.CreatedAt,
			UpdatedAt:              item.UpdatedAt,
		}); err != nil {
			return translateResourceAssetWriteError(err)
		}
		if currentAssetID == nil {
			return nil
		}
		return translateResourceAssetWriteError(r.db.Queries(ctx).InsertSlotRevision(ctx, sqlc.InsertSlotRevisionParams{
			ResourceAssetID: id.String(),
			AssetID:         currentAssetID.String(),
			MediaType:       int16(item.MediaType),
			RevisionNo:      1,
			CreatedAt:       item.CreatedAt,
		}))
	})
}

func (r *Repository) GetResourceAssetForUpdate(ctx context.Context, resourceID, resourceAssetID string) (domainresource.ResourceAsset, error) {
	return r.getResourceAsset(ctx, resourceID, resourceAssetID, true)
}

func (r *Repository) GetResourceAsset(ctx context.Context, resourceID, resourceAssetID string) (domainresource.ResourceAsset, error) {
	return r.getResourceAsset(ctx, resourceID, resourceAssetID, false)
}

func (r *Repository) GetResourceAssetBySequenceForUpdate(ctx context.Context, resourceID string, sequenceNo int64) (domainresource.ResourceAsset, error) {
	id, err := persistenceid.Parse(resourceID)
	if err != nil || sequenceNo < 1 {
		return domainresource.ResourceAsset{}, applicationresource.ErrResourceAssetNotFound
	}
	row, err := r.db.Queries(ctx).LockSlotBySequence(ctx, sqlc.LockSlotBySequenceParams{
		ResourceID: id.String(),
		SequenceNo: sequenceNo,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainresource.ResourceAsset{}, applicationresource.ErrResourceAssetNotFound
	}
	if err != nil {
		return domainresource.ResourceAsset{}, err
	}
	return resourceAssetFromRow(row), nil
}

func (r *Repository) BatchGetResourceAssets(ctx context.Context, scope applicationresource.Scope, projectID string, resourceAssetIDs []string) ([]domainresource.ResourceAsset, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return []domainresource.ResourceAsset{}, nil
	}
	ids := persistenceid.ParseValidStrings(resourceAssetIDs)
	if len(ids) == 0 {
		return []domainresource.ResourceAsset{}, nil
	}
	rows, err := r.db.Queries(ctx).ReadVisibleSlots(ctx, sqlc.ReadVisibleSlotsParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   projectUUID.String(),
		Ids:         ids,
	})
	if err != nil {
		return nil, err
	}
	items := make([]domainresource.ResourceAsset, 0, len(rows))
	for _, row := range rows {
		items = append(items, resourceAssetFromRow(row))
	}
	return items, nil
}

func (r *Repository) ListResourceAssetsByResourceIDs(ctx context.Context, scope applicationresource.Scope, projectID string, resourceIDs []string) ([]domainresource.ResourceAsset, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return []domainresource.ResourceAsset{}, nil
	}
	ids := persistenceid.ParseValidStrings(resourceIDs)
	if len(ids) == 0 {
		return []domainresource.ResourceAsset{}, nil
	}
	rows, err := r.db.Queries(ctx).ReadVisibleResourceSlots(ctx, sqlc.ReadVisibleResourceSlotsParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   projectUUID.String(),
		Ids:         ids,
	})
	if err != nil {
		return nil, err
	}
	byResource := make(map[string][]domainresource.ResourceAsset, len(ids))
	for _, row := range rows {
		item := resourceAssetFromRow(row)
		byResource[item.ResourceID] = append(byResource[item.ResourceID], item)
	}
	items := make([]domainresource.ResourceAsset, 0, len(rows))
	for _, resourceID := range resourceIDs {
		items = append(items, byResource[resourceID]...)
	}
	return items, nil
}

func (r *Repository) getResourceAsset(ctx context.Context, resourceID, resourceAssetID string, lock bool) (domainresource.ResourceAsset, error) {
	parentID, err := persistenceid.Parse(resourceID)
	if err != nil {
		return domainresource.ResourceAsset{}, applicationresource.ErrResourceAssetNotFound
	}
	id, err := persistenceid.Parse(resourceAssetID)
	if err != nil {
		return domainresource.ResourceAsset{}, applicationresource.ErrResourceAssetNotFound
	}
	var row sqlc.ResourceAsset
	if lock {
		row, err = r.db.Queries(ctx).LockResourceSlot(ctx, sqlc.LockResourceSlotParams{
			ResourceID: parentID.String(),
			ID:         id.String(),
		})
	} else {
		row, err = r.db.Queries(ctx).ReadResourceSlot(ctx, sqlc.ReadResourceSlotParams{
			ResourceID: parentID.String(),
			ID:         id.String(),
		})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return domainresource.ResourceAsset{}, applicationresource.ErrResourceAssetNotFound
	}
	if err != nil {
		return domainresource.ResourceAsset{}, err
	}
	return resourceAssetFromRow(row), nil
}

func (r *Repository) ResourceAssetRevisionExists(ctx context.Context, resourceAssetID, assetID string) (bool, error) {
	ownerUUID, err := persistenceid.Parse(resourceAssetID)
	if err != nil {
		return false, applicationresource.ErrResourceAssetNotFound
	}
	assetUUID, err := persistenceid.Parse(assetID)
	if err != nil {
		return false, applicationresource.ErrResourceAssetNotFound
	}
	return r.db.Queries(ctx).SlotRevisionExists(ctx, sqlc.SlotRevisionExistsParams{
		ResourceAssetID: ownerUUID.String(),
		AssetID:         assetUUID.String(),
	})
}

func (r *Repository) ListResourceAssets(ctx context.Context, resourceID string, primaryID *string, pageSize, pageNum int) ([]domainresource.ResourceAsset, int64, error) {
	id, err := persistenceid.Parse(resourceID)
	if err != nil {
		return []domainresource.ResourceAsset{}, 0, nil
	}
	total, err := r.db.Queries(ctx).CountResourceSlots(ctx, id.String())
	if err != nil {
		return nil, 0, err
	}
	primary, _ := persistenceid.ParseOptional(stringValue(primaryID))
	rows, err := r.db.Queries(ctx).PageResourceSlots(ctx, sqlc.PageResourceSlotsParams{
		ResourceID: id.String(),
		PrimaryID:  persistenceid.OptionalText(primary),
		PageOffset: int64(pageNum-1) * int64(pageSize),
		PageSize:   int32(pageSize),
	})
	if err != nil {
		return nil, 0, err
	}
	items := make([]domainresource.ResourceAsset, 0, len(rows))
	for _, row := range rows {
		items = append(items, resourceAssetFromRow(row))
	}
	return items, total, nil
}

func (r *Repository) UpdateResourceAsset(ctx context.Context, item domainresource.ResourceAsset, expectedRevision int64, newAssetID *string) error {
	id, err := persistenceid.Parse(item.ID)
	if err != nil {
		return applicationresource.ErrResourceAssetNotFound
	}
	currentAssetID, err := persistenceid.ParseOptional(item.CurrentAssetID)
	if err != nil {
		return fmt.Errorf("map ResourceAsset current Asset ID: %w", err)
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		n, err := r.db.Queries(ctx).ModifyAssetSlot(ctx, sqlc.ModifyAssetSlotParams{
			ResourceID:       item.ResourceID,
			Name:             item.Name,
			CurrentAssetID:   persistenceid.OptionalText(currentAssetID),
			MediaType:        int16(item.MediaType),
			Revision:         item.Revision,
			UpdatedAt:        item.UpdatedAt,
			ID:               id.String(),
			ExpectedRevision: expectedRevision,
		})
		if err != nil {
			return translateResourceAssetWriteError(err)
		}
		if n != 1 {
			return applicationresource.ErrRevisionConflict
		}
		if newAssetID == nil {
			return nil
		}
		assetID, err := persistenceid.Parse(*newAssetID)
		if err != nil {
			return err
		}
		next, err := r.db.Queries(ctx).NextSlotRevision(ctx, id.String())
		if err != nil {
			return err
		}
		return translateResourceAssetWriteError(r.db.Queries(ctx).InsertSlotRevision(ctx, sqlc.InsertSlotRevisionParams{
			ResourceAssetID: id.String(),
			AssetID:         assetID.String(),
			MediaType:       int16(item.MediaType),
			RevisionNo:      next,
			CreatedAt:       item.UpdatedAt,
		}))
	})
}

func (r *Repository) DeleteResourceAsset(ctx context.Context, item domainresource.ResourceAsset, expectedRevision int64, now time.Time) ([]string, error) {
	id, err := persistenceid.Parse(item.ID)
	if err != nil {
		return nil, applicationresource.ErrResourceAssetNotFound
	}
	var ids []string
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		n, err := r.db.Queries(ctx).RetireAssetSlot(ctx, sqlc.RetireAssetSlotParams{
			ResourceID:       item.ResourceID,
			UpdatedAt:        now.UTC(),
			RetiredAt:        now.UnixMilli(),
			ID:               id.String(),
			ExpectedRevision: expectedRevision,
		})
		if err != nil {
			return err
		}
		if n != 1 {
			return domainresource.ErrResourceAssetRevisionConflict
		}
		ids, err = r.db.Queries(ctx).SlotRevisionAssetIDs(ctx, id.String())
		return err
	})
	if err != nil {
		return nil, err
	}
	return ids, nil
}

func (r *Repository) Delete(ctx context.Context, item domainresource.Resource, now time.Time) error {
	_, err := r.DeleteWithRevisionAssets(ctx, item, now)
	return err
}

func (r *Repository) DeleteWithRevisionAssets(ctx context.Context, item domainresource.Resource, now time.Time) ([]string, error) {
	id, err := persistenceid.Parse(item.ID)
	if err != nil {
		return nil, applicationresource.ErrNotFound
	}
	var ids []string
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		n, err := r.db.Queries(ctx).RetireResource(ctx, sqlc.RetireResourceParams{
			TenantID: item.TenantID, WorkspaceID: item.WorkspaceID, OwnerType: int16(item.OwnerType), OwnerID: item.OwnerID,
			Revision:         item.Revision,
			UpdatedAt:        item.UpdatedAt,
			RetiredAt:        now.UnixMilli(),
			ID:               id.String(),
			ExpectedRevision: item.Revision - 1,
		})
		if err != nil {
			return err
		}
		if n != 1 {
			return applicationresource.ErrRevisionConflict
		}
		ids, err = r.db.Queries(ctx).ResourceRevisionAssetIDs(ctx, id.String())
		if err != nil {
			return err
		}
		if err := r.db.Queries(ctx).RetireResourceSlots(ctx, sqlc.RetireResourceSlotsParams{
			RetiredAt:  now.UnixMilli(),
			UpdatedAt:  now.UTC(),
			ResourceID: id.String(),
		}); err != nil {
			return err
		}
		return r.db.Queries(ctx).RetireResourceRelations(ctx, sqlc.RetireResourceRelationsParams{
			RetiredAt:  now.UnixMilli(),
			ResourceID: id.String(),
		})
	})
	if err != nil {
		return nil, err
	}
	return ids, nil
}

func (r *Repository) ListByProjectForUpdate(ctx context.Context, scope applicationresource.Scope, projectID string) ([]domainresource.Resource, error) {
	id, err := persistenceid.Parse(projectID)
	if err != nil {
		return []domainresource.Resource{}, nil
	}
	rows, err := r.db.Queries(ctx).LockOwnedResources(ctx, sqlc.LockOwnedResourcesParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   id.String(),
	})
	if err != nil {
		return nil, err
	}
	return domainsFromRows(rows), nil
}

func rowFromDomain(item domainresource.Resource) (sqlc.Resource, error) {
	id, err := persistenceid.Parse(item.ID)
	if err != nil {
		return sqlc.Resource{}, fmt.Errorf("map Resource ID: %w", err)
	}
	ownerID, err := persistenceid.Parse(item.OwnerID)
	if err != nil {
		return sqlc.Resource{}, fmt.Errorf("map Resource owner ID: %w", err)
	}
	primaryID, err := persistenceid.ParseOptional(stringValue(item.PrimaryResourceAssetID))
	if err != nil {
		return sqlc.Resource{}, fmt.Errorf("map Resource primary asset ID: %w", err)
	}
	row := sqlc.Resource{
		ID:                     id.String(),
		TenantID:               item.TenantID,
		WorkspaceID:            cloneString(item.WorkspaceID),
		OwnerType:              int16(item.OwnerType),
		OwnerID:                ownerID.String(),
		Type:                   int16(item.Type),
		Name:                   item.Name,
		Description:            item.Description,
		PrimaryResourceAssetID: persistenceid.OptionalText(primaryID),
		Revision:               item.Revision,
		ResourceAssetCount:     item.ResourceAssetCount,
		CreatedBy:              item.CreatedBy,
		CreatedAt:              item.CreatedAt,
		UpdatedAt:              item.UpdatedAt,
	}
	if item.DeletedAt != nil {
		millis := item.DeletedAt.UnixMilli()
		row.DeletedAt = &millis
	}
	return row, nil
}

func domainFromRow(row sqlc.Resource) domainresource.Resource {
	return domainresource.Resource{
		ID: row.ID, TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID), OwnerType: domainresource.OwnerType(row.OwnerType), OwnerID: row.OwnerID, Type: domainresource.Type(row.Type), Name: row.Name, Description: row.Description, PrimaryResourceAssetID: cloneString(row.PrimaryResourceAssetID), Revision: row.Revision, ResourceAssetCount: row.ResourceAssetCount, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, DeletedAt: deletedAt(row.DeletedAt),
	}
}

func resourceAssetFromRow(row sqlc.ResourceAsset) domainresource.ResourceAsset {
	return domainresource.ResourceAsset{
		ID:                     row.ID,
		ResourceID:             row.ResourceID,
		Name:                   row.Name,
		SequenceNo:             row.SequenceNo,
		SourceType:             domainresource.SourceType(row.SourceType),
		CurrentAssetID:         stringValue(row.CurrentAssetID),
		ImageGenerationDraftID: stringValue(row.ImageGenerationDraftID),
		MediaType:              domainasset.MediaType(row.MediaType),
		Revision:               row.Revision,
		CreatedAt:              row.CreatedAt,
		UpdatedAt:              row.UpdatedAt,
		DeletedAt:              deletedAt(row.DeletedAt),
	}
}

func domainsFromRows(rows []sqlc.Resource) []domainresource.Resource {
	items := make([]domainresource.Resource, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row))
	}
	return items
}

func translateWriteError(err error) error {
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) && databaseError.Code == "23505" {
		return applicationresource.ErrNameConflict
	}
	return err
}

func translateResourceAssetWriteError(err error) error {
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) && databaseError.Code == "23505" {
		return applicationresource.ErrResourceAssetNameConflict
	}
	return err
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func deletedAt(value *int64) *time.Time {
	if value == nil || *value == 0 {
		return nil
	}
	result := time.UnixMilli(*value).UTC()
	return &result
}
