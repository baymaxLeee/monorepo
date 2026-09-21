package resource

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	applicationpackage "github.com/example/monorepo/canvas/internal/server/application/benefitpackage"
	applicationresource "github.com/example/monorepo/canvas/internal/server/application/resource"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domainresource "github.com/example/monorepo/canvas/internal/server/domain/resource"
)

type Repository struct{ db *gorm.DB }

const maxActiveResourcesPerProjectType = 10_000

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// ValidateReviewAsset proves that the resource belongs to the requested project
// and that the submitted Asset is still the resource asset's current revision.
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
	query := persistencetransaction.DB(ctx, r.db).Table("resources").
		Joins("JOIN project_resource_rel ON project_resource_rel.resource_id = resources.id AND project_resource_rel.deleted_at = 0").
		Joins("JOIN resource_assets ON resource_assets.resource_id = resources.id AND resource_assets.deleted_at = 0").
		Where("resources.id = ? AND resources.tenant_id = ? AND project_resource_rel.project_id = ? AND resource_assets.current_asset_id = ?", resourceUUID, scope.TenantID, projectUUID, assetUUID)
	if scope.WorkspaceID == nil {
		query = query.Where("resources.workspace_id IS NULL")
	} else {
		query = query.Where("resources.workspace_id = ?", *scope.WorkspaceID)
	}
	var count int64
	if err = query.Count(&count).Error; err != nil {
		return fmt.Errorf("validate review asset: %w", err)
	}
	if count != 1 {
		return applicationresource.ErrNotFound
	}
	return nil
}

func (r *Repository) Create(ctx context.Context, item domainresource.Resource) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	projectID, err := persistenceid.Parse(item.OwnerID)
	if err != nil {
		return fmt.Errorf("map Resource project ID: %w", err)
	}
	err = persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		var project resourceProjectScopeRow
		query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND tenant_id = ?", projectID, item.TenantID)
		if item.WorkspaceID == nil {
			query = query.Where("workspace_id IS NULL")
		} else {
			query = query.Where("workspace_id = ?", *item.WorkspaceID)
		}
		if err := query.First(&project).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return applicationresource.ErrProjectNotFound
			}
			return err
		}
		var count int64
		if err := tx.Model(&resourceRow{}).Where("owner_type = ? AND owner_id = ? AND type = ?", row.OwnerType, row.OwnerID, row.Type).Count(&count).Error; err != nil {
			return err
		}
		if count >= maxActiveResourcesPerProjectType {
			return applicationresource.ErrLimitExceeded
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		return tx.Create(&projectResourceRelationRow{ProjectID: projectID, ResourceID: row.ID, CreatedAt: item.CreatedAt}).Error
	})
	return translateWriteError(err)
}

func (r *Repository) ValidateCreate(ctx context.Context, item domainresource.Resource) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	projectID, err := persistenceid.Parse(item.OwnerID)
	if err != nil {
		return fmt.Errorf("map Resource project ID: %w", err)
	}
	db := persistencetransaction.DB(ctx, r.db)
	query := db.Where("id = ? AND tenant_id = ?", projectID, item.TenantID)
	if item.WorkspaceID == nil {
		query = query.Where("workspace_id IS NULL")
	} else {
		query = query.Where("workspace_id = ?", *item.WorkspaceID)
	}
	var project resourceProjectScopeRow
	if err = query.First(&project).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return applicationresource.ErrProjectNotFound
		}
		return err
	}
	var count int64
	if err = db.Model(&resourceRow{}).Where("owner_type = ? AND owner_id = ? AND type = ?", row.OwnerType, row.OwnerID, row.Type).Count(&count).Error; err != nil {
		return err
	}
	if count >= maxActiveResourcesPerProjectType {
		return applicationresource.ErrLimitExceeded
	}
	if err = db.Model(&resourceRow{}).Where("owner_type = ? AND owner_id = ? AND name = ?", row.OwnerType, row.OwnerID, row.Name).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
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
	var row resourceRow
	if err = readableQuery(persistencetransaction.DB(ctx, r.db), scope, projectUUID).Where("resources.id = ?", resourceUUID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domainresource.Resource{}, applicationresource.ErrNotFound
		}
		return domainresource.Resource{}, err
	}
	items := []domainresource.Resource{domainFromRow(row)}
	if err = r.hydrateApprovedResourceAssetCounts(ctx, items); err != nil {
		return domainresource.Resource{}, err
	}
	return items[0], nil
}

func (r *Repository) BatchGet(ctx context.Context, scope applicationresource.Scope, projectID string, resourceIDs []string) ([]domainresource.Resource, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return []domainresource.Resource{}, nil
	}
	ids := persistenceid.ParseValid(resourceIDs)
	if len(ids) == 0 {
		return []domainresource.Resource{}, nil
	}
	var rows []resourceRow
	if err = readableQuery(persistencetransaction.DB(ctx, r.db), scope, projectUUID).Where("resources.id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	items := domainsFromRows(rows)
	if err = r.hydrateApprovedResourceAssetCounts(ctx, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *Repository) List(ctx context.Context, query applicationresource.ListQuery) ([]domainresource.Resource, int64, error) {
	projectID, err := persistenceid.Parse(query.ProjectID)
	if err != nil {
		return []domainresource.Resource{}, 0, nil
	}
	orderBy, err := resourceListOrder(query.SortField, query.SortDirection)
	if err != nil {
		return nil, 0, err
	}
	db := readableQuery(persistencetransaction.DB(ctx, r.db), query.Scope, projectID)
	if query.Type != nil {
		db = db.Where("resources.type = ?", int16(*query.Type))
	}
	if query.Keyword != "" {
		db = db.Where("resources.name LIKE ?", "%"+query.Keyword+"%")
	}
	var total int64
	if err = db.Distinct("resources.id").Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []resourceRow
	// 用户资源优先（PROJECT 先于 OFFICIAL），再按调用方选择的排序字段与方向；
	// id 兜底保证分页稳定。owner_type 的取值顺序不代表优先级，因此显式用 CASE 而非直接排序该列。
	if err = db.Select(
		"resources.*, CASE WHEN resources.owner_type = ? THEN 1 ELSE 0 END AS official_rank",
		domainresource.OwnerOfficial,
	).Distinct().Clauses(orderBy).Limit(query.PageSize).Offset((query.PageNum - 1) * query.PageSize).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	items := domainsFromRows(rows)
	if err = r.hydrateApprovedResourceAssetCounts(ctx, items); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

type approvedResourceAssetCountRow struct {
	ResourceID    persistenceid.UUID `gorm:"column:resource_id"`
	ApprovedCount int32              `gorm:"column:approved_count"`
}

type resourceTypeCountRow struct {
	Type  int16 `gorm:"column:type"`
	Count int32 `gorm:"column:count"`
}

func (r *Repository) StatsByProject(ctx context.Context, scope applicationresource.Scope, projectID string) (applicationresource.ResourceStats, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return applicationresource.ResourceStats{}, nil
	}
	var rows []resourceTypeCountRow
	err = readableQuery(persistencetransaction.DB(ctx, r.db), scope, projectUUID).
		Select("resources.type, COUNT(DISTINCT resources.id) AS count").
		Group("resources.type").
		Scan(&rows).Error
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
	resourceIDs := make([]persistenceid.UUID, 0, len(items))
	for _, item := range items {
		id, err := persistenceid.Parse(item.ID)
		if err != nil {
			return fmt.Errorf("map Resource ID for approved asset count: %w", err)
		}
		resourceIDs = append(resourceIDs, id)
	}
	var rows []approvedResourceAssetCountRow
	err := persistencetransaction.DB(ctx, r.db).
		Table("resource_assets").
		Select("resource_assets.resource_id, COUNT(DISTINCT resource_assets.id) AS approved_count").
		Joins("JOIN asset_reviews ON asset_reviews.asset_id = resource_assets.current_asset_id AND asset_reviews.deleted_at = 0 AND asset_reviews.status = ?", domainasset.ReviewStatusApproved).
		Where("resource_assets.deleted_at = 0 AND resource_assets.resource_id IN ?", resourceIDs).
		Group("resource_assets.resource_id").
		Scan(&rows).Error
	if err != nil {
		return fmt.Errorf("count approved ResourceAssets: %w", err)
	}
	counts := make(map[string]int32, len(rows))
	for _, row := range rows {
		counts[row.ResourceID.String()] = row.ApprovedCount
	}
	for index := range items {
		items[index].ApprovedResourceAssetCount = counts[items[index].ID]
	}
	return nil
}

func resourceListOrder(
	field applicationresource.SortField, direction applicationresource.SortDirection,
) (clause.OrderBy, error) {
	column := clause.Column{Table: "resources", Name: "updated_at"}
	switch field {
	case applicationresource.SortUnspecified, applicationresource.SortUpdatedAt:
	case applicationresource.SortCreatedAt:
		column.Name = "created_at"
	default:
		return clause.OrderBy{}, gorm.ErrInvalidData
	}
	descending := true
	switch direction {
	case applicationresource.SortDirectionUnspecified, applicationresource.SortDescending:
	case applicationresource.SortAscending:
		descending = false
	default:
		return clause.OrderBy{}, gorm.ErrInvalidData
	}
	return clause.OrderBy{Columns: []clause.OrderByColumn{
		{Column: clause.Column{Name: "official_rank"}},
		{Column: column, Desc: descending},
		{Column: clause.Column{Table: "resources", Name: "id"}, Desc: descending},
	}}, nil
}

func (r *Repository) Update(ctx context.Context, item domainresource.Resource) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	if item.Revision < 2 {
		return applicationresource.ErrRevisionConflict
	}
	result := persistencetransaction.DB(ctx, r.db).Model(&resourceRow{}).
		Where("id = ? AND tenant_id = ? AND owner_type = ? AND owner_id = ? AND revision = ?", row.ID, row.TenantID, row.OwnerType, row.OwnerID, row.Revision-1).
		Scopes(workspaceScope(row.WorkspaceID)).Updates(map[string]any{
		"name": row.Name, "description": row.Description, "primary_resource_asset_id": row.PrimaryResourceAssetID,
		"revision": row.Revision, "resource_asset_count": row.ResourceAssetCount, "updated_at": row.UpdatedAt,
	})
	if result.Error != nil {
		return translateWriteError(result.Error)
	}
	if result.RowsAffected == 0 {
		return applicationresource.ErrRevisionConflict
	}
	return nil
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
	db := persistencetransaction.DB(ctx, r.db)
	if err = lockActiveProject(db, scope, projectUUID); err != nil {
		return domainresource.Resource{}, err
	}
	var row resourceRow
	if err = scopedQuery(db, scope, projectUUID).Clauses(clause.Locking{Strength: "UPDATE"}).Where("resources.id = ?", resourceUUID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domainresource.Resource{}, applicationresource.ErrNotFound
		}
		return domainresource.Resource{}, err
	}
	return domainFromRow(row), nil
}

func lockActiveProject(db *gorm.DB, scope applicationresource.Scope, projectID persistenceid.UUID) error {
	query := db.Model(&resourceProjectScopeRow{}).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND tenant_id = ?", projectID, scope.TenantID)
	if scope.WorkspaceID == nil {
		query = query.Where("workspace_id IS NULL")
	} else {
		query = query.Where("workspace_id = ?", *scope.WorkspaceID)
	}
	var project resourceProjectScopeRow
	if err := query.First(&project).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return applicationresource.ErrNotFound
		}
		return err
	}
	return nil
}

func (r *Repository) NextResourceAssetSequence(ctx context.Context, resourceID string) (int64, error) {
	id, err := persistenceid.Parse(resourceID)
	if err != nil {
		return 0, applicationresource.ErrNotFound
	}
	var maximum int64
	if err = persistencetransaction.DB(ctx, r.db).Unscoped().Model(&resourceAssetRow{}).Select("COALESCE(MAX(sequence_no), 0)").Where("resource_id = ?", id).Scan(&maximum).Error; err != nil {
		return 0, err
	}
	return maximum + 1, nil
}

func (r *Repository) ResourceAssetNameExists(ctx context.Context, resourceID, name string) (bool, error) {
	id, err := persistenceid.Parse(resourceID)
	if err != nil {
		return false, applicationresource.ErrNotFound
	}
	var count int64
	if err = persistencetransaction.DB(ctx, r.db).Model(&resourceAssetRow{}).Where("resource_id = ? AND name = ?", id, name).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
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
	db := persistencetransaction.DB(ctx, r.db)
	if err = db.Create(&resourceAssetRow{ID: id, ResourceID: resourceID, Name: item.Name, SequenceNo: item.SequenceNo, SourceType: int16(item.SourceType), CurrentAssetID: currentAssetID, ImageGenerationDraftID: imageGenerationDraftID, MediaType: int16(item.MediaType), Revision: item.Revision, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}).Error; err != nil {
		return translateResourceAssetWriteError(err)
	}
	if currentAssetID == nil {
		return nil
	}
	revisionAssetID, err := persistenceid.Parse(assetID)
	if err != nil {
		return fmt.Errorf("map ResourceAsset revision Asset ID: %w", err)
	}
	if err = db.Create(&resourceAssetRevisionRow{ResourceAssetID: id, AssetID: revisionAssetID, MediaType: int16(item.MediaType), RevisionNo: 1, CreatedAt: item.CreatedAt}).Error; err != nil {
		return translateResourceAssetWriteError(err)
	}
	return nil
}

func (r *Repository) GetResourceAssetForUpdate(ctx context.Context, resourceID, resourceAssetID string) (domainresource.ResourceAsset, error) {
	return r.getResourceAsset(ctx, resourceID, resourceAssetID, true)
}

func (r *Repository) GetResourceAssetBySequenceForUpdate(ctx context.Context, resourceID string, sequenceNo int64) (domainresource.ResourceAsset, error) {
	id, err := persistenceid.Parse(resourceID)
	if err != nil || sequenceNo < 1 {
		return domainresource.ResourceAsset{}, applicationresource.ErrResourceAssetNotFound
	}
	var row resourceAssetRow
	err = persistencetransaction.DB(ctx, r.db).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("resource_id = ? AND sequence_no = ?", id, sequenceNo).First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domainresource.ResourceAsset{}, applicationresource.ErrResourceAssetNotFound
		}
		return domainresource.ResourceAsset{}, err
	}
	return resourceAssetFromRow(row), nil
}

func (r *Repository) GetResourceAsset(ctx context.Context, resourceID, resourceAssetID string) (domainresource.ResourceAsset, error) {
	return r.getResourceAsset(ctx, resourceID, resourceAssetID, false)
}

func (r *Repository) BatchGetResourceAssets(ctx context.Context, scope applicationresource.Scope, projectID string, resourceAssetIDs []string) ([]domainresource.ResourceAsset, error) {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return []domainresource.ResourceAsset{}, nil
	}
	ids := persistenceid.ParseValid(resourceAssetIDs)
	if len(ids) == 0 {
		return []domainresource.ResourceAsset{}, nil
	}
	base := persistencetransaction.DB(ctx, r.db)
	// 读路径：Project 归属用 EXISTS 表达，并并入本 tenant 的 OFFICIAL Resource 的绑定项。
	ownedByProject := base.Session(&gorm.Session{NewDB: true}).
		Table("project_resource_rel prr").
		Select("1").
		Joins("JOIN projects p ON p.id = prr.project_id AND p.deleted_at = 0").
		Where("prr.resource_id = resources.id AND prr.deleted_at = 0 AND prr.project_id = ?", projectUUID)
	query := base.Model(&resourceAssetRow{}).
		Joins("JOIN resources ON resources.id = resource_assets.resource_id AND resources.deleted_at = 0").
		Where("resources.tenant_id = ? AND resource_assets.id IN ?", scope.TenantID, ids).
		Where(
			base.Session(&gorm.Session{NewDB: true}).
				Where("resources.owner_type = ? AND resources.owner_id = ? AND EXISTS (?)", domainresource.OwnerProject, projectUUID, ownedByProject).
				Or("resources.owner_type = ?", domainresource.OwnerOfficial),
		)
	if scope.WorkspaceID == nil {
		query = query.Where("resources.workspace_id IS NULL")
	} else {
		query = query.Where("resources.workspace_id = ?", *scope.WorkspaceID)
	}
	var rows []resourceAssetRow
	if err = query.Find(&rows).Error; err != nil {
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
	ids := persistenceid.ParseValid(resourceIDs)
	if len(ids) == 0 {
		return []domainresource.ResourceAsset{}, nil
	}
	var rows []resourceAssetRow
	query := readableQuery(persistencetransaction.DB(ctx, r.db), scope, projectUUID).
		Select("resource_assets.*").
		Joins("JOIN resource_assets ON resource_assets.resource_id = resources.id AND resource_assets.deleted_at = 0").
		Where("resources.id IN ?", ids).
		Order("resource_assets.sequence_no ASC").
		Order("resource_assets.id ASC")
	if err = query.Find(&rows).Error; err != nil {
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
	var row resourceAssetRow
	query := persistencetransaction.DB(ctx, r.db).Where("id = ? AND resource_id = ?", id, parentID)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err = query.First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domainresource.ResourceAsset{}, applicationresource.ErrResourceAssetNotFound
		}
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
	var count int64
	err = persistencetransaction.DB(ctx, r.db).Model(&resourceAssetRevisionRow{}).
		Where("resource_asset_id = ? AND asset_id = ?", ownerUUID, assetUUID).
		Count(&count).Error
	return count > 0, err
}

func (r *Repository) ListResourceAssets(ctx context.Context, resourceID string, primaryID *string, pageSize, pageNum int) ([]domainresource.ResourceAsset, int64, error) {
	id, err := persistenceid.Parse(resourceID)
	if err != nil {
		return []domainresource.ResourceAsset{}, 0, nil
	}
	db := persistencetransaction.DB(ctx, r.db).Model(&resourceAssetRow{}).Where("resource_id = ?", id)
	var total int64
	if err = db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []resourceAssetRow
	orderBy := clause.OrderBy{Columns: []clause.OrderByColumn{
		{Column: clause.Column{Table: "resource_assets", Name: "sequence_no"}},
		{Column: clause.Column{Table: "resource_assets", Name: "id"}},
	}}
	if primaryID != nil {
		if primaryUUID, parseErr := persistenceid.Parse(*primaryID); parseErr == nil {
			db = db.Select(
				"resource_assets.*, CASE WHEN resource_assets.id = ? THEN 0 ELSE 1 END AS primary_rank",
				primaryUUID,
			)
			orderBy.Columns = append([]clause.OrderByColumn{
				{Column: clause.Column{Name: "primary_rank"}},
			}, orderBy.Columns...)
		}
	}
	if err = db.Clauses(orderBy).Limit(pageSize).Offset((pageNum - 1) * pageSize).Find(&rows).Error; err != nil {
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
	db := persistencetransaction.DB(ctx, r.db)
	return db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&resourceAssetRow{}).Where("id = ? AND revision = ?", id, expectedRevision).Updates(map[string]any{"name": item.Name, "current_asset_id": currentAssetID, "media_type": int16(item.MediaType), "revision": item.Revision, "updated_at": item.UpdatedAt})
		if result.Error != nil {
			return translateResourceAssetWriteError(result.Error)
		}
		if result.RowsAffected == 0 {
			return applicationresource.ErrRevisionConflict
		}
		if newAssetID == nil {
			return nil
		}
		assetID, parseErr := persistenceid.Parse(*newAssetID)
		if parseErr != nil {
			return fmt.Errorf("map revision Asset ID: %w", parseErr)
		}
		var maxRevision int64
		if queryErr := tx.Model(&resourceAssetRevisionRow{}).Select("COALESCE(MAX(revision_no), 0)").Where("resource_asset_id = ?", id).Scan(&maxRevision).Error; queryErr != nil {
			return queryErr
		}
		return translateResourceAssetWriteError(tx.Create(&resourceAssetRevisionRow{ResourceAssetID: id, AssetID: assetID, MediaType: int16(item.MediaType), RevisionNo: maxRevision + 1, CreatedAt: item.UpdatedAt}).Error)
	})
}

func (r *Repository) DeleteResourceAsset(ctx context.Context, item domainresource.ResourceAsset, expectedRevision int64, now time.Time) ([]string, error) {
	id, err := persistenceid.Parse(item.ID)
	if err != nil {
		return nil, applicationresource.ErrResourceAssetNotFound
	}
	db := persistencetransaction.DB(ctx, r.db)
	assetIDs, err := listRevisionAssetIDs(db, "resource_asset_id = ?", id)
	if err != nil {
		return nil, err
	}
	result := db.Model(&resourceAssetRow{}).Where("id = ? AND revision = ?", id, expectedRevision).Updates(map[string]any{
		"revision": expectedRevision + 1, "updated_at": now.UTC(), "deleted_at": soft_delete.DeletedAt(now.UnixMilli()),
	})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, domainresource.ErrResourceAssetRevisionConflict
	}
	return assetIDs, nil
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
	db := persistencetransaction.DB(ctx, r.db)
	assetIDs, err := listRevisionAssetIDs(db, "resource_asset_id IN (?)", db.Model(&resourceAssetRow{}).Select("id").Where("resource_id = ? AND deleted_at = 0", id))
	if err != nil {
		return nil, err
	}
	deletedAt := soft_delete.DeletedAt(now.UnixMilli())
	if err = db.Model(&resourceAssetRow{}).Where("resource_id = ?", id).Update("deleted_at", deletedAt).Error; err != nil {
		return nil, err
	}
	if err = db.Model(&projectResourceRelationRow{}).Where("resource_id = ?", id).Update("deleted_at", deletedAt).Error; err != nil {
		return nil, err
	}
	result := db.Model(&resourceRow{}).Where("id = ? AND revision = ?", id, item.Revision-1).Updates(map[string]any{"revision": item.Revision, "updated_at": item.UpdatedAt, "deleted_at": deletedAt})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, applicationresource.ErrRevisionConflict
	}
	return assetIDs, nil
}

func listRevisionAssetIDs(db *gorm.DB, predicate string, args ...any) ([]string, error) {
	var ids []persistenceid.UUID
	if err := db.Model(&resourceAssetRevisionRow{}).
		Distinct("asset_id").
		Where(predicate, args...).
		Order("asset_id").
		Pluck("asset_id", &ids).Error; err != nil {
		return nil, err
	}
	result := make([]string, len(ids))
	for index := range ids {
		result[index] = ids[index].String()
	}
	return result, nil
}

func (r *Repository) ListByProjectForUpdate(ctx context.Context, scope applicationresource.Scope, projectID string) ([]domainresource.Resource, error) {
	id, err := persistenceid.Parse(projectID)
	if err != nil {
		return []domainresource.Resource{}, nil
	}
	var rows []resourceRow
	if err = ownedProjectResourcesQuery(persistencetransaction.DB(ctx, r.db), scope, id).Clauses(clause.Locking{Strength: "UPDATE"}).Order("resources.id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return domainsFromRows(rows), nil
}

// scopedQuery 是写路径使用的 Project 归属查询：只命中该 Project 拥有的 PROJECT
// Resource，并要求 Project 仍然存在。OFFICIAL Resource 故意不在此可见——运行时
// 不得写 OFFICIAL（ADR-002），因此加锁与写入路径不应取到它。
func scopedQuery(db *gorm.DB, scope applicationresource.Scope, projectID persistenceid.UUID) *gorm.DB {
	db = db.Model(&resourceRow{}).
		Joins("JOIN project_resource_rel prr ON prr.resource_id = resources.id AND prr.deleted_at = 0").
		Joins("JOIN projects p ON p.id = prr.project_id AND p.deleted_at = 0").
		Where("prr.project_id = ? AND resources.tenant_id = ? AND resources.owner_type = ? AND resources.owner_id = ?", projectID, scope.TenantID, domainresource.OwnerProject, projectID)
	return db.Scopes(workspaceScope(scope.WorkspaceID))
}

// readableQuery 是读路径（Get / BatchGet / List）使用的查询：在 Project 归属之外
// 并入本 tenant 的 OFFICIAL Resource。OFFICIAL 不属于任何 Project，也就没有
// project_resource_rel 行，因此用 EXISTS 子查询表达 Project 归属，避免 INNER JOIN
// 把官方记录整体排除；同时 EXISTS 不会因一条 Resource 被多个 Project 引用而产生重复行。
func readableQuery(db *gorm.DB, scope applicationresource.Scope, projectID persistenceid.UUID) *gorm.DB {
	ownedByProject := db.Session(&gorm.Session{NewDB: true}).
		Table("project_resource_rel prr").
		Select("1").
		Joins("JOIN projects p ON p.id = prr.project_id AND p.deleted_at = 0").
		Where("prr.resource_id = resources.id AND prr.deleted_at = 0 AND prr.project_id = ?", projectID)

	db = db.Model(&resourceRow{}).
		Where("resources.tenant_id = ?", scope.TenantID).
		Where(
			db.Session(&gorm.Session{NewDB: true}).
				Where("resources.owner_type = ? AND resources.owner_id = ? AND EXISTS (?)", domainresource.OwnerProject, projectID, ownedByProject).
				Or("resources.owner_type = ?", domainresource.OwnerOfficial),
		)
	return db.Scopes(workspaceScope(scope.WorkspaceID))
}

// ownedProjectResourcesQuery intentionally does not require an active Project:
// project cleanup runs after the parent deletion has committed.
func ownedProjectResourcesQuery(db *gorm.DB, scope applicationresource.Scope, projectID persistenceid.UUID) *gorm.DB {
	db = db.Model(&resourceRow{}).
		Where("resources.tenant_id = ? AND resources.owner_type = ? AND resources.owner_id = ?", scope.TenantID, domainresource.OwnerProject, projectID)
	return db.Scopes(workspaceScope(scope.WorkspaceID))
}

func workspaceScope(workspaceID *string) func(*gorm.DB) *gorm.DB {
	return func(db *gorm.DB) *gorm.DB {
		column := clause.Column{Table: "resources", Name: "workspace_id"}
		if workspaceID == nil {
			return db.Where(clause.Eq{Column: column, Value: nil})
		}
		return db.Where(clause.Eq{Column: column, Value: *workspaceID})
	}
}

func rowFromDomain(item domainresource.Resource) (resourceRow, error) {
	id, err := persistenceid.Parse(item.ID)
	if err != nil {
		return resourceRow{}, fmt.Errorf("map Resource ID: %w", err)
	}
	ownerID, err := persistenceid.Parse(item.OwnerID)
	if err != nil {
		return resourceRow{}, fmt.Errorf("map Resource owner ID: %w", err)
	}
	primaryID, err := persistenceid.ParseOptional(stringValue(item.PrimaryResourceAssetID))
	if err != nil {
		return resourceRow{}, fmt.Errorf("map Resource primary asset ID: %w", err)
	}
	row := resourceRow{ID: id, TenantID: item.TenantID, WorkspaceID: cloneString(item.WorkspaceID), OwnerType: int16(item.OwnerType), OwnerID: ownerID, Type: int16(item.Type), Name: item.Name, Description: item.Description, PrimaryResourceAssetID: primaryID, Revision: item.Revision, ResourceAssetCount: item.ResourceAssetCount, CreatedBy: item.CreatedBy, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
	if item.DeletedAt != nil {
		row.DeletedAt = soft_delete.DeletedAt(item.DeletedAt.UnixMilli())
	}
	return row, nil
}

func domainFromRow(row resourceRow) domainresource.Resource {
	return domainresource.Resource{
		ID: row.ID.String(), TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID), OwnerType: domainresource.OwnerType(row.OwnerType), OwnerID: row.OwnerID.String(), Type: domainresource.Type(row.Type), Name: row.Name, Description: row.Description, PrimaryResourceAssetID: uuidStringPointer(row.PrimaryResourceAssetID), Revision: row.Revision, ResourceAssetCount: row.ResourceAssetCount, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, DeletedAt: deletedAt(row.DeletedAt),
	}
}

func resourceAssetFromRow(row resourceAssetRow) domainresource.ResourceAsset {
	return domainresource.ResourceAsset{ID: row.ID.String(), ResourceID: row.ResourceID.String(), Name: row.Name, SequenceNo: row.SequenceNo, SourceType: domainresource.SourceType(row.SourceType), CurrentAssetID: uuidString(row.CurrentAssetID), ImageGenerationDraftID: uuidString(row.ImageGenerationDraftID), MediaType: domainasset.MediaType(row.MediaType), Revision: row.Revision, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, DeletedAt: deletedAt(row.DeletedAt)}
}
func domainsFromRows(rows []resourceRow) []domainresource.Resource {
	items := make([]domainresource.Resource, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row))
	}
	return items
}
func translateWriteError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return applicationresource.ErrNameConflict
	}
	return err
}

func translateResourceAssetWriteError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
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
func uuidStringPointer(value *persistenceid.UUID) *string {
	if value == nil {
		return nil
	}
	result := value.String()
	return &result
}
func uuidString(value *persistenceid.UUID) string {
	if value == nil {
		return ""
	}
	return value.String()
}
func deletedAt(value soft_delete.DeletedAt) *time.Time {
	if value == 0 {
		return nil
	}
	result := time.UnixMilli(int64(value)).UTC()
	return &result
}
