package officialasset

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	persistencetransaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	applicationofficialasset "github.com/example/monorepo/canvas/internal/server/application/officialasset"
	domainofficialasset "github.com/example/monorepo/canvas/internal/server/domain/officialasset"
)

func (r *Repository) GetSharedBlob(
	ctx context.Context, slug, fileSHA256 string,
) (domainofficialasset.SharedBlob, error) {
	var row officialAssetBlobRow
	err := persistencetransaction.DB(ctx, r.db).
		Where("slug = ? AND file_sha256 = ?", slug, fileSHA256).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domainofficialasset.SharedBlob{}, applicationofficialasset.ErrSharedBlobNotFound
	}
	if err != nil {
		return domainofficialasset.SharedBlob{}, err
	}
	return sharedBlobFromRow(row), nil
}

func (r *Repository) CreateSharedBlob(ctx context.Context, item domainofficialasset.SharedBlob) error {
	row := sharedBlobRowFromDomain(item)
	err := persistencetransaction.DB(ctx, r.db).Create(&row).Error
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return applicationofficialasset.ErrSharedBlobAlreadyExists
	}
	return err
}

func (r *Repository) ClaimSharedBlob(
	ctx context.Context,
	slug, fileSHA256, owner string,
	now, expires time.Time,
) (bool, error) {
	result := persistencetransaction.DB(ctx, r.db).Model(&officialAssetBlobRow{}).
		Where("slug = ? AND file_sha256 = ?", slug, fileSHA256).
		Where(
			"status IN ? OR (status = ? AND lease_expires_at <= ?)",
			[]int16{int16(domainofficialasset.SharedBlobPending), int16(domainofficialasset.SharedBlobFailed)},
			int16(domainofficialasset.SharedBlobUploading), now.UTC(),
		).
		Updates(map[string]any{
			"status":           int16(domainofficialasset.SharedBlobUploading),
			"blob_id":          nil,
			"size_bytes":       0,
			"lease_owner":      owner,
			"lease_expires_at": expires.UTC(),
			"updated_at":       now.UTC(),
		})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *Repository) CompleteSharedBlob(
	ctx context.Context,
	slug, fileSHA256, owner, blobID string,
	sizeBytes int64,
	now time.Time,
) error {
	result := persistencetransaction.DB(ctx, r.db).Model(&officialAssetBlobRow{}).
		Where("slug = ? AND file_sha256 = ? AND status = ? AND lease_owner = ?",
			slug, fileSHA256, int16(domainofficialasset.SharedBlobUploading), owner).
		Updates(map[string]any{
			"status":           int16(domainofficialasset.SharedBlobAvailable),
			"blob_id":          blobID,
			"size_bytes":       sizeBytes,
			"lease_owner":      nil,
			"lease_expires_at": nil,
			"updated_at":       now.UTC(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return applicationofficialasset.ErrSharedBlobLeaseConflict
	}
	return nil
}

func (r *Repository) FailSharedBlob(
	ctx context.Context, slug, fileSHA256, owner string, now time.Time,
) error {
	result := persistencetransaction.DB(ctx, r.db).Model(&officialAssetBlobRow{}).
		Where("slug = ? AND file_sha256 = ? AND status = ? AND lease_owner = ?",
			slug, fileSHA256, int16(domainofficialasset.SharedBlobUploading), owner).
		Updates(map[string]any{
			"status":           int16(domainofficialasset.SharedBlobFailed),
			"blob_id":          nil,
			"size_bytes":       0,
			"lease_owner":      nil,
			"lease_expires_at": nil,
			"updated_at":       now.UTC(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return applicationofficialasset.ErrSharedBlobLeaseConflict
	}
	return nil
}

func (r *Repository) InvalidateSharedBlob(
	ctx context.Context, slug, fileSHA256, blobID string, now time.Time,
) (bool, error) {
	result := persistencetransaction.DB(ctx, r.db).Model(&officialAssetBlobRow{}).
		Where("slug = ? AND file_sha256 = ? AND status = ? AND blob_id = ?",
			slug, fileSHA256, int16(domainofficialasset.SharedBlobAvailable), blobID).
		Updates(map[string]any{
			"status":     int16(domainofficialasset.SharedBlobFailed),
			"blob_id":    nil,
			"size_bytes": 0,
			"updated_at": now.UTC(),
		})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func sharedBlobRowFromDomain(item domainofficialasset.SharedBlob) officialAssetBlobRow {
	return officialAssetBlobRow{
		Slug: item.Slug, FileSHA256: item.FileSHA256, BlobID: nullableString(item.BlobID),
		Status: int16(item.Status), LeaseOwner: nullableString(item.LeaseOwner),
		LeaseExpiresAt: cloneTime(item.LeaseExpiresAt), FileName: item.FileName,
		ContentType: item.ContentType, SizeBytes: item.SizeBytes,
		CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt,
	}
}

func sharedBlobFromRow(row officialAssetBlobRow) domainofficialasset.SharedBlob {
	return domainofficialasset.SharedBlob{
		Slug: row.Slug, FileSHA256: row.FileSHA256, BlobID: stringValue(row.BlobID),
		Status: domainofficialasset.SharedBlobStatus(row.Status), LeaseOwner: stringValue(row.LeaseOwner),
		LeaseExpiresAt: cloneTime(row.LeaseExpiresAt), FileName: row.FileName,
		ContentType: row.ContentType, SizeBytes: row.SizeBytes,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func cloneTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := value.UTC()
	return &cloned
}
