package assetclaim

import (
	"context"
	"errors"
	"strings"
	"time"
)

const (
	DesiredActive   = "active"
	DesiredReleased = "released"
	KindStrong      = "strong"
)

var ErrConflict = errors.New("asset claim intent conflicts with a newer desired state")

type Intent struct {
	TenantID, WorkspaceID     string
	OwnerType, OwnerID, Slot  string
	AssetID, RevisionID, Kind string
	DesiredState              string
	Generation                int64
	ExpiresAt, DeliveredAt    *time.Time
	NextAttemptAt, CreatedAt  time.Time
	UpdatedAt                 time.Time
	LeaseUntil                *time.Time
	StateVersion              int64
	Attempts                  int32
	LastError                 string
}

func (intent Intent) validIdentity() bool {
	return strings.TrimSpace(intent.TenantID) != "" && strings.TrimSpace(intent.OwnerType) != "" &&
		strings.TrimSpace(intent.OwnerID) != "" && strings.TrimSpace(intent.Slot) != "" && intent.Generation > 0
}

func (intent Intent) Valid() bool {
	if !intent.validIdentity() || (intent.DesiredState != DesiredActive && intent.DesiredState != DesiredReleased) {
		return false
	}
	if intent.DesiredState == DesiredReleased {
		return true
	}
	return strings.TrimSpace(intent.AssetID) != "" && strings.TrimSpace(intent.RevisionID) != "" && intent.Kind == KindStrong
}

type Store interface {
	EnsureActive(context.Context, Intent, time.Time) error
	EnsureReleased(context.Context, Intent, time.Time) error
	ClaimDue(context.Context, time.Time, time.Time, int) ([]Intent, error)
	MarkDelivered(context.Context, Intent, time.Time) (bool, error)
	Reschedule(context.Context, Intent, time.Time, string, time.Time) (bool, error)
}

type Client interface {
	PrepareAssetClaim(context.Context, Intent) error
	ActivateAssetClaim(context.Context, Intent) error
	ReleaseAssetClaimIntent(context.Context, Intent) error
}

type Relay struct {
	store  Store
	client Client
	clock  interface{ Now() time.Time }
}

func NewRelay(store Store, client Client, clock interface{ Now() time.Time }) *Relay {
	return &Relay{store: store, client: client, clock: clock}
}

func (relay *Relay) RunOnce(ctx context.Context, limit int) (int, error) {
	if relay == nil || relay.store == nil || relay.client == nil || relay.clock == nil || limit <= 0 {
		return 0, errors.New("asset claim relay is not configured")
	}
	now := relay.clock.Now()
	items, err := relay.store.ClaimDue(ctx, now, now.Add(30*time.Second), limit)
	if err != nil {
		return 0, err
	}
	delivered := 0
	var failures error
	for _, item := range items {
		deliveryErr := relay.deliver(ctx, item)
		completedAt := relay.clock.Now()
		if deliveryErr == nil {
			ok, markErr := relay.store.MarkDelivered(ctx, item, completedAt)
			if markErr != nil {
				failures = errors.Join(failures, markErr)
			} else if ok {
				delivered++
			}
			continue
		}
		next := completedAt.Add(retryDelay(item.Attempts + 1))
		_, retryErr := relay.store.Reschedule(ctx, item, next, deliveryErr.Error(), completedAt)
		failures = errors.Join(failures, deliveryErr, retryErr)
	}
	return delivered, failures
}

func (relay *Relay) deliver(ctx context.Context, intent Intent) error {
	if intent.DesiredState == DesiredReleased {
		// A local aggregate can be created and deleted before its active intent is
		// ever delivered. Preparing the exact generation first makes release
		// convergent for both that case and an already-active remote Claim.
		if err := relay.client.PrepareAssetClaim(ctx, intent); err != nil {
			return err
		}
		return relay.client.ReleaseAssetClaimIntent(ctx, intent)
	}
	if err := relay.client.PrepareAssetClaim(ctx, intent); err != nil {
		return err
	}
	return relay.client.ActivateAssetClaim(ctx, intent)
}

func retryDelay(attempt int32) time.Duration {
	delay := time.Second
	for current := int32(1); current < attempt && delay < 5*time.Minute; current++ {
		delay *= 2
	}
	if delay > 5*time.Minute {
		return 5 * time.Minute
	}
	return delay
}
