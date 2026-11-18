package quota

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct {
	db  *persistencetransaction.Store
	log *slog.Logger
}

func NewRepository(db *persistencetransaction.Store, log *slog.Logger) *Repository {
	return &Repository{db: db, log: log}
}

func (r *Repository) Usage(
	ctx context.Context,
	tenantID string,
	resource applicationquota.ResourceType,
) (applicationquota.Usage, error) {
	row, err := r.db.Queries(ctx).ReadQuotaCounter(ctx, sqlc.ReadQuotaCounterParams{
		ScopeType:    applicationquota.ScopeTenant,
		ScopeID:      tenantID,
		ResourceType: string(resource),
	})
	if errors.Is(err, pgx.ErrNoRows) {
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
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		// Serialize retries of a logical reservation, including its first insertion.
		if err := q.SerializeQuotaReservationKey(ctx, request.IdempotencyKey); err != nil {
			return err
		}
		existing, err := q.LockQuotaReservationByKey(ctx, request.IdempotencyKey)
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
				if err = saveReservation(ctx, q, existing); err != nil {
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
		if !existingFound && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if usesPlatform(request.Resource) {
			if err = ensureCounter(ctx, q, applicationquota.ScopePlatform, applicationquota.PlatformScopeID, request.Resource, request.Now); err != nil {
				return err
			}
		}
		if err = ensureCounter(ctx, q, applicationquota.ScopeTenant, request.TenantID, request.Resource, request.Now); err != nil {
			return err
		}
		var platform *sqlc.ResourceUsageCounter
		if usesPlatform(request.Resource) {
			row, lockErr := lockCounter(ctx, q, applicationquota.ScopePlatform, applicationquota.PlatformScopeID, request.Resource)
			if lockErr != nil {
				return lockErr
			}
			platform = &row
		}
		tenant, err := lockCounter(ctx, q, applicationquota.ScopeTenant, request.TenantID, request.Resource)
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
			row = sqlc.ResourceQuotaReservation{
				ID: request.ID, TenantID: request.TenantID, ResourceType: string(request.Resource),
				IdempotencyKey: request.IdempotencyKey, ReservedValue: request.Value,
				WouldReject: !request.LimitAvailable || exceeded,
				Status:      applicationquota.ReservationPending, StateVersion: 1,
				TargetType: request.TargetType, TargetID: request.TargetID,
				ExpiresAt: request.ExpiresAt, CreatedAt: request.Now, UpdatedAt: request.Now,
			}
			if err = q.InsertQuotaReservation(ctx, sqlc.InsertQuotaReservationParams(row)); err != nil {
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
			if err = saveReservation(ctx, q, row); err != nil {
				return err
			}
		}
		if platform != nil {
			if err = addReserved(ctx, q, platform, request.Value, request.Now); err != nil {
				return err
			}
		}
		if err = addReserved(ctx, q, &tenant, request.Value, request.Now); err != nil {
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
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		row, err := q.LockQuotaReservation(ctx, reservation.ID)
		if err != nil {
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
				return saveReservation(ctx, q, row)
			case !commit && row.Status == applicationquota.ReservationReacquiring:
				if row.PendingCleanupCount > 0 {
					row.Status = applicationquota.ReservationReleasing
					row.StateVersion++
					row.UpdatedAt = now
					return saveReservation(ctx, q, row)
				}
				if err := decrementPresetEntitlementCounters(ctx, q, &row, now); err != nil {
					return err
				}
				row.Status = applicationquota.ReservationReleased
				row.StateVersion++
				row.UpdatedAt = now
				return saveReservation(ctx, q, row)
			case !commit && (row.Status == applicationquota.ReservationCommitted ||
				row.Status == applicationquota.ReservationReleasing):
				return nil
			}
		}
		if row.Status != applicationquota.ReservationPending {
			return fmt.Errorf("reservation %s is already %s", row.ID, row.Status)
		}
		resource := applicationquota.ResourceType(row.ResourceType)
		var platform *sqlc.ResourceUsageCounter
		if usesPlatform(resource) {
			counter, lockErr := lockCounter(ctx, q, applicationquota.ScopePlatform, applicationquota.PlatformScopeID, resource)
			if lockErr != nil {
				return lockErr
			}
			platform = &counter
		}
		tenant, err := lockCounter(ctx, q, applicationquota.ScopeTenant, row.TenantID, resource)
		if err != nil {
			return err
		}
		if (platform != nil && platform.ReservedValue < row.ReservedValue) ||
			tenant.ReservedValue < row.ReservedValue {
			return errors.New("quota reserved value would become negative")
		}
		if platform != nil {
			if err = applyTransition(ctx, q, platform, row.ReservedValue, commit, false, now); err != nil {
				return err
			}
		}
		if err = applyTransition(ctx, q, &tenant, row.ReservedValue, commit, commit, now); err != nil {
			return err
		}
		row.Status = status
		row.StateVersion++
		row.UpdatedAt = now
		return saveReservation(ctx, q, row)
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
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		row, err := q.LockQuotaReservation(ctx, reservationID)
		if err != nil {
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
		return saveReservation(ctx, q, row)
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
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		row, err := q.LockQuotaReservation(ctx, reservationID)
		if err != nil {
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
			if err := decrementPresetEntitlementCounters(ctx, q, &row, now); err != nil {
				return err
			}
			row.Status = applicationquota.ReservationReleased
			released = true
		}
		row.StateVersion++
		row.UpdatedAt = now
		return saveReservation(ctx, q, row)
	})
	if err != nil {
		return false, fmt.Errorf("complete preset entitlement cleanup: %w", err)
	}
	return released, nil
}

func decrementPresetEntitlementCounters(ctx context.Context, q *sqlc.Queries, reservation *sqlc.ResourceQuotaReservation, now time.Time) error {
	platform, err := lockCounter(
		ctx, q, applicationquota.ScopePlatform, applicationquota.PlatformScopeID,
		applicationquota.ResourcePresetEntitlement,
	)
	if err != nil {
		return err
	}
	tenant, err := lockCounter(
		ctx, q, applicationquota.ScopeTenant, reservation.TenantID,
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
	if err = saveCounter(ctx, q, platform); err != nil {
		return err
	}
	tenant.UsedValue -= reservation.ReservedValue
	tenant.Revision++
	tenant.ReportDirty = true
	tenant.UpdatedAt = now
	return saveCounter(ctx, q, tenant)
}

func (r *Repository) Decrement(
	ctx context.Context,
	tenantID string,
	resource applicationquota.ResourceType,
	value int64,
	now time.Time,
) error {
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		if usesPlatform(resource) {
			if err := ensureCounter(ctx, q, applicationquota.ScopePlatform, applicationquota.PlatformScopeID, resource, now); err != nil {
				return err
			}
		}
		if err := ensureCounter(ctx, q, applicationquota.ScopeTenant, tenantID, resource, now); err != nil {
			return err
		}
		var platform *sqlc.ResourceUsageCounter
		if usesPlatform(resource) {
			counter, lockErr := lockCounter(ctx, q, applicationquota.ScopePlatform, applicationquota.PlatformScopeID, resource)
			if lockErr != nil {
				return lockErr
			}
			platform = &counter
		}
		tenant, err := lockCounter(ctx, q, applicationquota.ScopeTenant, tenantID, resource)
		if err != nil {
			return err
		}
		if platform != nil {
			platform.UsedValue = max(0, platform.UsedValue-value)
			platform.Revision++
			platform.UpdatedAt = now
			if err = saveCounter(ctx, q, *platform); err != nil {
				return err
			}
		}
		tenant.UsedValue = max(0, tenant.UsedValue-value)
		tenant.Revision++
		tenant.ReportDirty = true
		tenant.UpdatedAt = now
		return saveCounter(ctx, q, tenant)
	})
	if err != nil {
		return fmt.Errorf("decrement %s quota: %w", resource, err)
	}
	return nil
}

func ensureCounter(
	ctx context.Context, q *sqlc.Queries,
	scopeType string,
	scopeID string,
	resource applicationquota.ResourceType,
	now time.Time,
) error {
	return q.EnsureQuotaCounter(ctx, sqlc.EnsureQuotaCounterParams{
		ScopeType:    scopeType,
		ScopeID:      scopeID,
		ResourceType: string(resource),
		UpdatedAt:    now,
	})
}

func lockCounter(
	ctx context.Context, q *sqlc.Queries,
	scopeType string,
	scopeID string,
	resource applicationquota.ResourceType,
) (sqlc.ResourceUsageCounter, error) {
	return q.LockQuotaCounter(ctx, sqlc.LockQuotaCounterParams{ScopeType: scopeType, ScopeID: scopeID, ResourceType: string(resource)})
}

func exceeds(counter sqlc.ResourceUsageCounter, limit *int64, delta int64) bool {
	if limit == nil {
		return false
	}
	if counter.UsedValue > *limit {
		return true
	}
	remaining := *limit - counter.UsedValue
	return counter.ReservedValue > remaining || delta > remaining-counter.ReservedValue
}

func addReserved(ctx context.Context, q *sqlc.Queries, counter *sqlc.ResourceUsageCounter, value int64, now time.Time) error {
	counter.ReservedValue += value
	counter.Revision++
	counter.UpdatedAt = now
	return saveCounter(ctx, q, *counter)
}

func applyTransition(
	ctx context.Context, q *sqlc.Queries,
	counter *sqlc.ResourceUsageCounter,
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
	return saveCounter(ctx, q, *counter)
}

func reservationFromRow(row sqlc.ResourceQuotaReservation) applicationquota.Reservation {
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
	if limit <= 0 {
		return nil, nil
	}
	rows, err := r.db.Queries(ctx).ClaimDirtyQuotaReports(ctx, sqlc.ClaimDirtyQuotaReportsParams{
		Now:      now,
		Lease:    leaseUntil,
		Owner:    owner,
		PageSize: int64(limit),
	})
	if err != nil {
		return nil, err
	}
	claims := make([]applicationquota.ReportClaim, 0, len(rows))
	for _, row := range rows {
		claims = append(claims, applicationquota.ReportClaim{TenantID: row.ScopeID, Resource: applicationquota.ResourceType(row.ResourceType), Value: row.UsedValue, Revision: row.Revision, LeaseToken: owner})
	}
	return claims, nil
}

func (r *Repository) CompleteReport(
	ctx context.Context,
	claim applicationquota.ReportClaim,
	now time.Time,
) (bool, error) {
	n, err := r.db.Queries(ctx).FinishQuotaReport(ctx, sqlc.FinishQuotaReportParams{
		Now:      now,
		TenantID: claim.TenantID,
		Resource: string(claim.Resource),
		Revision: claim.Revision,
		Owner:    claim.LeaseToken,
		Value:    claim.Value,
	})
	return n == 1, err
}

func (r *Repository) ReconcileAll(ctx context.Context, now time.Time, forceReport bool) error {
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		if err := releaseExpiredReservations(ctx, q, now); err != nil {
			return err
		}
		facts, platformFacts, err := loadUsageFacts(ctx, q)
		if err != nil {
			return err
		}
		for _, resource := range []applicationquota.ResourceType{
			applicationquota.ResourceProject,
			applicationquota.ResourcePresetEntitlement,
			applicationquota.ResourceStorage,
		} {
			if err = addMissingCounterFacts(ctx, q, resource, facts[resource]); err != nil {
				return err
			}
			if usesPlatform(resource) {
				if err = reconcileCounter(
					ctx, q, applicationquota.ScopePlatform, applicationquota.PlatformScopeID,
					resource, platformFacts[resource], now, false,
				); err != nil {
					return err
				}
			}
			for tenantID, total := range facts[resource] {
				if err = reconcileCounter(
					ctx, q, applicationquota.ScopeTenant, tenantID, resource,
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
	ctx context.Context, q *sqlc.Queries,
) (map[applicationquota.ResourceType]map[string]int64, map[applicationquota.ResourceType]int64, error) {
	facts := map[applicationquota.ResourceType]map[string]int64{
		applicationquota.ResourceProject:           {},
		applicationquota.ResourcePresetEntitlement: {},
		applicationquota.ResourceStorage:           {},
	}
	platformFacts := map[applicationquota.ResourceType]int64{}

	projects, err := q.AggregateQuotaProjects(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("aggregate project quota facts: %w", err)
	}
	for _, item := range projects {
		facts[applicationquota.ResourceProject][item.TenantID] = item.Total
		platformFacts[applicationquota.ResourceProject] += item.Total
	}

	presets, err := q.AggregateQuotaPresets(ctx, string(applicationquota.ResourcePresetEntitlement))
	if err != nil {
		return nil, nil, fmt.Errorf("aggregate preset entitlement quota facts: %w", err)
	}
	for _, item := range presets {
		facts[applicationquota.ResourcePresetEntitlement][item.TenantID] = item.Total
		platformFacts[applicationquota.ResourcePresetEntitlement] += item.Total
	}

	storage, err := q.AggregateQuotaStorage(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("aggregate storage quota facts: %w", err)
	}
	for _, item := range storage {
		facts[applicationquota.ResourceStorage][item.TenantID] = item.Total
	}
	return facts, platformFacts, nil
}

func addMissingCounterFacts(
	ctx context.Context, q *sqlc.Queries,
	resource applicationquota.ResourceType,
	facts map[string]int64,
) error {
	existing, err := q.QuotaCounterTenants(ctx, string(resource))
	if err != nil {
		return err
	}
	for _, scopeID := range existing {
		if _, ok := facts[scopeID]; !ok {
			facts[scopeID] = 0
		}
	}
	return nil
}

func releaseExpiredReservations(ctx context.Context, q *sqlc.Queries, now time.Time) error {
	expired, err := q.LockExpiredQuotaReservations(ctx, now)
	if err != nil {
		return err
	}
	for _, current := range expired {
		if current.ExpiresAt.After(now) {
			continue
		}
		if current.Status == applicationquota.ReservationReacquiring {
			if current.PendingCleanupCount > 0 {
				current.Status = applicationquota.ReservationReleasing
			} else {
				if err := decrementPresetEntitlementCounters(ctx, q, &current, now); err != nil {
					return err
				}
				current.Status = applicationquota.ReservationReleased
			}
			current.StateVersion++
			current.UpdatedAt = now
			if err := saveReservation(ctx, q, current); err != nil {
				return err
			}
			continue
		}
		if current.Status != applicationquota.ReservationPending {
			continue
		}
		exists, err := reservationTargetExists(ctx, q, current)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		resource := applicationquota.ResourceType(current.ResourceType)
		var platform *sqlc.ResourceUsageCounter
		if usesPlatform(resource) {
			counter, lockErr := lockCounter(ctx, q, applicationquota.ScopePlatform, applicationquota.PlatformScopeID, resource)
			if lockErr != nil {
				return lockErr
			}
			platform = &counter
		}
		tenant, err := lockCounter(ctx, q, applicationquota.ScopeTenant, current.TenantID, resource)
		if err != nil {
			return err
		}
		if (platform != nil && platform.ReservedValue < current.ReservedValue) ||
			tenant.ReservedValue < current.ReservedValue {
			return errors.New("expired quota reservation would make reserved value negative")
		}
		if platform != nil {
			if err = applyTransition(ctx, q, platform, current.ReservedValue, false, false, now); err != nil {
				return err
			}
		}
		if err = applyTransition(ctx, q, &tenant, current.ReservedValue, false, false, now); err != nil {
			return err
		}
		current.Status = applicationquota.ReservationReleased
		current.UpdatedAt = now
		current.StateVersion++
		if err = saveReservation(ctx, q, current); err != nil {
			return err
		}
	}
	return nil
}

func reservationTargetExists(ctx context.Context, q *sqlc.Queries, reservation sqlc.ResourceQuotaReservation) (bool, error) {
	switch reservation.TargetType {
	case "project":
		return q.QuotaProjectExists(ctx, sqlc.QuotaProjectExistsParams{ID: reservation.TargetID, TenantID: reservation.TenantID})
	case "asset_review":
		return q.QuotaReviewExists(ctx, sqlc.QuotaReviewExistsParams{ID: reservation.TargetID, TenantID: reservation.TenantID})
	case "asset", "project_cover", "canvas_cover", "canvas_archive":
		return q.QuotaTargetObjectExists(ctx, sqlc.QuotaTargetObjectExistsParams{
			ID:        reservation.TargetID,
			TenantID:  reservation.TenantID,
			OwnerType: reservation.TargetType,
		})
	default:
		return true, nil
	}
}

func reconcileCounter(
	ctx context.Context, q *sqlc.Queries,
	scopeType string,
	scopeID string,
	resource applicationquota.ResourceType,
	value int64,
	now time.Time,
	forceReport bool,
) error {
	if err := ensureCounter(ctx, q, scopeType, scopeID, resource, now); err != nil {
		return err
	}
	row, err := lockCounter(ctx, q, scopeType, scopeID, resource)
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
	return saveCounter(ctx, q, row)
}

var _ applicationquota.Store = (*Repository)(nil)
var _ applicationquota.ReportingStore = (*Repository)(nil)

func saveReservation(ctx context.Context, q *sqlc.Queries, row sqlc.ResourceQuotaReservation) error {
	return q.SaveQuotaReservation(ctx, sqlc.SaveQuotaReservationParams{
		Status:              row.Status,
		StateVersion:        row.StateVersion,
		TargetType:          row.TargetType,
		TargetID:            row.TargetID,
		ExpiresAt:           row.ExpiresAt,
		UpdatedAt:           row.UpdatedAt,
		WouldReject:         row.WouldReject,
		PendingCleanupCount: row.PendingCleanupCount,
		ID:                  row.ID,
	})
}

func saveCounter(ctx context.Context, q *sqlc.Queries, row sqlc.ResourceUsageCounter) error {
	return q.SaveQuotaCounter(ctx, sqlc.SaveQuotaCounterParams{
		UsedValue:     row.UsedValue,
		ReservedValue: row.ReservedValue,
		Revision:      row.Revision,
		ReportDirty:   row.ReportDirty,
		UpdatedAt:     row.UpdatedAt,
		ScopeType:     row.ScopeType,
		ScopeID:       row.ScopeID,
		ResourceType:  row.ResourceType,
	})
}
