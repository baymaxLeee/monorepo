package asset

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/plugin/soft_delete"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	scopelifecycle "github.com/example/monorepo/canvas/internal/infrastructure/persistence/scopelifecycle"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) dbFor(ctx context.Context) *gorm.DB {
	return persistencetransaction.DB(ctx, r.db)
}

func (r *Repository) Create(ctx context.Context, item domainasset.Asset) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	return persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		if err := scopelifecycle.LockActive(tx, item.TenantID, item.WorkspaceID); err != nil {
			return err
		}
		// The early resolver prevents wasted artifact storage calls. Rechecking the owner under
		// a row lock here closes the deletion window before the Asset insert.
		var ownerErr error
		switch item.OwnerType {
		case domainasset.OwnerProject:
			ownerErr = findProjectOwner(tx, item.TenantID, item.WorkspaceID, item.OwnerID, true)
		case domainasset.OwnerResource:
			ownerErr = findResourceOwner(tx, item.TenantID, item.WorkspaceID, item.OwnerID, true)
		case domainasset.OwnerOfficial:
			// 官方 Asset 的 owner_id 是按 scope 派生的哨兵，不对应任何 project/resource 行。
			// 它由受信对账在物化官方 Resource 之前创建，因此这里不做 owner 实体校验；GC 由
			// OFFICIAL_ASSET_UPLOAD 账本 owner 兜底，不会因缺少 owner 行而被清理。
			ownerErr = nil
		default:
			ownerErr = applicationasset.ErrOwnerNotFound
		}
		if ownerErr != nil {
			return ownerErr
		}
		return tx.Create(&row).Error
	})
}

func (r *Repository) Get(ctx context.Context, scope applicationasset.Scope, assetID string) (domainasset.Asset, error) {
	return r.get(ctx, scope, assetID, false)
}

func (r *Repository) GetForUpdate(ctx context.Context, scope applicationasset.Scope, assetID string) (domainasset.Asset, error) {
	return r.get(ctx, scope, assetID, true)
}

func (r *Repository) GetReferenced(
	ctx context.Context,
	scope applicationasset.Scope,
	owner applicationasset.ReferenceOwner,
	assetID string,
	lock bool,
) (domainasset.Asset, error) {
	id, err := persistenceid.Parse(assetID)
	if err != nil || !owner.Type.Valid() || owner.Key == "" {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	var row assetRow
	query := assetScopeQuery(r.dbFor(ctx), scope).
		Joins("JOIN asset_references ON asset_references.asset_id = assets.id AND asset_references.owner_type = ? AND asset_references.owner_key = ? AND asset_references.deleted_at = 0", owner.Type, owner.Key).
		Where("assets.id = ?", id)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE", Table: clause.Table{Name: "assets"}})
	}
	if err = query.First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domainasset.Asset{}, applicationasset.ErrNotFound
		}
		return domainasset.Asset{}, err
	}
	return domainFromRow(row), nil
}

// GetCommitted intentionally ignores any enclosing transaction: reconciliation
// must never mistake uncommitted rows in a failed transaction for durable data.
func (r *Repository) GetCommitted(ctx context.Context, scope applicationasset.Scope, assetID string) (domainasset.Asset, error) {
	id, err := persistenceid.Parse(assetID)
	if err != nil {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	var row assetRow
	err = assetScopeQuery(r.db.WithContext(ctx).Unscoped(), scope).Where("id = ?", id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	if err != nil {
		return domainasset.Asset{}, err
	}
	return domainFromRow(row), nil
}

func (r *Repository) GetByCreationKey(
	ctx context.Context,
	scope applicationasset.Scope,
	ownerType domainasset.OwnerType,
	ownerID string,
	creationKey string,
) (domainasset.Asset, error) {
	ownerUUID, err := persistenceid.Parse(ownerID)
	if err != nil {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	var row assetRow
	err = assetScopeQuery(persistencetransaction.DB(ctx, r.db), scope).
		Where("owner_type = ? AND owner_id = ? AND creation_key = ?", int16(ownerType), ownerUUID, creationKey).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	if err != nil {
		return domainasset.Asset{}, err
	}
	return domainFromRow(row), nil
}

func (r *Repository) get(ctx context.Context, scope applicationasset.Scope, assetID string, lock bool) (domainasset.Asset, error) {
	id, err := persistenceid.Parse(assetID)
	if err != nil {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	var row assetRow
	query := assetScopeQuery(persistencetransaction.DB(ctx, r.db), scope).Where("id = ?", id)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domainasset.Asset{}, applicationasset.ErrNotFound
		}
		return domainasset.Asset{}, err
	}
	return domainFromRow(row), nil
}

func (r *Repository) BatchGet(ctx context.Context, scope applicationasset.Scope, assetIDs []string) ([]domainasset.Asset, error) {
	ids := persistenceid.ParseValid(assetIDs)
	if len(ids) == 0 {
		return []domainasset.Asset{}, nil
	}
	var rows []assetRow
	if err := assetScopeQuery(r.db.WithContext(ctx), scope).
		Where("id IN ?", ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	items := make([]domainasset.Asset, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row))
	}
	return items, nil
}

func (r *Repository) BatchGetReferenced(
	ctx context.Context,
	scope applicationasset.Scope,
	owner applicationasset.ReferenceOwner,
	assetIDs []string,
) ([]domainasset.Asset, error) {
	ids := persistenceid.ParseValid(assetIDs)
	if len(ids) == 0 || !owner.Type.Valid() || owner.Key == "" {
		return []domainasset.Asset{}, nil
	}
	var rows []assetRow
	if err := assetScopeQuery(r.dbFor(ctx), scope).
		Joins("JOIN asset_references ON asset_references.asset_id = assets.id AND asset_references.owner_type = ? AND asset_references.owner_key = ? AND asset_references.deleted_at = 0", owner.Type, owner.Key).
		Where("assets.id IN ?", ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	items := make([]domainasset.Asset, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row))
	}
	return items, nil
}

func (r *Repository) BatchGetReferencedAssets(
	ctx context.Context,
	scope applicationasset.Scope,
	references []applicationasset.AssetReference,
) ([]applicationasset.ReferencedAsset, error) {
	conditions := make([]string, 0, len(references))
	arguments := make([]any, 0, len(references)*3)
	for _, reference := range references {
		assetID, err := persistenceid.Parse(reference.AssetID)
		if err != nil || !reference.Owner.Type.Valid() || reference.Owner.Key == "" {
			continue
		}
		conditions = append(conditions, "(asset_references.owner_type = ? AND asset_references.owner_key = ? AND asset_references.asset_id = ?)")
		arguments = append(arguments, reference.Owner.Type, reference.Owner.Key, assetID)
	}
	if len(conditions) == 0 {
		return []applicationasset.ReferencedAsset{}, nil
	}
	var matchedReferences []assetReferenceRow
	query := r.dbFor(ctx).Model(&assetReferenceRow{}).
		Select("asset_references.*").
		Joins("JOIN assets ON assets.id = asset_references.asset_id AND assets.deleted_at = 0").
		Where("assets.tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		query = query.Where("assets.workspace_id IS NULL")
	} else {
		query = query.Where("assets.workspace_id = ?", *scope.WorkspaceID)
	}
	if err := query.
		Where(strings.Join(conditions, " OR "), arguments...).
		Find(&matchedReferences).Error; err != nil {
		return nil, err
	}
	ids := make([]persistenceid.UUID, 0, len(matchedReferences))
	for _, reference := range matchedReferences {
		ids = append(ids, reference.AssetID)
	}
	var rows []assetRow
	if err := assetScopeQuery(r.dbFor(ctx), scope).Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	assetsByID := make(map[persistenceid.UUID]domainasset.Asset, len(rows))
	for _, row := range rows {
		assetsByID[row.ID] = domainFromRow(row)
	}
	items := make([]applicationasset.ReferencedAsset, 0, len(matchedReferences))
	for _, reference := range matchedReferences {
		item, exists := assetsByID[reference.AssetID]
		if !exists {
			continue
		}
		items = append(items, applicationasset.ReferencedAsset{
			Reference: applicationasset.AssetReference{
				Owner:   applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerType(reference.OwnerType), Key: reference.OwnerKey},
				AssetID: reference.AssetID.String(),
			},
			Asset: item,
		})
	}
	return items, nil
}

func (r *Repository) ListByOwner(
	ctx context.Context,
	scope applicationasset.Scope,
	ownerType domainasset.OwnerType,
	ownerID string,
	limit int,
) ([]domainasset.Asset, error) {
	if limit < 1 {
		return []domainasset.Asset{}, nil
	}
	ownerUUID, err := persistenceid.Parse(ownerID)
	if err != nil {
		return nil, applicationasset.ErrNotFound
	}
	var rows []assetRow
	if err := assetScopeQuery(r.db.WithContext(ctx), scope).
		Where("owner_type = ? AND owner_id = ?", int16(ownerType), ownerUUID).
		Order("created_at DESC").
		Order("id DESC").
		Limit(limit).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	items := make([]domainasset.Asset, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row))
	}
	return items, nil
}

func (r *Repository) DeleteByOwner(
	ctx context.Context,
	scope applicationasset.Scope,
	ownerType domainasset.OwnerType,
	ownerID string,
	now time.Time,
) ([]applicationasset.RetiredAsset, error) {
	ownerUUID, err := persistenceid.Parse(ownerID)
	if err != nil {
		return nil, applicationasset.ErrNotFound
	}
	deleted := make([]applicationasset.RetiredAsset, 0)
	err = r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []assetRow
		if err := assetScopeQuery(tx, scope).Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("owner_type = ? AND owner_id = ?", int16(ownerType), ownerUUID).Find(&rows).Error; err != nil {
			return err
		}
		for index := range rows {
			changed, deleteErr := retireAsset(tx, rows[index], now)
			if deleteErr != nil {
				return deleteErr
			}
			if changed {
				deleted = append(deleted, retiredAssetFromRow(rows[index]))
			}
		}
		return nil
	})
	return deleted, err
}

func (r *Repository) DeleteByTenant(
	ctx context.Context,
	tenantID string,
	now time.Time,
) ([]applicationasset.RetiredAsset, error) {
	return r.deleteScope(ctx, func(tx *gorm.DB) *gorm.DB {
		return tx.Model(&assetRow{}).Where("tenant_id = ?", tenantID)
	}, now)
}

func (r *Repository) DeleteByWorkspace(
	ctx context.Context,
	tenantID string,
	workspaceID string,
	now time.Time,
) ([]applicationasset.RetiredAsset, error) {
	return r.deleteScope(ctx, func(tx *gorm.DB) *gorm.DB {
		return tx.Model(&assetRow{}).Where("tenant_id = ? AND workspace_id = ?", tenantID, workspaceID)
	}, now)
}

func (r *Repository) deleteScope(
	ctx context.Context,
	query func(*gorm.DB) *gorm.DB,
	now time.Time,
) ([]applicationasset.RetiredAsset, error) {
	deleted := make([]applicationasset.RetiredAsset, 0)
	err := r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []assetRow
		if err := query(tx).Clauses(clause.Locking{Strength: "UPDATE"}).Order("id ASC").Find(&rows).Error; err != nil {
			return err
		}
		for index := range rows {
			changed, err := retireAsset(tx, rows[index], now)
			if err != nil {
				return err
			}
			if changed {
				deleted = append(deleted, retiredAssetFromRow(rows[index]))
			}
		}
		return nil
	})
	return deleted, err
}

func retireAsset(db *gorm.DB, row assetRow, now time.Time) (bool, error) {
	update := db.Model(&assetRow{}).Where("id = ?", row.ID).
		Update("deleted_at", soft_delete.DeletedAt(now.UnixMilli()))
	if update.Error != nil {
		return false, update.Error
	}
	if update.RowsAffected != 1 {
		return false, nil
	}
	if err := db.Model(&assetReferenceRow{}).Where("asset_id = ? AND deleted_at = 0", row.ID).
		Updates(map[string]any{"deleted_at": now.UnixMilli(), "updated_at": now}).Error; err != nil {
		return false, err
	}
	return true, nil
}

func retiredAssetFromRow(row assetRow) applicationasset.RetiredAsset {
	return applicationasset.RetiredAsset{AssetID: row.ID.String(), TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID), SourceAssetID: row.SourceAssetID, SourceRevisionID: row.SourceRevisionID}
}

func assetScopeQuery(db *gorm.DB, scope applicationasset.Scope) *gorm.DB {
	query := db.Model(&assetRow{}).Where("tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return query.Where("workspace_id IS NULL")
	}
	return query.Where("workspace_id = ?", *scope.WorkspaceID)
}

func rowFromDomain(item domainasset.Asset) (assetRow, error) {
	id, err := persistenceid.Parse(item.ID)
	if err != nil {
		return assetRow{}, fmt.Errorf("map Asset ID: %w", err)
	}
	ownerID, err := persistenceid.Parse(item.OwnerID)
	if err != nil {
		return assetRow{}, fmt.Errorf("map Asset owner ID: %w", err)
	}
	return assetRow{
		ID: id, TenantID: item.TenantID, WorkspaceID: cloneString(item.WorkspaceID),
		OwnerType: int16(item.OwnerType), OwnerID: ownerID, CreationKey: nullableString(item.CreationKey),
		SourceAssetID: item.SourceAssetID, SourceRevisionID: item.SourceRevisionID,
		FileName: item.FileName, MediaType: int16(item.MediaType), ContentType: item.ContentType,
		SizeBytes: item.SizeBytes, BillingClass: string(item.BillingClass),
		CreatedBy: item.CreatedBy, CreatedAt: item.CreatedAt,
	}, nil
}

func domainFromRow(row assetRow) domainasset.Asset {
	return domainasset.Asset{
		ID: row.ID.String(), TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID),
		OwnerType: domainasset.OwnerType(row.OwnerType), OwnerID: row.OwnerID.String(),
		CreationKey: stringValue(row.CreationKey), SourceAssetID: row.SourceAssetID, SourceRevisionID: row.SourceRevisionID,
		FileName: row.FileName, MediaType: domainasset.MediaType(row.MediaType), ContentType: row.ContentType,
		SizeBytes: row.SizeBytes, BillingClass: domainasset.BillingClass(row.BillingClass),
		CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt,
	}
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

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
