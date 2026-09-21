package quota

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"
)

const reservationTTL = 15 * time.Minute

type Service struct {
	modes  Modes
	limits LimitProvider
	store  Store
	clock  Clock
}

func NewService(modes Modes, limits LimitProvider, store Store, clock Clock) *Service {
	return &Service{modes: modes, limits: limits, store: store, clock: clock}
}

func (s *Service) ReserveProject(ctx context.Context, tenantID, projectID string) (Reservation, error) {
	return s.Reserve(ctx, ReserveInput{
		ID: projectID, TenantID: tenantID, Resource: ResourceProject,
		IdempotencyKey: "project:" + projectID, TargetType: "project",
		TargetID: projectID, Value: 1,
	})
}

type ReserveInput struct {
	ID             string
	TenantID       string
	Resource       ResourceType
	IdempotencyKey string
	TargetType     string
	TargetID       string
	Value          int64
}

func (s *Service) Reserve(ctx context.Context, input ReserveInput) (Reservation, error) {
	now := s.clock.Now()
	mode := s.modes.Mode(input.Resource)
	request := ReserveRequest{
		ID: input.ID, TenantID: input.TenantID, Resource: input.Resource,
		IdempotencyKey: input.IdempotencyKey, TargetType: input.TargetType,
		TargetID: input.TargetID, Value: input.Value, Enforce: mode == ModeEnforce,
		ExpiresAt: now.Add(reservationTTL), Now: now,
	}
	limit, err := s.limits.Limit(ctx, input.TenantID, input.Resource)
	if err != nil {
		if mode == ModeEnforce {
			return Reservation{}, errors.Join(ErrUnavailable, err)
		}
	} else {
		request.TenantLimit = &limit.Tenant
		request.PlatformLimit = limit.Platform
		request.LimitAvailable = true
	}
	reservation, err := s.store.Reserve(ctx, request)
	if errors.Is(err, ErrExceeded) {
		return Reservation{}, ErrExceeded
	}
	return reservation, err
}

func (s *Service) CommitProject(ctx context.Context, reservation Reservation) error {
	return s.store.Commit(ctx, reservation, s.clock.Now())
}

func (s *Service) ReleaseProject(ctx context.Context, reservation Reservation) error {
	return s.store.Release(ctx, reservation, s.clock.Now())
}

func (s *Service) DeleteProject(ctx context.Context, tenantID string) error {
	return s.store.Decrement(ctx, tenantID, ResourceProject, 1, s.clock.Now())
}

func (s *Service) ReserveStorage(
	ctx context.Context,
	tenantID string,
	objectType string,
	objectKey string,
	targetType string,
	targetID string,
	sizeBytes int64,
) (Reservation, error) {
	idempotencyKey := StorageIdempotencyKey(objectType, objectKey)
	return s.Reserve(ctx, ReserveInput{
		ID: StorageReservationID(objectType, objectKey), TenantID: tenantID,
		Resource: ResourceStorage, IdempotencyKey: idempotencyKey,
		TargetType: targetType, TargetID: targetID, Value: sizeBytes,
	})
}

func StorageIdempotencyKey(objectType, objectKey string) string {
	return "storage:" + objectType + ":" + objectKey
}

func StorageReservationID(objectType, objectKey string) string {
	// Storage object keys can be longer than the reservation primary key. Hash the
	// complete canonical identity so retries remain stable without truncation collisions.
	digest := sha256.Sum256([]byte(StorageIdempotencyKey(objectType, objectKey)))
	return hex.EncodeToString(digest[:])
}

func (s *Service) CommitStorage(
	ctx context.Context,
	reservation Reservation,
	object StorageObject,
) error {
	return s.store.CommitStorage(ctx, reservation, object, s.clock.Now())
}

func (s *Service) RecordStorage(ctx context.Context, object StorageObject) error {
	return s.store.RecordStorage(ctx, object, s.clock.Now())
}

// CheckStorageAdmission is intentionally a point-in-time check rather than a
// reservation. Accepted asynchronous work may exceed the limit when its final
// size becomes known; subsequent work is then rejected until usage drops.
func (s *Service) CheckStorageAdmission(ctx context.Context, tenantID string) error {
	if s.modes.Mode(ResourceStorage) != ModeEnforce {
		return nil
	}
	limit, err := s.limits.Limit(ctx, tenantID, ResourceStorage)
	if err != nil {
		return errors.Join(ErrUnavailable, err)
	}
	usage, err := s.store.Usage(ctx, tenantID, ResourceStorage)
	if err != nil {
		return errors.Join(ErrUnavailable, err)
	}
	// Subtract only after the used-value comparison: conservative accounting
	// can saturate at MaxInt64 and must not wrap into an apparent free balance.
	if usage.Used >= limit.Tenant || usage.Reserved >= limit.Tenant-usage.Used {
		return ErrExceeded
	}
	return nil
}

// RecordAdmittedStorage accounts for an owned asynchronous result after its
// size is known. Admission happened before execution, so this operation must
// not reject a completed result merely because concurrent work crossed the limit.
func (s *Service) RecordAdmittedStorage(ctx context.Context, object StorageObject) error {
	return s.store.RecordAdmittedStorage(ctx, object, s.clock.Now())
}

func (s *Service) ReleaseStorage(
	ctx context.Context,
	objectType string,
	objectKey string,
) (bool, error) {
	return s.store.ReleaseStorage(ctx, objectType, objectKey, s.clock.Now())
}

func (s *Service) MarkStorageReleasing(
	ctx context.Context,
	objectType string,
	objectKey string,
) (bool, error) {
	return s.store.MarkStorageReleasing(ctx, objectType, objectKey, s.clock.Now())
}

func (s *Service) ReservePresetEntitlement(
	ctx context.Context,
	tenantID string,
	reviewID string,
	packageID string,
	assetID string,
) (Reservation, error) {
	return s.Reserve(ctx, ReserveInput{
		ID: "preset-review:" + reviewID, TenantID: tenantID,
		Resource:       ResourcePresetEntitlement,
		IdempotencyKey: "preset:" + tenantID + ":" + packageID + ":" + assetID,
		TargetType:     "asset_review", TargetID: reviewID, Value: 1,
	})
}

func (s *Service) CommitReservation(ctx context.Context, reservation Reservation) error {
	return s.store.Commit(ctx, reservation, s.clock.Now())
}

func (s *Service) ReleaseReservation(ctx context.Context, reservation Reservation) error {
	return s.store.Release(ctx, reservation, s.clock.Now())
}

func (s *Service) BeginPresetEntitlementRelease(ctx context.Context, reservationID string) error {
	return s.store.BeginPresetEntitlementRelease(ctx, reservationID, s.clock.Now())
}

func (s *Service) CompletePresetEntitlementCleanup(ctx context.Context, reservationID string) (bool, error) {
	return s.store.CompletePresetEntitlementCleanup(ctx, reservationID, s.clock.Now())
}
