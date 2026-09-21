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

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/mysqlcompat"
	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	scopelifecycle "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/scopelifecycle"
	persistencetransaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
)

type Repository struct {
	db                     *gorm.DB
	mysqlCompatibleVersion int
}

func NewRepository(db *gorm.DB, mysqlCompatibleVersion ...int) *Repository {
	version := 5
	if len(mysqlCompatibleVersion) > 0 {
		version = mysqlCompatibleVersion[0]
	}
	return &Repository{db: db, mysqlCompatibleVersion: version}
}

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
		// The early resolver prevents wasted Up calls. Rechecking the owner under
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
	purgeNotBefore time.Time,
) ([]applicationasset.GarbageCollectionAsset, error) {
	ownerUUID, err := persistenceid.Parse(ownerID)
	if err != nil {
		return nil, applicationasset.ErrNotFound
	}
	deleted := make([]applicationasset.GarbageCollectionAsset, 0)
	err = r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []assetRow
		if err := assetScopeQuery(tx, scope).Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("owner_type = ? AND owner_id = ?", int16(ownerType), ownerUUID).Find(&rows).Error; err != nil {
			return err
		}
		for index := range rows {
			changed, deleteErr := softDeleteAsset(tx, rows[index], now, purgeNotBefore)
			if deleteErr != nil {
				return deleteErr
			}
			if changed {
				deleted = append(deleted, garbageCollectionAssetFromRow(rows[index]))
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
	purgeNotBefore time.Time,
) ([]applicationasset.GarbageCollectionAsset, error) {
	return r.deleteScope(ctx, func(tx *gorm.DB) *gorm.DB {
		return tx.Model(&assetRow{}).Where("tenant_id = ?", tenantID)
	}, now, purgeNotBefore)
}

func (r *Repository) DeleteByWorkspace(
	ctx context.Context,
	tenantID string,
	workspaceID string,
	now time.Time,
	purgeNotBefore time.Time,
) ([]applicationasset.GarbageCollectionAsset, error) {
	return r.deleteScope(ctx, func(tx *gorm.DB) *gorm.DB {
		return tx.Model(&assetRow{}).Where("tenant_id = ? AND workspace_id = ?", tenantID, workspaceID)
	}, now, purgeNotBefore)
}

func (r *Repository) deleteScope(
	ctx context.Context,
	query func(*gorm.DB) *gorm.DB,
	now time.Time,
	purgeNotBefore time.Time,
) ([]applicationasset.GarbageCollectionAsset, error) {
	deleted := make([]applicationasset.GarbageCollectionAsset, 0)
	err := r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []assetRow
		if err := query(tx).Clauses(clause.Locking{Strength: "UPDATE"}).Order("id ASC").Find(&rows).Error; err != nil {
			return err
		}
		for index := range rows {
			changed, err := softDeleteAsset(tx, rows[index], now, purgeNotBefore)
			if err != nil {
				return err
			}
			if changed {
				deleted = append(deleted, garbageCollectionAssetFromRow(rows[index]))
			}
		}
		return nil
	})
	return deleted, err
}

func (r *Repository) FindZeroReferenceAssets(ctx context.Context, createdBefore time.Time, afterAssetID string, limit int) ([]applicationasset.GarbageCollectionAsset, error) {
	if limit <= 0 {
		return []applicationasset.GarbageCollectionAsset{}, nil
	}
	query := r.dbFor(ctx).Model(&assetRow{}).Where("reference_count = 0 AND created_at <= ?", createdBefore)
	if afterAssetID != "" {
		after, err := persistenceid.Parse(afterAssetID)
		if err != nil {
			return nil, err
		}
		var cursor assetRow
		if err = r.dbFor(ctx).Unscoped().Select("id", "created_at").First(&cursor, "id = ?", after).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			// A completed GC cycle physically removes the previous cursor. Restarting
			// is safe because candidate creation is idempotent and avoids stalling
			// every later scan behind a cursor that can no longer be resolved.
		} else if err != nil {
			return nil, err
		} else {
			query = query.Where("(created_at > ? OR (created_at = ? AND id > ?))", cursor.CreatedAt, cursor.CreatedAt, after)
		}
	}
	var rows []assetRow
	if err := query.Order("created_at ASC").Order("id ASC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	items := make([]applicationasset.GarbageCollectionAsset, 0, len(rows))
	for index := range rows {
		items = append(items, garbageCollectionAssetFromRow(rows[index]))
	}
	return items, nil
}

func (r *Repository) SoftDeleteForGarbageCollection(
	ctx context.Context,
	item applicationasset.GarbageCollectionAsset,
	now time.Time,
	purgeNotBefore time.Time,
) (bool, error) {
	id, err := persistenceid.Parse(item.AssetID)
	if err != nil {
		return false, err
	}
	changed := false
	err = r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var row assetRow
		// Recheck the best-effort count while locking the active Asset row. A
		// concurrent count writer must then observe deleted_at after commit and
		// cannot revive an Asset that already entered GC.
		query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"id = ? AND tenant_id = ? AND artifact_id = ? AND reference_count = 0", id, item.TenantID, item.ArtifactID,
		)
		query = applyGarbageCollectionWorkspace(query, item.WorkspaceID)
		if findErr := query.First(&row).Error; errors.Is(findErr, gorm.ErrRecordNotFound) {
			return nil
		} else if findErr != nil {
			return findErr
		}
		// The cached count is only a scan hint. Recheck retaining owners while
		// holding the same Asset lock used by acquire/release, including Undo.
		var references []assetReferenceRow
		if readErr := tx.Clauses(clause.Locking{Strength: "SHARE"}).Where("asset_id = ?", row.ID).Limit(1).Find(&references).Error; readErr != nil {
			return readErr
		}
		if len(references) != 0 {
			return nil
		}
		changed, err = softDeleteAsset(tx, row, now, purgeNotBefore)
		return err
	})
	return changed, err
}

func softDeleteAsset(db *gorm.DB, row assetRow, now, purgeNotBefore time.Time) (bool, error) {
	update := db.Model(&assetRow{}).Where("id = ?", row.ID).
		Update("deleted_at", soft_delete.DeletedAt(now.UnixMilli()))
	if update.Error != nil {
		return false, update.Error
	}
	if update.RowsAffected != 1 {
		return false, nil
	}
	candidate := assetGarbageCollectionCandidateRow{
		AssetID: row.ID, TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID), ArtifactID: row.ArtifactID,
		ArtifactNamespace: cloneString(row.ArtifactNamespace),
		DeletedAt:         now, PurgeNotBefore: purgeNotBefore, NextAttemptAt: purgeNotBefore, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&candidate).Error; err != nil {
		return false, err
	}
	return true, nil
}

func (r *Repository) ClaimGarbageCollection(ctx context.Context, now, leaseUntil time.Time, limit int) ([]applicationasset.GarbageCollectionCandidate, error) {
	if limit <= 0 {
		return []applicationasset.GarbageCollectionCandidate{}, nil
	}
	claimed := make([]applicationasset.GarbageCollectionCandidate, 0, limit)
	err := r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		// A candidate is claimable only when no stable predecessor for the same
		// Artifact exists. This deliberately lets a failed earliest candidate block
		// later ones so different Server pods cannot concurrently delete a shared Artifact.
		predecessor := tx.Table("asset_gc_candidates AS predecessor").Select("1").Where(
			"predecessor.artifact_id = candidate.artifact_id AND (predecessor.created_at < candidate.created_at OR (predecessor.created_at = candidate.created_at AND predecessor.asset_id < candidate.asset_id))",
		)
		var rows []assetGarbageCollectionCandidateRow
		if err := tx.Table("asset_gc_candidates AS candidate").
			Where("candidate.purge_not_before <= ? AND candidate.next_attempt_at <= ? AND (candidate.lease_until IS NULL OR candidate.lease_until <= ?)", now, now, now).
			Where("NOT EXISTS (?)", predecessor).
			Order("candidate.next_attempt_at ASC").Limit(limit).
			Clauses(mysqlcompat.ForUpdate(r.mysqlCompatibleVersion)).Find(&rows).Error; err != nil {
			return err
		}
		for index := range rows {
			row := rows[index]
			update := tx.Model(&assetGarbageCollectionCandidateRow{}).Where(
				"asset_id = ? AND state_version = ? AND purge_not_before <= ? AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)",
				row.AssetID, row.StateVersion, now, now, now,
			).Updates(map[string]any{"lease_until": leaseUntil, "state_version": row.StateVersion + 1, "updated_at": now})
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected != 1 {
				continue
			}
			row.LeaseUntil = &leaseUntil
			row.StateVersion++
			row.UpdatedAt = now
			claimed = append(claimed, garbageCollectionCandidateFromRow(row))
		}
		return nil
	})
	return claimed, err
}

func (r *Repository) ArtifactHasOtherAssets(ctx context.Context, item applicationasset.GarbageCollectionCandidate) (bool, error) {
	id, err := persistenceid.Parse(item.AssetID)
	if err != nil {
		return false, err
	}
	var count int64
	// Soft-deleted rows still own Artifact metadata until their candidate completes.
	err = r.dbFor(ctx).Unscoped().Model(&assetRow{}).Where("artifact_id = ? AND id <> ?", item.ArtifactID, id).Count(&count).Error
	return count > 0, err
}

var errGarbageCollectionCAS = errors.New("asset garbage collection state changed")

func (r *Repository) CompleteGarbageCollection(ctx context.Context, item applicationasset.GarbageCollectionCandidate) (bool, error) {
	id, err := persistenceid.Parse(item.AssetID)
	if err != nil {
		return false, err
	}
	err = r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		candidateDelete := tx.Where("asset_id = ? AND state_version = ?", id, item.StateVersion).Delete(&assetGarbageCollectionCandidateRow{})
		if candidateDelete.Error != nil {
			return candidateDelete.Error
		}
		if candidateDelete.RowsAffected != 1 {
			return errGarbageCollectionCAS
		}
		referenceDelete := tx.Unscoped().Where("asset_id = ?", id).Delete(&assetReferenceRow{})
		if referenceDelete.Error != nil {
			return referenceDelete.Error
		}
		assetDelete := tx.Unscoped().Where("id = ? AND deleted_at <> 0", id).Delete(&assetRow{})
		if assetDelete.Error != nil {
			return assetDelete.Error
		}
		if assetDelete.RowsAffected != 1 {
			return errGarbageCollectionCAS
		}
		return nil
	})
	if errors.Is(err, errGarbageCollectionCAS) {
		return false, nil
	}
	return err == nil, err
}

func (r *Repository) RescheduleGarbageCollection(
	ctx context.Context,
	item applicationasset.GarbageCollectionCandidate,
	next time.Time,
	message string,
	now time.Time,
) (bool, error) {
	id, err := persistenceid.Parse(item.AssetID)
	if err != nil {
		return false, err
	}
	if len(message) > 512 {
		message = message[:512]
	}
	update := r.dbFor(ctx).Model(&assetGarbageCollectionCandidateRow{}).Where("asset_id = ? AND state_version = ?", id, item.StateVersion).
		Updates(map[string]any{"next_attempt_at": next, "lease_until": nil, "state_version": item.StateVersion + 1, "attempts": item.Attempts + 1, "last_error": message, "updated_at": now})
	if update.Error != nil {
		return false, update.Error
	}
	return update.RowsAffected == 1, nil
}

func garbageCollectionAssetFromRow(row assetRow) applicationasset.GarbageCollectionAsset {
	return applicationasset.GarbageCollectionAsset{AssetID: row.ID.String(), TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID), ArtifactID: row.ArtifactID, ArtifactNamespace: stringValue(row.ArtifactNamespace)}
}

func garbageCollectionCandidateFromRow(row assetGarbageCollectionCandidateRow) applicationasset.GarbageCollectionCandidate {
	return applicationasset.GarbageCollectionCandidate{
		GarbageCollectionAsset: applicationasset.GarbageCollectionAsset{AssetID: row.AssetID.String(), TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID), ArtifactID: row.ArtifactID, ArtifactNamespace: stringValue(row.ArtifactNamespace)},
		DeletedAt:              row.DeletedAt, PurgeNotBefore: row.PurgeNotBefore, NextAttemptAt: row.NextAttemptAt,
		LeaseUntil: row.LeaseUntil, StateVersion: row.StateVersion, Attempts: row.Attempts, LastError: row.LastError, CreatedAt: row.CreatedAt,
	}
}

func applyGarbageCollectionWorkspace(query *gorm.DB, workspaceID *string) *gorm.DB {
	if workspaceID == nil {
		return query.Where("workspace_id IS NULL")
	}
	return query.Where("workspace_id = ?", *workspaceID)
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
		ArtifactID: item.ArtifactID, ArtifactNamespace: nullableString(item.ArtifactNamespace),
		FileName: item.FileName, MediaType: int16(item.MediaType), ContentType: item.ContentType,
		SizeBytes: item.SizeBytes, BillingClass: string(item.BillingClass),
		CreatedBy: item.CreatedBy, CreatedAt: item.CreatedAt,
	}, nil
}

func domainFromRow(row assetRow) domainasset.Asset {
	return domainasset.Asset{
		ID: row.ID.String(), TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID),
		OwnerType: domainasset.OwnerType(row.OwnerType), OwnerID: row.OwnerID.String(),
		CreationKey: stringValue(row.CreationKey), ArtifactID: row.ArtifactID, ArtifactNamespace: stringValue(row.ArtifactNamespace),
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
