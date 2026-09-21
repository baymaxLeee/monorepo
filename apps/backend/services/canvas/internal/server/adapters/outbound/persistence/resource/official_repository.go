package resource

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	scopelifecycle "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/scopelifecycle"
	persistencetransaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	applicationresource "github.com/example/monorepo/canvas/internal/server/application/resource"
	domainresource "github.com/example/monorepo/canvas/internal/server/domain/resource"
)

// CreateOfficial 写入一条 OFFICIAL Resource 及其唯一 ResourceAsset。
//
// 不复用 Create：后者锁 Project 行、校验项目类型配额并建立 project_resource_rel，而
// OFFICIAL Resource 不属于任何 Project（ADR-002），因此既没有可锁的 Project 也不该有
// 引用边。ResourceAsset 与 Resource 在同一事务内写入，使物化不会留下没有绑定项的
// 半成品官方条目。
//
// 只由受信对账调用。并发物化由 (owner_type, owner_id, name, deleted_at) 唯一索引兜底：
// 竞争的失败方收到 ErrNameConflict，重新读取即可看到胜出方物化的记录。
func (r *Repository) CreateOfficial(
	ctx context.Context, item domainresource.Resource, slot domainresource.ResourceAsset,
) error {
	if item.OwnerType != domainresource.OwnerOfficial {
		return domainresource.ErrInvalidResource
	}
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	slotID, err := persistenceid.Parse(slot.ID)
	if err != nil {
		return fmt.Errorf("map official ResourceAsset ID: %w", err)
	}
	if slot.ResourceID != item.ID {
		return domainresource.ErrInvalidResourceAsset
	}
	currentAssetID, err := persistenceid.ParseOptional(slot.CurrentAssetID)
	if err != nil {
		return fmt.Errorf("map official ResourceAsset current Asset ID: %w", err)
	}
	// 官方插槽始终是 UPLOAD 来源：内容走与用户上传相同的 upload server -> artifact ->
	// asset 链路，不存在图片生成草稿。
	if slot.SourceType != domainresource.SourceUpload || slot.ImageGenerationDraftID != "" {
		return domainresource.ErrInvalidResourceAsset
	}
	row.ResourceAssetCount = 1
	primaryID := slotID
	row.PrimaryResourceAssetID = &primaryID
	return persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		if err := scopelifecycle.LockActive(tx, item.TenantID, item.WorkspaceID); err != nil {
			return err
		}
		if err := tx.Create(&row).Error; err != nil {
			return translateWriteError(err)
		}
		slotRow := resourceAssetRow{
			ID: slotID, ResourceID: row.ID, Name: slot.Name, SequenceNo: slot.SequenceNo,
			SourceType: int16(slot.SourceType), CurrentAssetID: currentAssetID,
			MediaType: int16(slot.MediaType), Revision: slot.Revision,
			CreatedAt: slot.CreatedAt, UpdatedAt: slot.UpdatedAt,
		}
		if err := tx.Create(&slotRow).Error; err != nil {
			return translateResourceAssetWriteError(err)
		}
		if currentAssetID == nil {
			return nil
		}
		return translateResourceAssetWriteError(tx.Create(&resourceAssetRevisionRow{
			ResourceAssetID: slotID, AssetID: *currentAssetID, MediaType: int16(slot.MediaType),
			RevisionNo: 1, CreatedAt: slot.CreatedAt,
		}).Error)
	})
}

// GetOfficial 按 ID 读取一条 OFFICIAL Resource，不经过 Project 归属条件。
//
// 对账按 external asset ID 反查到 resource_id 后用它读取当前状态，因此这里不需要
// Project 上下文；owner_type 条件确保对账永远不会误读或误改 PROJECT Resource。
func (r *Repository) GetOfficial(
	ctx context.Context, scope applicationresource.Scope, resourceID string,
) (domainresource.Resource, error) {
	id, err := persistenceid.Parse(resourceID)
	if err != nil {
		return domainresource.Resource{}, applicationresource.ErrNotFound
	}
	var row resourceRow
	err = persistencetransaction.DB(ctx, r.db).Model(&resourceRow{}).
		Where("resources.id = ? AND resources.tenant_id = ? AND resources.owner_type = ?",
			id, scope.TenantID, domainresource.OwnerOfficial).
		Scopes(workspaceScope(scope.WorkspaceID)).First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domainresource.Resource{}, applicationresource.ErrNotFound
		}
		return domainresource.Resource{}, err
	}
	return domainFromRow(row), nil
}

// UpdateOfficial 就地更新 OFFICIAL Resource 的名称与简介。
//
// 只更新元信息：内容变化走 ResourceAsset 换版，不在这里改写。owner_type 条件使该方法
// 不可能作用到 PROJECT Resource。tenant 和 workspace 条件与 GetOfficial
// 保持一致，防止调用方传入其他作用域的 Resource 时越权更新。
func (r *Repository) UpdateOfficial(
	ctx context.Context, scope applicationresource.Scope, item domainresource.Resource,
) error {
	id, err := persistenceid.Parse(item.ID)
	if err != nil {
		return applicationresource.ErrNotFound
	}
	result := persistencetransaction.DB(ctx, r.db).Model(&resourceRow{}).
		Where("id = ? AND tenant_id = ? AND owner_type = ? AND revision = ?",
			id, scope.TenantID, domainresource.OwnerOfficial, item.Revision-1).
		Scopes(workspaceScope(scope.WorkspaceID)).
		Updates(map[string]any{
			"name": item.Name, "description": item.Description,
			"revision": item.Revision, "updated_at": item.UpdatedAt,
		})
	if result.Error != nil {
		return translateWriteError(result.Error)
	}
	if result.RowsAffected == 0 {
		return applicationresource.ErrRevisionConflict
	}
	return nil
}
