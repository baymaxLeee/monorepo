package asset

import (
	"context"
	"testing"
	"time"

	applicationassetclaim "github.com/example/monorepo/canvas/internal/application/assetclaim"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
)

func TestPersistPreparedCreatesUsesCanvasAttachmentQuotaIdentity(t *testing.T) {
	t.Parallel()

	repository := &persistRepositoryStub{}
	quota := &storageQuotaStub{}
	transactions := transactionStub{}
	claims := &claimIntentStub{}
	now := time.Date(2026, time.September, 24, 9, 0, 0, 0, time.UTC)
	service := NewService(
		repository,
		ownerResolverStub{},
		nil,
		nil,
		clockStub{now: now},
		WithStorageQuota(quota, transactions),
		WithClaimIntents(claims, transactions),
	)

	item := domainasset.Asset{
		ID: "canvas-attachment", TenantID: "tenant", OwnerType: domainasset.OwnerResource,
		OwnerID: "resource", SourceAssetID: "platform-asset", SourceRevisionID: "revision",
		FileName: "image.png", MediaType: domainasset.MediaImage, ContentType: "image/png",
		SizeBytes: 128, BillingClass: domainasset.BillingBillable, CreatedBy: "user", CreatedAt: now,
	}
	if err := service.PersistPreparedCreates(context.Background(), []domainasset.Asset{item}); err != nil {
		t.Fatalf("PersistPreparedCreates() error = %v", err)
	}

	if quota.objectType != "canvas_asset" || quota.objectKey != item.ID {
		t.Fatalf("reserved storage identity = %q/%q", quota.objectType, quota.objectKey)
	}
	if quota.committed.ObjectType != quota.objectType || quota.committed.ObjectKey != quota.objectKey {
		t.Fatalf("committed storage identity = %q/%q", quota.committed.ObjectType, quota.committed.ObjectKey)
	}
	if len(repository.created) != 1 || repository.created[0].ID != item.ID {
		t.Fatalf("created assets = %#v", repository.created)
	}
	if claims.active.OwnerID != item.ID || claims.active.AssetID != item.SourceAssetID {
		t.Fatalf("active claim = %#v", claims.active)
	}
}

type persistRepositoryStub struct {
	Repository
	created []domainasset.Asset
}

func (stub *persistRepositoryStub) Create(_ context.Context, item domainasset.Asset) error {
	stub.created = append(stub.created, item)
	return nil
}

type ownerResolverStub struct{ OwnerResolver }

func (ownerResolverStub) ValidateForUpdate(context.Context, Scope, domainasset.OwnerType, string) error {
	return nil
}

type storageQuotaStub struct {
	StorageQuota
	objectType string
	objectKey  string
	committed  applicationquota.StorageObject
}

func (stub *storageQuotaStub) ReserveStorage(
	_ context.Context,
	tenantID, objectType, objectKey, _, _ string,
	sizeBytes int64,
) (applicationquota.Reservation, error) {
	stub.objectType, stub.objectKey = objectType, objectKey
	return applicationquota.Reservation{
		ID: "reservation", TenantID: tenantID, Resource: applicationquota.ResourceStorage, Value: sizeBytes,
	}, nil
}

func (stub *storageQuotaStub) CommitStorage(
	_ context.Context,
	_ applicationquota.Reservation,
	object applicationquota.StorageObject,
) error {
	stub.committed = object
	return nil
}

type transactionStub struct{}

func (transactionStub) WithinTransaction(ctx context.Context, operation func(context.Context) error) error {
	return operation(ctx)
}

type claimIntentStub struct {
	ClaimIntentStore
	active applicationassetclaim.Intent
}

func (stub *claimIntentStub) EnsureActive(_ context.Context, intent applicationassetclaim.Intent, _ time.Time) error {
	stub.active = intent
	return nil
}

type clockStub struct{ now time.Time }

func (stub clockStub) Now() time.Time { return stub.now }
