package officialasset

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	applicationofficialasset "github.com/example/monorepo/canvas/internal/server/application/officialasset"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domainofficialasset "github.com/example/monorepo/canvas/internal/server/domain/officialasset"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// Create 登记一条官方清单条目。scope 唯一索引使重跑同一份清单命中冲突并返回
// ErrAlreadyExists，无需额外的 creation key。
func (r *Repository) Create(ctx context.Context, item domainofficialasset.OfficialAsset) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	err = persistencetransaction.DB(ctx, r.db).Create(&row).Error
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return applicationofficialasset.ErrAlreadyExists
	}
	return err
}

func (r *Repository) Get(
	ctx context.Context, scope domainofficialasset.Scope, slug string,
) (domainofficialasset.OfficialAsset, error) {
	var row officialAssetRow
	err := scopedQuery(persistencetransaction.DB(ctx, r.db), scope).
		Where("slug = ?", slug).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domainofficialasset.OfficialAsset{}, applicationofficialasset.ErrNotFound
	}
	if err != nil {
		return domainofficialasset.OfficialAsset{}, err
	}
	return domainFromRow(row), nil
}

// GetByInternalAssetID 是 scope 内 1:1 映射的反查方向，走 internal_asset_id 唯一索引。
func (r *Repository) GetByInternalAssetID(
	ctx context.Context, scope domainofficialasset.Scope, internalAssetID string,
) (domainofficialasset.OfficialAsset, error) {
	parsed, err := persistenceid.Parse(internalAssetID)
	if err != nil {
		return domainofficialasset.OfficialAsset{}, applicationofficialasset.ErrNotFound
	}
	var row officialAssetRow
	err = scopedQuery(persistencetransaction.DB(ctx, r.db), scope).
		Where("internal_asset_id = ?", parsed).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domainofficialasset.OfficialAsset{}, applicationofficialasset.ErrNotFound
	}
	if err != nil {
		return domainofficialasset.OfficialAsset{}, err
	}
	return domainFromRow(row), nil
}

// Save 覆盖注册状态、内容摘要与物化结果。绑定内部 Asset 时唯一索引冲突意味着该
// Asset 在本 scope 下已被另一条清单条目占用。
func (r *Repository) Save(ctx context.Context, item domainofficialasset.OfficialAsset) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	result := scopedQuery(persistencetransaction.DB(ctx, r.db), item.Scope).
		Where("slug = ?", row.Slug).
		Updates(map[string]any{
			"internal_asset_id": row.InternalAssetID,
			"resource_id":       row.ResourceID,
			"resource_asset_id": row.ResourceAssetID,
			"long_live_status":  row.LongLiveStatus,
			"artifact_id":       row.ArtifactID,
			"file_sha256":       row.FileSHA256,
			"file_name":         row.FileName,
			"media_type":        row.MediaType,
			"size_bytes":        row.SizeBytes,
			"updated_at":        row.UpdatedAt,
		})
	if errors.Is(result.Error, gorm.ErrDuplicatedKey) {
		return applicationofficialasset.ErrInternalAssetConflict
	}
	if result.Error != nil {
		return result.Error
	}
	// MySQL 对内容完全相同的更新报告零行受影响，因此这里用存在性查询区分
	// 「重复写入同一状态」与「该 scope 下不存在该 slug」。
	if result.RowsAffected == 0 {
		if _, err := r.Get(ctx, item.Scope, item.Slug); err != nil {
			return err
		}
	}
	return nil
}

// ListByScope 返回该 scope 下全部未删除条目，按 external asset ID 稳定排序。
func (r *Repository) ListByScope(
	ctx context.Context, scope domainofficialasset.Scope,
) ([]domainofficialasset.OfficialAsset, error) {
	if !scope.Valid() {
		return nil, nil
	}
	var rows []officialAssetRow
	if err := scopedQuery(persistencetransaction.DB(ctx, r.db), scope).
		Order("slug ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return domainsFromRows(rows), nil
}

// ListByLongLiveStatus 供运维任务按状态挑选待上传或需重试的官方素材。
func (r *Repository) ListByLongLiveStatus(
	ctx context.Context, scope domainofficialasset.Scope,
	status domainofficialasset.LongLiveStatus, limit int32,
) ([]domainofficialasset.OfficialAsset, error) {
	if !scope.Valid() || !status.Valid() || limit <= 0 {
		return nil, nil
	}
	var rows []officialAssetRow
	if err := scopedQuery(persistencetransaction.DB(ctx, r.db), scope).
		Where("long_live_status = ?", int16(status)).
		Order("slug ASC").Limit(int(limit)).Find(&rows).Error; err != nil {
		return nil, err
	}
	return domainsFromRows(rows), nil
}

// SoftDelete 下线一条官方清单条目。deletedAtMilli 参与 scope 唯一索引，因此同一条目
// 之后可以在同一 scope 重新上架。
func (r *Repository) SoftDelete(
	ctx context.Context, scope domainofficialasset.Scope, slug string, deletedAtMilli int64,
) error {
	if deletedAtMilli <= 0 {
		return domainofficialasset.ErrInvalidOfficialAsset
	}
	result := scopedQuery(persistencetransaction.DB(ctx, r.db), scope).
		Where("slug = ?", slug).
		Updates(map[string]any{
			"deleted_at": deletedAtMilli,
			"updated_at": time.UnixMilli(deletedAtMilli).UTC(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return applicationofficialasset.ErrNotFound
	}
	return nil
}

// scopedQuery 把查询限制在单个 scope 内。workspace 用 workspace_key 归一化列比较，
// 与唯一索引保持同一套语义，避免 NULL 比较的三值逻辑。
func scopedQuery(db *gorm.DB, scope domainofficialasset.Scope) *gorm.DB {
	return db.Model(&officialAssetRow{}).
		Where("tenant_id = ? AND workspace_key = ?", scope.TenantID, workspaceKey(scope.WorkspaceID))
}

// workspaceKey 把可空 workspace 归一化为 NOT NULL 索引键：MySQL 唯一索引不对 NULL
// 去重，若直接用可空列参与索引，所有「无 workspace」的行会互不冲突。
func workspaceKey(workspaceID *string) string {
	if workspaceID == nil {
		return ""
	}
	return *workspaceID
}

func rowFromDomain(item domainofficialasset.OfficialAsset) (officialAssetRow, error) {
	internalAssetID, err := persistenceid.ParseOptional(item.InternalAssetID)
	if err != nil {
		return officialAssetRow{}, fmt.Errorf("map official asset internal Asset ID: %w", err)
	}
	resourceID, err := persistenceid.ParseOptional(item.ResourceID)
	if err != nil {
		return officialAssetRow{}, fmt.Errorf("map official asset Resource ID: %w", err)
	}
	resourceAssetID, err := persistenceid.ParseOptional(item.ResourceAssetID)
	if err != nil {
		return officialAssetRow{}, fmt.Errorf("map official asset ResourceAsset ID: %w", err)
	}
	return officialAssetRow{
		Slug:            item.Slug,
		TenantID:        item.Scope.TenantID,
		WorkspaceID:     cloneString(item.Scope.WorkspaceID),
		WorkspaceKey:    workspaceKey(item.Scope.WorkspaceID),
		InternalAssetID: internalAssetID,
		ResourceID:      resourceID,
		ResourceAssetID: resourceAssetID,
		LongLiveStatus:  int16(item.LongLiveStatus),
		ArtifactID:      nullableString(item.ArtifactID),
		FileSHA256:      nullableString(item.FileSHA256),
		FileName:        item.FileName,
		MediaType:       int16(item.MediaType),
		SizeBytes:       item.SizeBytes,
		CreatedAt:       item.CreatedAt,
		UpdatedAt:       item.UpdatedAt,
	}, nil
}

func domainFromRow(row officialAssetRow) domainofficialasset.OfficialAsset {
	return domainofficialasset.OfficialAsset{
		Slug: row.Slug,
		Scope: domainofficialasset.Scope{
			TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID),
		},
		ArtifactID:      stringValue(row.ArtifactID),
		InternalAssetID: uuidString(row.InternalAssetID),
		ResourceID:      uuidString(row.ResourceID),
		ResourceAssetID: uuidString(row.ResourceAssetID),
		LongLiveStatus:  domainofficialasset.LongLiveStatus(row.LongLiveStatus),
		FileSHA256:      stringValue(row.FileSHA256),
		FileName:        row.FileName,
		MediaType:       domainasset.MediaType(row.MediaType),
		SizeBytes:       row.SizeBytes,
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
}

func domainsFromRows(rows []officialAssetRow) []domainofficialasset.OfficialAsset {
	items := make([]domainofficialasset.OfficialAsset, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row))
	}
	return items
}

func uuidString(value *persistenceid.UUID) string {
	if value == nil {
		return ""
	}
	return value.String()
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

// ListScopes 枚举已有官方记录的全部 scope。
//
// 用 Unscoped 并包含软删除行：清单清空后该 scope 下的记录已全部下线，但启动对账仍需访问
// 它才能确认已收敛；只看未删除行会让下线过的 scope 永远不再被对账。
func (r *Repository) ListScopes(ctx context.Context) ([]domainofficialasset.Scope, error) {
	var rows []officialAssetRow
	err := persistencetransaction.DB(ctx, r.db).Unscoped().
		Model(&officialAssetRow{}).
		Select("DISTINCT tenant_id, workspace_id, workspace_key").
		Order("tenant_id ASC, workspace_key ASC").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	scopes := make([]domainofficialasset.Scope, 0, len(rows))
	for _, row := range rows {
		scopes = append(scopes, domainofficialasset.Scope{
			TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID),
		})
	}
	return scopes, nil
}
