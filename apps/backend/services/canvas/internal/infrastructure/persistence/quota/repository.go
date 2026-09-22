package quota

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct {
	db  *gorm.DB
	log *zap.Logger
}

func NewRepository(db *gorm.DB, log *zap.Logger) *Repository {
	return &Repository{db: db, log: log}
}

func (r *Repository) Usage(
	ctx context.Context,
	tenantID string,
	resource applicationquota.ResourceType,
) (applicationquota.Usage, error) {
	var row usageCounterRow
	err := persistencetransaction.DB(ctx, r.db).Where(
		"scope_type = ? AND scope_id = ? AND resource_type = ?",
		applicationquota.ScopeTenant, tenantID, resource,
	).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return applicationquota.Usage{}, nil
	}
	if err != nil {
		return applicationquota.Usage{}, err
	}
	return applicationquota.Usage{Used: row.UsedValue, Reserved: row.ReservedValue}, nil
}

func (r *Repository) Reserve(
	ctx context.Context,
	request applicationquota.ReserveRequest,
) (applicationquota.Reservation, error) {
	var result applicationquota.Reservation
	err := persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		var existing reservationRow
		// Probe without a locking read first. InnoDB takes a gap lock for a missing
		// unique key under REPEATABLE READ; concurrent new reservations would then
		// deadlock when each transaction tries to insert into the locked gaps. An
		// existing reservation is re-read by primary key with FOR UPDATE below.
		err := tx.Where("idempotency_key = ?", request.IdempotencyKey).First(&existing).Error
		if err == nil {
			err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ?", existing.ID).First(&existing).Error
		}
		existingFound := err == nil
		if err == nil {
			if existing.TenantID != request.TenantID ||
				existing.ResourceType != string(request.Resource) ||
				existing.ReservedValue != request.Value {
				return errors.New("quota reservation idempotency key conflicts with existing record")
			}
			switch existing.Status {
			case applicationquota.ReservationPending, applicationquota.ReservationReacquiring:
				if existing.TargetType != request.TargetType || existing.TargetID != request.TargetID {
					return applicationquota.ErrReservationInProgress
				}
				result = reservationFromRow(existing)
				return nil
			case applicationquota.ReservationCommitted:
				result = reservationFromRow(existing)
				return nil
			case applicationquota.ReservationReleasing:
				if request.Resource != applicationquota.ResourcePresetEntitlement {
					return fmt.Errorf("resource %s does not support reacquisition", request.Resource)
				}
				existing.Status = applicationquota.ReservationReacquiring
				existing.TargetType = request.TargetType
				existing.TargetID = request.TargetID
				existing.ExpiresAt = request.ExpiresAt
				existing.StateVersion++
				existing.UpdatedAt = request.Now
				if err = tx.Save(&existing).Error; err != nil {
					return err
				}
				result = reservationFromRow(existing)
				return nil
			case applicationquota.ReservationReleased:
				// A released logical key can be used again, but it must pass the
				// current limits and reserve a fresh slot below.
			default:
				return fmt.Errorf("quota reservation %s has unsupported status %q", existing.ID, existing.Status)
			}
		}
		if !existingFound && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if usesPlatform(request.Resource) {
			if err = ensureCounter(tx, applicationquota.ScopePlatform, applicationquota.PlatformScopeID, request.Resource, request.Now); err != nil {
				return err
			}
		}
		if err = ensureCounter(tx, applicationquota.ScopeTenant, request.TenantID, request.Resource, request.Now); err != nil {
			return err
		}
		var platform *usageCounterRow
		if usesPlatform(request.Resource) {
			row, lockErr := lockCounter(tx, applicationquota.ScopePlatform, applicationquota.PlatformScopeID, request.Resource)
			if lockErr != nil {
				return lockErr
			}
			platform = &row
		}
		tenant, err := lockCounter(tx, applicationquota.ScopeTenant, request.TenantID, request.Resource)
		if err != nil {
			return err
		}
		exceeded := exceeds(tenant, request.TenantLimit, request.Value) ||
			(platform != nil && exceeds(*platform, request.PlatformLimit, request.Value))
		if exceeded && request.Enforce {
			return applicationquota.ErrExceeded
		}
		row := existing
		if !existingFound {
			row = reservationRow{
				ID: request.ID, TenantID: request.TenantID, ResourceType: string(request.Resource),
				IdempotencyKey: request.IdempotencyKey, ReservedValue: request.Value,
				WouldReject: !request.LimitAvailable || exceeded,
				Status:      applicationquota.ReservationPending, StateVersion: 1,
				TargetType: request.TargetType, TargetID: request.TargetID,
				ExpiresAt: request.ExpiresAt, CreatedAt: request.Now, UpdatedAt: request.Now,
			}
			if err = tx.Create(&row).Error; err != nil {
				return err
			}
		} else {
			row.Status = applicationquota.ReservationPending
			row.WouldReject = !request.LimitAvailable || exceeded
			row.TargetType = request.TargetType
			row.TargetID = request.TargetID
			row.ExpiresAt = request.ExpiresAt
			row.StateVersion++
			row.UpdatedAt = request.Now
			if err = tx.Save(&row).Error; err != nil {
				return err
			}
		}
		if platform != nil {
			if err = addReserved(tx, platform, request.Value, request.Now); err != nil {
				return err
			}
		}
		if err = addReserved(tx, &tenant, request.Value, request.Now); err != nil {
			return err
		}
		result = reservationFromRow(row)
		return nil
	})
	if err != nil {
		return applicationquota.Reservation{}, fmt.Errorf("reserve %s quota: %w", request.Resource, err)
	}
	return result, nil
}

func (r *Repository) Commit(
	ctx context.Context,
	reservation applicationquota.Reservation,
	now time.Time,
) error {
	return r.transition(ctx, reservation, applicationquota.ReservationCommitted, now, true)
}

func (r *Repository) Release(
	ctx context.Context,
	reservation applicationquota.Reservation,
	now time.Time,
) error {
	return r.transition(ctx, reservation, applicationquota.ReservationReleased, now, false)
}

func (r *Repository) transition(
	ctx context.Context,
	reservation applicationquota.Reservation,
	status string,
	now time.Time,
	commit bool,
) error {
	err := persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		var row reservationRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", reservation.ID).First(&row).Error; err != nil {
			return err
		}
		if row.Status == status {
			return nil
		}
		if row.ResourceType == string(applicationquota.ResourcePresetEntitlement) {
			switch {
			case commit && row.Status == applicationquota.ReservationReacquiring:
				row.Status = applicationquota.ReservationCommitted
				row.StateVersion++
				row.UpdatedAt = now
				return tx.Save(&row).Error
			case !commit && row.Status == applicationquota.ReservationReacquiring:
				if row.PendingCleanupCount > 0 {
					row.Status = applicationquota.ReservationReleasing
					row.StateVersion++
					row.UpdatedAt = now
					return tx.Save(&row).Error
				}
				if err := decrementPresetEntitlementCounters(tx, &row, now); err != nil {
					return err
				}
				row.Status = applicationquota.ReservationReleased
				row.StateVersion++
				row.UpdatedAt = now
				return tx.Save(&row).Error
			case !commit && (row.Status == applicationquota.ReservationCommitted ||
				row.Status == applicationquota.ReservationReleasing):
				return nil
			}
		}
		if row.Status != applicationquota.ReservationPending {
			return fmt.Errorf("reservation %s is already %s", row.ID, row.Status)
		}
		resource := applicationquota.ResourceType(row.ResourceType)
		var platform *usageCounterRow
		if usesPlatform(resource) {
			counter, lockErr := lockCounter(tx, applicationquota.ScopePlatform, applicationquota.PlatformScopeID, resource)
			if lockErr != nil {
				return lockErr
			}
			platform = &counter
		}
		tenant, err := lockCounter(tx, applicationquota.ScopeTenant, row.TenantID, resource)
		if err != nil {
			return err
		}
		if (platform != nil && platform.ReservedValue < row.ReservedValue) ||
			tenant.ReservedValue < row.ReservedValue {
			return errors.New("quota reserved value would become negative")
		}
		if platform != nil {
			if err = applyTransition(tx, platform, row.ReservedValue, commit, false, now); err != nil {
				return err
			}
		}
		if err = applyTransition(tx, &tenant, row.ReservedValue, commit, commit, now); err != nil {
			return err
		}
		return tx.Model(&row).Updates(map[string]any{
			"status": status, "state_version": row.StateVersion + 1, "updated_at": now,
		}).Error
	})
	if err != nil {
		return fmt.Errorf("%s quota reservation: %w", status, err)
	}
	return nil
}

func (r *Repository) BeginPresetEntitlementRelease(
	ctx context.Context,
	reservationID string,
	now time.Time,
) error {
	err := persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		var row reservationRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", reservationID).First(&row).Error; err != nil {
			return err
		}
		if row.ResourceType != string(applicationquota.ResourcePresetEntitlement) {
			return errors.New("quota reservation is not a preset entitlement")
		}
		switch row.Status {
		case applicationquota.ReservationCommitted:
			row.Status = applicationquota.ReservationReleasing
		case applicationquota.ReservationReleasing, applicationquota.ReservationReacquiring:
		default:
			return fmt.Errorf("preset entitlement reservation %s cannot begin release from %s", row.ID, row.Status)
		}
		row.PendingCleanupCount++
		row.StateVersion++
		row.UpdatedAt = now
		return tx.Save(&row).Error
	})
	if err != nil {
		return fmt.Errorf("begin preset entitlement release: %w", err)
	}
	return nil
}

func (r *Repository) CompletePresetEntitlementCleanup(
	ctx context.Context,
	reservationID string,
	now time.Time,
) (bool, error) {
	released := false
	err := persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		var row reservationRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", reservationID).First(&row).Error; err != nil {
			return err
		}
		if row.ResourceType != string(applicationquota.ResourcePresetEntitlement) {
			return errors.New("quota reservation is not a preset entitlement")
		}
		if row.PendingCleanupCount <= 0 {
			return errors.New("preset entitlement cleanup count would become negative")
		}
		row.PendingCleanupCount--
		if row.PendingCleanupCount == 0 && row.Status == applicationquota.ReservationReleasing {
			if err := decrementPresetEntitlementCounters(tx, &row, now); err != nil {
				return err
			}
			row.Status = applicationquota.ReservationReleased
			released = true
		}
		row.StateVersion++
		row.UpdatedAt = now
		return tx.Save(&row).Error
	})
	if err != nil {
		return false, fmt.Errorf("complete preset entitlement cleanup: %w", err)
	}
	return released, nil
}

func decrementPresetEntitlementCounters(tx *gorm.DB, reservation *reservationRow, now time.Time) error {
	platform, err := lockCounter(
		tx, applicationquota.ScopePlatform, applicationquota.PlatformScopeID,
		applicationquota.ResourcePresetEntitlement,
	)
	if err != nil {
		return err
	}
	tenant, err := lockCounter(
		tx, applicationquota.ScopeTenant, reservation.TenantID,
		applicationquota.ResourcePresetEntitlement,
	)
	if err != nil {
		return err
	}
	if platform.UsedValue < reservation.ReservedValue || tenant.UsedValue < reservation.ReservedValue {
		return errors.New("preset entitlement used value would become negative")
	}
	platform.UsedValue -= reservation.ReservedValue
	platform.Revision++
	platform.UpdatedAt = now
	if err = tx.Save(&platform).Error; err != nil {
		return err
	}
	tenant.UsedValue -= reservation.ReservedValue
	tenant.Revision++
	tenant.ReportDirty = true
	tenant.UpdatedAt = now
	return tx.Save(&tenant).Error
}

func (r *Repository) Decrement(
	ctx context.Context,
	tenantID string,
	resource applicationquota.ResourceType,
	value int64,
	now time.Time,
) error {
	err := persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		if usesPlatform(resource) {
			if err := ensureCounter(tx, applicationquota.ScopePlatform, applicationquota.PlatformScopeID, resource, now); err != nil {
				return err
			}
		}
		if err := ensureCounter(tx, applicationquota.ScopeTenant, tenantID, resource, now); err != nil {
			return err
		}
		var platform *usageCounterRow
		if usesPlatform(resource) {
			counter, lockErr := lockCounter(tx, applicationquota.ScopePlatform, applicationquota.PlatformScopeID, resource)
			if lockErr != nil {
				return lockErr
			}
			platform = &counter
		}
		tenant, err := lockCounter(tx, applicationquota.ScopeTenant, tenantID, resource)
		if err != nil {
			return err
		}
		if platform != nil {
			platform.UsedValue = max(0, platform.UsedValue-value)
			platform.Revision++
			platform.UpdatedAt = now
			if err = tx.Save(platform).Error; err != nil {
				return err
			}
		}
		tenant.UsedValue = max(0, tenant.UsedValue-value)
		tenant.Revision++
		tenant.ReportDirty = true
		tenant.UpdatedAt = now
		return tx.Save(&tenant).Error
	})
	if err != nil {
		return fmt.Errorf("decrement %s quota: %w", resource, err)
	}
	return nil
}

func ensureCounter(
	tx *gorm.DB,
	scopeType string,
	scopeID string,
	resource applicationquota.ResourceType,
	now time.Time,
) error {
	row := usageCounterRow{
		ScopeType: scopeType, ScopeID: scopeID, ResourceType: string(resource),
		UpdatedAt: now,
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
}

func lockCounter(
	tx *gorm.DB,
	scopeType string,
	scopeID string,
	resource applicationquota.ResourceType,
) (usageCounterRow, error) {
	var row usageCounterRow
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("scope_type = ? AND scope_id = ? AND resource_type = ?",
			scopeType, scopeID, resource).
		First(&row).Error
	return row, err
}

func exceeds(counter usageCounterRow, limit *int64, delta int64) bool {
	if limit == nil {
		return false
	}
	if counter.UsedValue > *limit {
		return true
	}
	remaining := *limit - counter.UsedValue
	return counter.ReservedValue > remaining || delta > remaining-counter.ReservedValue
}

func addReserved(tx *gorm.DB, counter *usageCounterRow, value int64, now time.Time) error {
	counter.ReservedValue += value
	counter.Revision++
	counter.UpdatedAt = now
	return tx.Save(counter).Error
}

func applyTransition(
	tx *gorm.DB,
	counter *usageCounterRow,
	value int64,
	commit bool,
	dirty bool,
	now time.Time,
) error {
	counter.ReservedValue -= value
	if commit {
		counter.UsedValue += value
	}
	counter.Revision++
	counter.ReportDirty = counter.ReportDirty || dirty
	counter.UpdatedAt = now
	return tx.Save(counter).Error
}

func reservationFromRow(row reservationRow) applicationquota.Reservation {
	return applicationquota.Reservation{
		ID: row.ID, TenantID: row.TenantID, Resource: applicationquota.ResourceType(row.ResourceType),
		Value: row.ReservedValue, WouldReject: row.WouldReject,
	}
}

func usesPlatform(resource applicationquota.ResourceType) bool {
	return resource == applicationquota.ResourceProject ||
		resource == applicationquota.ResourcePresetEntitlement
}

func (r *Repository) ClaimDirty(
	ctx context.Context,
	owner string,
	now time.Time,
	leaseUntil time.Time,
	limit int,
) ([]applicationquota.ReportClaim, error) {
	var candidates []usageCounterRow
	err := r.db.WithContext(ctx).
		Where("scope_type = ? AND report_dirty = ?", applicationquota.ScopeTenant, true).
		Where("report_lease_until IS NULL OR report_lease_until <= ?", now).
		Order("scope_id ASC, resource_type ASC").Limit(limit).Find(&candidates).Error
	if err != nil {
		return nil, err
	}
	claims := make([]applicationquota.ReportClaim, 0, len(candidates))
	for _, candidate := range candidates {
		var claim applicationquota.ReportClaim
		err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			current, lockErr := lockCounter(
				tx, candidate.ScopeType, candidate.ScopeID,
				applicationquota.ResourceType(candidate.ResourceType),
			)
			if lockErr != nil {
				return lockErr
			}
			if !current.ReportDirty ||
				(current.ReportLeaseUntil != nil && current.ReportLeaseUntil.After(now)) {
				return nil
			}
			current.ReportLeaseToken = owner
			current.ReportLeaseUntil = &leaseUntil
			if saveErr := tx.Save(&current).Error; saveErr != nil {
				return saveErr
			}
			claim = applicationquota.ReportClaim{
				TenantID: current.ScopeID, Resource: applicationquota.ResourceType(current.ResourceType),
				Value:    current.UsedValue,
				Revision: current.Revision, LeaseToken: owner,
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		if claim.TenantID != "" {
			claims = append(claims, claim)
		}
	}
	return claims, nil
}

func (r *Repository) CompleteReport(
	ctx context.Context,
	claim applicationquota.ReportClaim,
	now time.Time,
) (bool, error) {
	result := r.db.WithContext(ctx).Model(&usageCounterRow{}).
		Where("scope_type = ? AND scope_id = ? AND resource_type = ? AND revision = ? AND report_lease_token = ?",
			applicationquota.ScopeTenant, claim.TenantID, claim.Resource,
			claim.Revision, claim.LeaseToken).
		Updates(map[string]any{
			"report_dirty": false, "last_reported_value": claim.Value, "last_reported_at": now,
			"report_lease_token": "", "report_lease_until": nil,
		})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *Repository) ReconcileAll(ctx context.Context, now time.Time, forceReport bool) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := releaseExpiredReservations(tx, now); err != nil {
			return err
		}
		facts, platformFacts, err := loadUsageFacts(tx)
		if err != nil {
			return err
		}
		for _, resource := range []applicationquota.ResourceType{
			applicationquota.ResourceProject,
			applicationquota.ResourcePresetEntitlement,
			applicationquota.ResourceStorage,
		} {
			if err = addMissingCounterFacts(tx, resource, facts[resource]); err != nil {
				return err
			}
			if usesPlatform(resource) {
				if err = reconcileCounter(
					tx, applicationquota.ScopePlatform, applicationquota.PlatformScopeID,
					resource, platformFacts[resource], now, false,
				); err != nil {
					return err
				}
			}
			for tenantID, total := range facts[resource] {
				if err = reconcileCounter(
					tx, applicationquota.ScopeTenant, tenantID, resource,
					total, now, forceReport,
				); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func loadUsageFacts(
	db *gorm.DB,
) (map[applicationquota.ResourceType]map[string]int64, map[applicationquota.ResourceType]int64, error) {
	type tenantUsage struct {
		TenantID string
		Total    int64
	}
	facts := map[applicationquota.ResourceType]map[string]int64{
		applicationquota.ResourceProject:           {},
		applicationquota.ResourcePresetEntitlement: {},
		applicationquota.ResourceStorage:           {},
	}
	platformFacts := map[applicationquota.ResourceType]int64{}

	var projects []tenantUsage
	if err := db.Table("projects").
		Select("tenant_id, COUNT(*) AS total").
		Where("deleted_at = 0").
		Group("tenant_id").Scan(&projects).Error; err != nil {
		return nil, nil, fmt.Errorf("aggregate project quota facts: %w", err)
	}
	for _, item := range projects {
		facts[applicationquota.ResourceProject][item.TenantID] = item.Total
		platformFacts[applicationquota.ResourceProject] += item.Total
	}

	var presets []tenantUsage
	if err := db.Table("resource_quota_reservations").
		Select("tenant_id, COALESCE(SUM(reserved_value), 0) AS total").
		Where(
			"resource_type = ? AND status IN ?",
			applicationquota.ResourcePresetEntitlement,
			[]string{
				applicationquota.ReservationCommitted,
				applicationquota.ReservationReleasing,
				applicationquota.ReservationReacquiring,
			},
		).
		Group("tenant_id").Scan(&presets).Error; err != nil {
		return nil, nil, fmt.Errorf("aggregate preset entitlement quota facts: %w", err)
	}
	for _, item := range presets {
		facts[applicationquota.ResourcePresetEntitlement][item.TenantID] = item.Total
		platformFacts[applicationquota.ResourcePresetEntitlement] += item.Total
	}

	var storage []tenantUsage
	if err := db.Table("tenant_storage_usage_ledger").
		Select("tenant_id, COALESCE(SUM(size_bytes), 0) AS total").
		Where(
			"billing_class = ? AND status IN ?",
			applicationquota.BillingBillable,
			[]string{applicationquota.StorageActive, applicationquota.StorageReleasing},
		).
		Group("tenant_id").Scan(&storage).Error; err != nil {
		return nil, nil, fmt.Errorf("aggregate storage quota facts: %w", err)
	}
	for _, item := range storage {
		facts[applicationquota.ResourceStorage][item.TenantID] = item.Total
	}
	return facts, platformFacts, nil
}

func addMissingCounterFacts(
	tx *gorm.DB,
	resource applicationquota.ResourceType,
	facts map[string]int64,
) error {
	var existing []usageCounterRow
	if err := tx.Where(
		"scope_type = ? AND resource_type = ?",
		applicationquota.ScopeTenant, resource,
	).Find(&existing).Error; err != nil {
		return err
	}
	for _, row := range existing {
		if _, ok := facts[row.ScopeID]; !ok {
			facts[row.ScopeID] = 0
		}
	}
	return nil
}

func releaseExpiredReservations(tx *gorm.DB, now time.Time) error {
	var expired []reservationRow
	if err := tx.Where(
		"status IN ? AND expires_at <= ?",
		[]string{applicationquota.ReservationPending, applicationquota.ReservationReacquiring},
		now,
	).
		Order("tenant_id ASC, id ASC").Find(&expired).Error; err != nil {
		return err
	}
	for _, reservation := range expired {
		var current reservationRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", reservation.ID).First(&current).Error; err != nil {
			return err
		}
		if current.ExpiresAt.After(now) {
			continue
		}
		if current.Status == applicationquota.ReservationReacquiring {
			if current.PendingCleanupCount > 0 {
				current.Status = applicationquota.ReservationReleasing
			} else {
				if err := decrementPresetEntitlementCounters(tx, &current, now); err != nil {
					return err
				}
				current.Status = applicationquota.ReservationReleased
			}
			current.StateVersion++
			current.UpdatedAt = now
			if err := tx.Save(&current).Error; err != nil {
				return err
			}
			continue
		}
		if current.Status != applicationquota.ReservationPending {
			continue
		}
		exists, err := reservationTargetExists(tx, current)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		resource := applicationquota.ResourceType(current.ResourceType)
		var platform *usageCounterRow
		if usesPlatform(resource) {
			counter, lockErr := lockCounter(tx, applicationquota.ScopePlatform, applicationquota.PlatformScopeID, resource)
			if lockErr != nil {
				return lockErr
			}
			platform = &counter
		}
		tenant, err := lockCounter(tx, applicationquota.ScopeTenant, current.TenantID, resource)
		if err != nil {
			return err
		}
		if (platform != nil && platform.ReservedValue < current.ReservedValue) ||
			tenant.ReservedValue < current.ReservedValue {
			return errors.New("expired quota reservation would make reserved value negative")
		}
		if platform != nil {
			if err = applyTransition(tx, platform, current.ReservedValue, false, false, now); err != nil {
				return err
			}
		}
		if err = applyTransition(tx, &tenant, current.ReservedValue, false, false, now); err != nil {
			return err
		}
		if err = tx.Model(&current).Updates(map[string]any{
			"status":        applicationquota.ReservationReleased,
			"state_version": current.StateVersion + 1,
			"updated_at":    now,
		}).Error; err != nil {
			return err
		}
	}
	return nil
}

func reservationTargetExists(tx *gorm.DB, reservation reservationRow) (bool, error) {
	var count int64
	var query *gorm.DB
	switch reservation.TargetType {
	case "project":
		query = tx.Table("projects").Where(
			"id = ? AND tenant_id = ? AND deleted_at = 0",
			reservation.TargetID, reservation.TenantID,
		)
	case "asset_review":
		query = tx.Table("asset_reviews").Where(
			"id = ? AND tenant_id = ? AND submitted_at IS NOT NULL AND deleted_at = 0",
			reservation.TargetID, reservation.TenantID,
		)
	case "asset", "project_cover", "canvas_cover", "canvas_archive":
		query = tx.Table("tenant_storage_usage_ledger").Where(
			"tenant_id = ? AND owner_type = ? AND owner_id = ? AND status IN ?",
			reservation.TenantID, reservation.TargetType, reservation.TargetID,
			[]string{applicationquota.StorageActive, applicationquota.StorageReleasing},
		)
	default:
		// A new target type must define its fact lookup before expired reservations
		// can be released without risking quota oversell.
		return true, nil
	}
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func reconcileCounter(
	tx *gorm.DB,
	scopeType string,
	scopeID string,
	resource applicationquota.ResourceType,
	value int64,
	now time.Time,
	forceReport bool,
) error {
	if err := ensureCounter(tx, scopeType, scopeID, resource, now); err != nil {
		return err
	}
	row, err := lockCounter(tx, scopeType, scopeID, resource)
	if err != nil {
		return err
	}
	if row.UsedValue == value && (!forceReport || scopeType != applicationquota.ScopeTenant) {
		return nil
	}
	row.UsedValue = value
	row.Revision++
	row.ReportDirty = row.ReportDirty || scopeType == applicationquota.ScopeTenant
	row.UpdatedAt = now
	return tx.Save(&row).Error
}

var _ applicationquota.Store = (*Repository)(nil)
var _ applicationquota.ReportingStore = (*Repository)(nil)
