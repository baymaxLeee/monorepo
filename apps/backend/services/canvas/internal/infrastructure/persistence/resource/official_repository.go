package resource

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	applicationresource "github.com/example/monorepo/canvas/internal/application/resource"
	domainresource "github.com/example/monorepo/canvas/internal/domain/resource"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	scopelifecycle "github.com/example/monorepo/canvas/internal/infrastructure/persistence/scopelifecycle"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
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
	primary := slotID.String()
	row.PrimaryResourceAssetID = &primary
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if err := scopelifecycle.LockActive(ctx, r.db, item.TenantID, item.WorkspaceID); err != nil {
			return err
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
			return translateWriteError(err)
		}
		if err := r.db.Queries(ctx).InsertAssetSlot(ctx, sqlc.InsertAssetSlotParams{
			ID:                     slotID.String(),
			ResourceID:             row.ID,
			Name:                   slot.Name,
			SequenceNo:             slot.SequenceNo,
			SourceType:             int16(slot.SourceType),
			CurrentAssetID:         persistenceid.OptionalText(currentAssetID),
			ImageGenerationDraftID: nil,
			MediaType:              int16(slot.MediaType),
			Revision:               slot.Revision,
			CreatedAt:              slot.CreatedAt,
			UpdatedAt:              slot.UpdatedAt,
		}); err != nil {
			return translateResourceAssetWriteError(err)
		}
		if currentAssetID == nil {
			return nil
		}
		return translateResourceAssetWriteError(r.db.Queries(ctx).InsertSlotRevision(ctx, sqlc.InsertSlotRevisionParams{
			ResourceAssetID: slotID.String(),
			AssetID:         currentAssetID.String(),
			MediaType:       int16(slot.MediaType),
			RevisionNo:      1,
			CreatedAt:       slot.CreatedAt,
		}))
	})
}

func (r *Repository) GetOfficial(
	ctx context.Context, scope applicationresource.Scope, resourceID string,
) (domainresource.Resource, error) {
	id, err := persistenceid.Parse(resourceID)
	if err != nil {
		return domainresource.Resource{}, applicationresource.ErrNotFound
	}
	row, err := r.db.Queries(ctx).ReadOfficialResource(ctx, sqlc.ReadOfficialResourceParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ID:          id.String(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainresource.Resource{}, applicationresource.ErrNotFound
	}
	if err != nil {
		return domainresource.Resource{}, err
	}
	return domainFromRow(row), nil
}

func (r *Repository) UpdateOfficial(
	ctx context.Context, scope applicationresource.Scope, item domainresource.Resource,
) error {
	id, err := persistenceid.Parse(item.ID)
	if err != nil {
		return applicationresource.ErrNotFound
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		n, err := r.db.Queries(ctx).ModifyOfficialResource(ctx, sqlc.ModifyOfficialResourceParams{
			Name:             item.Name,
			Description:      item.Description,
			Revision:         item.Revision,
			UpdatedAt:        item.UpdatedAt,
			TenantID:         scope.TenantID,
			WorkspaceID:      scope.WorkspaceID,
			ID:               id.String(),
			ExpectedRevision: item.Revision - 1,
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
