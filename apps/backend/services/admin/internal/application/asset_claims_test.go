package application

import (
	"context"
	"errors"
	"testing"
	"time"
)

type assetClaimStoreStub struct {
	items       []AssetClaimDelivery
	delivered   []AssetClaimDelivery
	rescheduled []AssetClaimDelivery
}

func (store *assetClaimStoreStub) ClaimDueAssetClaims(context.Context, time.Time, time.Time, int) ([]AssetClaimDelivery, error) {
	return store.items, nil
}
func (store *assetClaimStoreStub) MarkAssetClaimDelivered(_ context.Context, item AssetClaimDelivery, _ time.Time) (bool, error) {
	store.delivered = append(store.delivered, item)
	return true, nil
}
func (store *assetClaimStoreStub) RescheduleAssetClaim(_ context.Context, item AssetClaimDelivery, _ time.Time, _ string, _ time.Time) (bool, error) {
	store.rescheduled = append(store.rescheduled, item)
	return true, nil
}

type assetClaimClientStub struct {
	calls []string
	fail  string
}

func (client *assetClaimClientStub) PrepareAssetClaim(context.Context, AssetClaimDelivery) error {
	client.calls = append(client.calls, "prepare")
	if client.fail == "prepare" {
		return errors.New("prepare failed")
	}
	return nil
}
func (client *assetClaimClientStub) ActivateAssetClaim(context.Context, AssetClaimDelivery) error {
	client.calls = append(client.calls, "activate")
	if client.fail == "activate" {
		return errors.New("activate failed")
	}
	return nil
}
func (client *assetClaimClientStub) ReleaseAssetClaim(context.Context, AssetClaimDelivery) error {
	client.calls = append(client.calls, "release")
	return nil
}

type assetClaimClock struct{ now time.Time }

func (clock assetClaimClock) Now() time.Time { return clock.now }

func TestAssetClaimRelayDeliversActiveAndReleasedIntents(t *testing.T) {
	for _, test := range []struct {
		state string
		want  []string
	}{
		{state: "active", want: []string{"prepare", "activate"}},
		{state: "released", want: []string{"release"}},
	} {
		t.Run(test.state, func(t *testing.T) {
			item := AssetClaimDelivery{AssetClaim: AssetClaim{
				OwnerType: "skill_node", OwnerID: "skill:node", Slot: "content", AssetID: "asset", RevisionID: "revision",
				Kind: "strong", DesiredState: test.state,
			}, Generation: 1, StateVersion: 2}
			store, client := &assetClaimStoreStub{items: []AssetClaimDelivery{item}}, &assetClaimClientStub{}
			delivered, err := NewAssetClaimRelay(store, client, assetClaimClock{now: time.Now().UTC()}).RunOnce(context.Background(), 10)
			if err != nil || delivered != 1 || len(store.delivered) != 1 {
				t.Fatalf("RunOnce() = %d, %v, delivered %#v", delivered, err, store.delivered)
			}
			if len(client.calls) != len(test.want) {
				t.Fatalf("calls = %#v, want %#v", client.calls, test.want)
			}
			for index := range test.want {
				if client.calls[index] != test.want[index] {
					t.Fatalf("calls = %#v, want %#v", client.calls, test.want)
				}
			}
		})
	}
}

func TestAssetClaimRelayReschedulesStorageFailure(t *testing.T) {
	item := AssetClaimDelivery{AssetClaim: AssetClaim{
		OwnerType: "skill_node", OwnerID: "skill:node", Slot: "content", AssetID: "asset", RevisionID: "revision",
		Kind: "strong", DesiredState: "active",
	}, Generation: 1, StateVersion: 2}
	store, client := &assetClaimStoreStub{items: []AssetClaimDelivery{item}}, &assetClaimClientStub{fail: "activate"}
	delivered, err := NewAssetClaimRelay(store, client, assetClaimClock{now: time.Now().UTC()}).RunOnce(context.Background(), 10)
	if err == nil || delivered != 0 || len(store.rescheduled) != 1 || len(store.delivered) != 0 {
		t.Fatalf("RunOnce() = %d, %v, delivered %#v, rescheduled %#v", delivered, err, store.delivered, store.rescheduled)
	}
}
