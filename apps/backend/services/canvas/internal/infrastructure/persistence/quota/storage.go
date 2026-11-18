package quota

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
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
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		current, err := q.LockQuotaReservation(ctx, reservation.ID)
		if err != nil {
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
			existing, err := q.LockQuotaObject(ctx, sqlc.LockQuotaObjectParams{ObjectType: object.ObjectType, ObjectKey: object.ObjectKey})
			if err != nil {
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
		if err := q.InsertQuotaObject(ctx, sqlc.InsertQuotaObjectParams(row)); err != nil {
			return err
		}
		tenant, err := lockCounter(
			ctx, q, applicationquota.ScopeTenant, current.TenantID, applicationquota.ResourceStorage,
		)
		if err != nil {
			return err
		}
		if tenant.ReservedValue < current.ReservedValue {
			return errors.New("storage reserved value would become negative")
		}
		if err = applyTransition(ctx, q, &tenant, current.ReservedValue, true, true, now); err != nil {
			return err
		}
		current.Status = applicationquota.ReservationCommitted
		current.UpdatedAt = now
		return saveReservation(ctx, q, current)
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
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		count, err := q.EnsureQuotaObject(ctx, sqlc.EnsureQuotaObjectParams(row))
		if err != nil {
			return err
		}
		if count == 1 {
			return nil
		}
		existing, err := q.LockQuotaObject(ctx, sqlc.LockQuotaObjectParams{ObjectType: object.ObjectType, ObjectKey: object.ObjectKey})
		if err != nil {
			return err
		}
		if row.ObjectType == "artifact" {
			return mergeArtifactStorageAlias(ctx, q, existing, row)
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
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		count, err := q.EnsureQuotaObject(ctx, sqlc.EnsureQuotaObjectParams(row))
		if err != nil {
			return err
		}
		if count == 0 {
			existing, err := q.LockQuotaObject(ctx, sqlc.LockQuotaObjectParams{ObjectType: object.ObjectType, ObjectKey: object.ObjectKey})
			if err != nil {
				return err
			}
			if !sameStorageObject(existing, row) || existing.Status != applicationquota.StorageActive {
				return errors.New("admitted storage ledger object conflicts with existing record")
			}
			return nil
		}
		if err := ensureCounter(
			ctx, q, applicationquota.ScopeTenant, object.TenantID, applicationquota.ResourceStorage, now,
		); err != nil {
			return err
		}
		counter, err := lockCounter(
			ctx, q, applicationquota.ScopeTenant, object.TenantID, applicationquota.ResourceStorage,
		)
		if err != nil {
			return err
		}
		counter.UsedValue += object.SizeBytes
		counter.Revision++
		counter.ReportDirty = true
		counter.UpdatedAt = now
		return saveCounter(ctx, q, counter)
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
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		row, err := q.LockQuotaObject(ctx, sqlc.LockQuotaObjectParams{ObjectType: objectType, ObjectKey: objectKey})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		if row.Status == applicationquota.StorageReleased {
			return nil
		}
		if row.BillingClass == applicationquota.BillingBillable {
			if err := ensureCounter(
				ctx, q, applicationquota.ScopeTenant, row.TenantID, applicationquota.ResourceStorage, now,
			); err != nil {
				return err
			}
			counter, err := lockCounter(
				ctx, q, applicationquota.ScopeTenant, row.TenantID, applicationquota.ResourceStorage,
			)
			if err != nil {
				return err
			}
			counter.UsedValue = max(0, counter.UsedValue-row.SizeBytes)
			counter.Revision++
			counter.ReportDirty = true
			counter.UpdatedAt = now
			if err = saveCounter(ctx, q, counter); err != nil {
				return err
			}
		}
		row.Status = applicationquota.StorageReleased
		row.ReleasedAt = &now
		if err := q.ReleaseQuotaObject(ctx, sqlc.ReleaseQuotaObjectParams{
			ObjectType: objectType,
			ObjectKey:  objectKey,
			Status:     row.Status,
			ReleasedAt: row.ReleasedAt,
		}); err != nil {
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
	count, err := r.db.Queries(ctx).MarkQuotaObjectReleasing(ctx, sqlc.MarkQuotaObjectReleasingParams{
		ObjectType: objectType,
		ObjectKey:  objectKey,
	})
	if err != nil {
		return false, fmt.Errorf("mark storage ledger object releasing: %w", err)
	}
	return count == 1, nil
}

func storageRowFromObject(object applicationquota.StorageObject, now time.Time) sqlc.TenantStorageUsageLedger {
	return sqlc.TenantStorageUsageLedger{
		ObjectType: object.ObjectType, ObjectKey: object.ObjectKey,
		TenantID: object.TenantID, WorkspaceID: object.WorkspaceID,
		Category: object.Category, OwnerType: object.OwnerType, OwnerID: object.OwnerID,
		SizeBytes: object.SizeBytes, BillingClass: object.BillingClass,
		Status: applicationquota.StorageActive, CreatedAt: &now,
	}
}

func sameStorageObject(left, right sqlc.TenantStorageUsageLedger) bool {
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

func mergeArtifactStorageAlias(ctx context.Context, q *sqlc.Queries, existing, alias sqlc.TenantStorageUsageLedger) error {
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
	return q.ChangeQuotaObjectClass(ctx, sqlc.ChangeQuotaObjectClassParams{
		ObjectType:   existing.ObjectType,
		ObjectKey:    existing.ObjectKey,
		BillingClass: alias.BillingClass,
	})
}

func billingClassPriority(value string) int {
	switch value {
	case applicationquota.BillingBillable:
		return 3
	case applicationquota.BillingBuiltin:
		return 2
	case applicationquota.BillingBorrowed:
		return 1
	default:
		return 0
	}
}

func stringPointersEqual(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}
