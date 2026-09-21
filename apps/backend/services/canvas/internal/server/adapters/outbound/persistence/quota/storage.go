package quota

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	persistencetransaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	applicationquota "github.com/example/monorepo/canvas/internal/server/application/quota"
)

func (r *Repository) CommitStorage(
	ctx context.Context,
	reservation applicationquota.Reservation,
	object applicationquota.StorageObject,
	now time.Time,
) error {
	if reservation.Resource != applicationquota.ResourceStorage ||
		object.BillingClass != applicationquota.BillingBillable ||
		object.SizeBytes != reservation.Value {
		return errors.New("storage reservation and ledger object do not match")
	}
	err := persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		var current reservationRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", reservation.ID).First(&current).Error; err != nil {
			return err
		}
		expectedKey := applicationquota.StorageIdempotencyKey(object.ObjectType, object.ObjectKey)
		if current.TenantID != object.TenantID ||
			current.ResourceType != string(applicationquota.ResourceStorage) ||
			current.IdempotencyKey != expectedKey ||
			current.ReservedValue != object.SizeBytes {
			return errors.New("storage reservation conflicts with ledger object")
		}
		if current.Status == "committed" {
			var existing storageUsageLedgerRow
			if err := tx.
				Where("object_type = ? AND object_key = ?", object.ObjectType, object.ObjectKey).
				First(&existing).Error; err != nil {
				return err
			}
			if !sameStorageObject(existing, storageRowFromObject(object, now)) {
				return errors.New("storage reservation conflicts with existing ledger object")
			}
			return nil
		}
		if current.Status != applicationquota.ReservationPending {
			return fmt.Errorf("storage reservation %s is already %s", current.ID, current.Status)
		}
		row := storageRowFromObject(object, now)
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		tenant, err := lockCounter(
			tx, applicationquota.ScopeTenant, current.TenantID, applicationquota.ResourceStorage,
		)
		if err != nil {
			return err
		}
		if tenant.ReservedValue < current.ReservedValue {
			return errors.New("storage reserved value would become negative")
		}
		if err = applyTransition(tx, &tenant, current.ReservedValue, true, true, now); err != nil {
			return err
		}
		return tx.Model(&current).Updates(map[string]any{
			"status": "committed", "updated_at": now,
		}).Error
	})
	if err != nil {
		return fmt.Errorf("commit storage quota reservation: %w", err)
	}
	return nil
}

func (r *Repository) RecordStorage(
	ctx context.Context,
	object applicationquota.StorageObject,
	now time.Time,
) error {
	if object.SizeBytes <= 0 ||
		(object.BillingClass != applicationquota.BillingBuiltin &&
			object.BillingClass != applicationquota.BillingBorrowed) {
		return errors.New("non-billable storage ledger object is invalid")
	}
	row := storageRowFromObject(object, now)
	err := persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			return nil
		}
		var existing storageUsageLedgerRow
		if err := tx.Where(
			"object_type = ? AND object_key = ?", object.ObjectType, object.ObjectKey,
		).First(&existing).Error; err != nil {
			return err
		}
		if row.ObjectType == "artifact" {
			return mergeArtifactStorageAlias(tx, existing, row)
		}
		if !sameStorageObject(existing, row) {
			return errors.New("storage ledger object conflicts with existing record")
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("record non-billable storage ledger object: %w", err)
	}
	return nil
}

func (r *Repository) RecordAdmittedStorage(
	ctx context.Context,
	object applicationquota.StorageObject,
	now time.Time,
) error {
	if object.SizeBytes <= 0 || object.BillingClass != applicationquota.BillingBillable {
		return errors.New("admitted storage ledger object is invalid")
	}
	row := storageRowFromObject(object, now)
	err := persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			var existing storageUsageLedgerRow
			if err := tx.Where(
				"object_type = ? AND object_key = ?", object.ObjectType, object.ObjectKey,
			).First(&existing).Error; err != nil {
				return err
			}
			if !sameStorageObject(existing, row) || existing.Status != applicationquota.StorageActive {
				return errors.New("admitted storage ledger object conflicts with existing record")
			}
			return nil
		}
		if err := ensureCounter(
			tx, applicationquota.ScopeTenant, object.TenantID, applicationquota.ResourceStorage, now,
		); err != nil {
			return err
		}
		counter, err := lockCounter(
			tx, applicationquota.ScopeTenant, object.TenantID, applicationquota.ResourceStorage,
		)
		if err != nil {
			return err
		}
		counter.UsedValue += object.SizeBytes
		counter.Revision++
		counter.ReportDirty = true
		counter.UpdatedAt = now
		return tx.Save(&counter).Error
	})
	if err != nil {
		return fmt.Errorf("record admitted storage ledger object: %w", err)
	}
	return nil
}

func (r *Repository) ReleaseStorage(
	ctx context.Context,
	objectType string,
	objectKey string,
	now time.Time,
) (bool, error) {
	released := false
	err := persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		var row storageUsageLedgerRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("object_type = ? AND object_key = ?", objectType, objectKey).
			First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if row.Status == applicationquota.StorageReleased {
			return nil
		}
		if row.BillingClass == applicationquota.BillingBillable {
			if err := ensureCounter(
				tx, applicationquota.ScopeTenant, row.TenantID, applicationquota.ResourceStorage, now,
			); err != nil {
				return err
			}
			counter, err := lockCounter(
				tx, applicationquota.ScopeTenant, row.TenantID, applicationquota.ResourceStorage,
			)
			if err != nil {
				return err
			}
			counter.UsedValue = max(0, counter.UsedValue-row.SizeBytes)
			counter.Revision++
			counter.ReportDirty = true
			counter.UpdatedAt = now
			if err = tx.Save(&counter).Error; err != nil {
				return err
			}
		}
		row.Status = applicationquota.StorageReleased
		row.ReleasedAt = &now
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		released = true
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("release storage ledger object: %w", err)
	}
	return released, nil
}

func (r *Repository) MarkStorageReleasing(
	ctx context.Context,
	objectType string,
	objectKey string,
	now time.Time,
) (bool, error) {
	result := persistencetransaction.DB(ctx, r.db).Model(&storageUsageLedgerRow{}).
		Where(
			"object_type = ? AND object_key = ? AND status = ?",
			objectType, objectKey, applicationquota.StorageActive,
		).
		Updates(map[string]any{"status": applicationquota.StorageReleasing})
	if result.Error != nil {
		return false, fmt.Errorf("mark storage ledger object releasing: %w", result.Error)
	}
	if result.RowsAffected == 1 {
		return true, nil
	}
	var count int64
	if err := persistencetransaction.DB(ctx, r.db).Model(&storageUsageLedgerRow{}).
		Where(
			"object_type = ? AND object_key = ? AND status = ?",
			objectType, objectKey, applicationquota.StorageReleasing,
		).Count(&count).Error; err != nil {
		return false, fmt.Errorf("check storage ledger object releasing: %w", err)
	}
	return count == 1, nil
}

func storageRowFromObject(object applicationquota.StorageObject, now time.Time) storageUsageLedgerRow {
	return storageUsageLedgerRow{
		ObjectType: object.ObjectType, ObjectKey: object.ObjectKey,
		TenantID: object.TenantID, WorkspaceID: object.WorkspaceID,
		Category: object.Category, OwnerType: object.OwnerType, OwnerID: object.OwnerID,
		SizeBytes: object.SizeBytes, BillingClass: object.BillingClass,
		Status: applicationquota.StorageActive, CreatedAt: now,
	}
}

func sameStorageObject(left, right storageUsageLedgerRow) bool {
	return left.ObjectType == right.ObjectType &&
		left.ObjectKey == right.ObjectKey &&
		left.TenantID == right.TenantID &&
		stringPointersEqual(left.WorkspaceID, right.WorkspaceID) &&
		left.Category == right.Category &&
		left.OwnerType == right.OwnerType &&
		left.OwnerID == right.OwnerID &&
		left.SizeBytes == right.SizeBytes &&
		left.BillingClass == right.BillingClass
}

func mergeArtifactStorageAlias(tx *gorm.DB, existing, alias storageUsageLedgerRow) error {
	if existing.ObjectType != alias.ObjectType ||
		existing.ObjectKey != alias.ObjectKey ||
		existing.TenantID != alias.TenantID ||
		!stringPointersEqual(existing.WorkspaceID, alias.WorkspaceID) ||
		existing.Category != alias.Category ||
		existing.SizeBytes != alias.SizeBytes ||
		billingClassPriority(existing.BillingClass) == 0 {
		return errors.New("storage ledger object conflicts with existing record")
	}
	if billingClassPriority(alias.BillingClass) <= billingClassPriority(existing.BillingClass) {
		return nil
	}
	// Artifact lifetime and billing are shared across Asset aliases. Keep the
	// first owner as audit metadata and only raise the aggregate billing class.
	return tx.Model(&storageUsageLedgerRow{}).
		Where("object_type = ? AND object_key = ?", existing.ObjectType, existing.ObjectKey).
		Update("billing_class", alias.BillingClass).Error
}

func stringPointersEqual(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}
