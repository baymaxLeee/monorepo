package application

import (
	"context"
	"errors"
	"strings"
	"time"
)

type AssetClaimDelivery struct {
	AssetClaim
	Generation   int64
	StateVersion int64
	AttemptCount int32
}

type AssetClaimIntentStore interface {
	ClaimDueAssetClaims(context.Context, time.Time, time.Time, int) ([]AssetClaimDelivery, error)
	MarkAssetClaimDelivered(context.Context, AssetClaimDelivery, time.Time) (bool, error)
	RescheduleAssetClaim(context.Context, AssetClaimDelivery, time.Time, string, time.Time) (bool, error)
}

type AssetClaimClient interface {
	PrepareAssetClaim(context.Context, AssetClaimDelivery) error
	ActivateAssetClaim(context.Context, AssetClaimDelivery) error
	ReleaseAssetClaim(context.Context, AssetClaimDelivery) error
}

type AssetClaimRelay struct {
	store  AssetClaimIntentStore
	client AssetClaimClient
	clock  interface{ Now() time.Time }
}

func NewAssetClaimRelay(store AssetClaimIntentStore, client AssetClaimClient, clock interface{ Now() time.Time }) *AssetClaimRelay {
	return &AssetClaimRelay{store: store, client: client, clock: clock}
}

func (relay *AssetClaimRelay) RunOnce(ctx context.Context, limit int) (int, error) {
	if relay == nil || relay.store == nil || relay.client == nil || relay.clock == nil || limit <= 0 {
		return 0, errors.New("asset claim relay is not configured")
	}
	now := relay.clock.Now()
	items, err := relay.store.ClaimDueAssetClaims(ctx, now, now.Add(30*time.Second), limit)
	if err != nil {
		return 0, err
	}
	delivered := 0
	var failures error
	for _, item := range items {
		deliveryErr := relay.deliver(ctx, item)
		completedAt := relay.clock.Now()
		if deliveryErr == nil {
			ok, markErr := relay.store.MarkAssetClaimDelivered(ctx, item, completedAt)
			if markErr != nil {
				failures = errors.Join(failures, markErr)
			} else if ok {
				delivered++
			}
			continue
		}
		next := completedAt.Add(assetClaimRetryDelay(item.AttemptCount + 1))
		_, retryErr := relay.store.RescheduleAssetClaim(ctx, item, next, deliveryErr.Error(), completedAt)
		failures = errors.Join(failures, deliveryErr, retryErr)
	}
	return delivered, failures
}

func (relay *AssetClaimRelay) deliver(ctx context.Context, item AssetClaimDelivery) error {
	if item.OwnerType == "" || item.OwnerID == "" || item.Slot == "" || item.Generation <= 0 {
		return errors.New("invalid asset claim identity")
	}
	if item.DesiredState == "released" {
		return relay.client.ReleaseAssetClaim(ctx, item)
	}
	if item.DesiredState != "active" || strings.TrimSpace(item.AssetID) == "" || strings.TrimSpace(item.RevisionID) == "" {
		return errors.New("invalid active asset claim")
	}
	if err := relay.client.PrepareAssetClaim(ctx, item); err != nil {
		return err
	}
	return relay.client.ActivateAssetClaim(ctx, item)
}

func assetClaimRetryDelay(attempt int32) time.Duration {
	delay := time.Second
	for current := int32(1); current < attempt && delay < 5*time.Minute; current++ {
		delay *= 2
	}
	if delay > 5*time.Minute {
		return 5 * time.Minute
	}
	return delay
}
