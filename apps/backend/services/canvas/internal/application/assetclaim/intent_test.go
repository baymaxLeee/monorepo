package assetclaim

import (
	"context"
	"errors"
	"testing"
	"time"
)

type relayStoreStub struct {
	items       []Intent
	delivered   []Intent
	rescheduled []Intent
}

func (*relayStoreStub) EnsureActive(context.Context, Intent, time.Time) error   { return nil }
func (*relayStoreStub) EnsureReleased(context.Context, Intent, time.Time) error { return nil }
func (store *relayStoreStub) ClaimDue(context.Context, time.Time, time.Time, int) ([]Intent, error) {
	return store.items, nil
}
func (store *relayStoreStub) MarkDelivered(_ context.Context, intent Intent, _ time.Time) (bool, error) {
	store.delivered = append(store.delivered, intent)
	return true, nil
}
func (store *relayStoreStub) Reschedule(_ context.Context, intent Intent, _ time.Time, _ string, _ time.Time) (bool, error) {
	store.rescheduled = append(store.rescheduled, intent)
	return true, nil
}

type relayClientStub struct {
	calls []string
	fail  string
}

func (client *relayClientStub) PrepareAssetClaim(context.Context, Intent) error {
	client.calls = append(client.calls, "prepare")
	if client.fail == "prepare" {
		return errors.New("prepare failed")
	}
	return nil
}
func (client *relayClientStub) ActivateAssetClaim(context.Context, Intent) error {
	client.calls = append(client.calls, "activate")
	if client.fail == "activate" {
		return errors.New("activate failed")
	}
	return nil
}
func (client *relayClientStub) ReleaseAssetClaimIntent(context.Context, Intent) error {
	client.calls = append(client.calls, "release")
	if client.fail == "release" {
		return errors.New("release failed")
	}
	return nil
}

type relayClock struct{ now time.Time }

func (clock relayClock) Now() time.Time { return clock.now }

func TestRelayActiveAndReleasedDelivery(t *testing.T) {
	for _, test := range []struct {
		name, state string
		want        []string
	}{
		{name: "active", state: DesiredActive, want: []string{"prepare", "activate"}},
		{name: "released before active delivery", state: DesiredReleased, want: []string{"prepare", "release"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			now := time.Now().UTC()
			intent := Intent{TenantID: "tenant", OwnerType: "canvas_asset", OwnerID: "owner", Slot: "source", AssetID: "asset", RevisionID: "revision", Kind: KindStrong, DesiredState: test.state, Generation: 1, StateVersion: 2}
			store, client := &relayStoreStub{items: []Intent{intent}}, &relayClientStub{}
			delivered, err := NewRelay(store, client, relayClock{now: now}).RunOnce(context.Background(), 10)
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

func TestRelayReschedulesFailedDelivery(t *testing.T) {
	now := time.Now().UTC()
	intent := Intent{TenantID: "tenant", OwnerType: "canvas_asset", OwnerID: "owner", Slot: "source", AssetID: "asset", RevisionID: "revision", Kind: KindStrong, DesiredState: DesiredActive, Generation: 1, StateVersion: 2}
	store, client := &relayStoreStub{items: []Intent{intent}}, &relayClientStub{fail: "activate"}
	delivered, err := NewRelay(store, client, relayClock{now: now}).RunOnce(context.Background(), 10)
	if delivered != 0 || err == nil || len(store.rescheduled) != 1 || len(store.delivered) != 0 {
		t.Fatalf("RunOnce() = %d, %v; store = %#v", delivered, err, store)
	}
}
