package coverimage

import (
	"context"
	"net"
	"testing"
	"time"

	applicationassetclaim "github.com/example/monorepo/canvas/internal/application/assetclaim"
	applicationcoverimage "github.com/example/monorepo/canvas/internal/application/coverimage"
	"github.com/example/monorepo/canvas/internal/infrastructure/storageclient"
	storagev1 "github.com/example/monorepo/inner-api-go/gen/storage/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type storageServer struct {
	storagev1.UnimplementedAssetServiceServer
	storagev1.UnimplementedDeliveryServiceServer
	describes int
}

func (server *storageServer) DescribeRevision(_ context.Context, request *storagev1.DescribeRevisionRequest) (*storagev1.DescribeRevisionResponse, error) {
	server.describes++
	return &storagev1.DescribeRevisionResponse{Revision: &storagev1.RevisionMetadata{AssetId: request.GetAssetId(), RevisionId: request.GetRevisionId(), Filename: "cover.png", MediaType: "image/png", SizeBytes: 512, Sha256: "digest"}}, nil
}

func (server *storageServer) MintCapabilities(_ context.Context, request *storagev1.MintCapabilitiesRequest) (*storagev1.MintCapabilitiesResponse, error) {
	items := make([]*storagev1.DeliveryCapability, 0, len(request.GetItems()))
	for _, item := range request.GetItems() {
		items = append(items, &storagev1.DeliveryCapability{AssetId: item.GetAssetId(), RevisionId: item.GetRevisionId(), Url: "/api/storage-server/media/" + item.GetAssetId() + "/revisions/" + item.GetRevisionId() + "/content", ExpiresAt: timestamppb.New(time.Now().Add(time.Hour).UTC())})
	}
	return &storagev1.MintCapabilitiesResponse{Items: items}, nil
}

func newStorageClient(t *testing.T) (*storageclient.Client, *storageServer) {
	t.Helper()
	listener := bufconn.Listen(1 << 20)
	grpcServer := grpc.NewServer()
	implementation := &storageServer{}
	storagev1.RegisterAssetServiceServer(grpcServer, implementation)
	storagev1.RegisterDeliveryServiceServer(grpcServer, implementation)
	go func() { _ = grpcServer.Serve(listener) }()
	connection, err := grpc.NewClient("passthrough:///bufconn", grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close(); grpcServer.Stop(); _ = listener.Close() })
	return storageclient.New(connection), implementation
}

type claimStoreStub struct{ active, released applicationassetclaim.Intent }

func (stub *claimStoreStub) EnsureActive(_ context.Context, intent applicationassetclaim.Intent, _ time.Time) error {
	stub.active = intent
	return nil
}
func (stub *claimStoreStub) EnsureReleased(_ context.Context, intent applicationassetclaim.Intent, _ time.Time) error {
	stub.released = intent
	return nil
}
func (*claimStoreStub) ClaimDue(context.Context, time.Time, time.Time, int) ([]applicationassetclaim.Intent, error) {
	return nil, nil
}
func (*claimStoreStub) MarkDelivered(context.Context, applicationassetclaim.Intent, time.Time) (bool, error) {
	return false, nil
}
func (*claimStoreStub) Reschedule(context.Context, applicationassetclaim.Intent, time.Time, string, time.Time) (bool, error) {
	return false, nil
}

type clockStub struct{ now time.Time }

func (clock clockStub) Now() time.Time { return clock.now }

const (
	coverAssetID    = "019d0000-0000-7000-8000-000000000001"
	coverRevisionID = "019d0000-0000-7000-8000-000000000002"
)

func TestStoreRegisterAndEnqueueStrongClaim(t *testing.T) {
	t.Parallel()
	storage, implementation := newStorageClient(t)
	claims := &claimStoreStub{}
	store := New(storage, claims, clockStub{now: time.Now().UTC()}, "")
	registration, err := store.Register(context.Background(), applicationcoverimage.RegisterInput{TenantID: "tenant", UserID: "user", OwnerType: "canvas_cover", OwnerID: "canvas", Generation: 7, Revision: applicationcoverimage.RevisionRef{AssetID: coverAssetID, RevisionID: coverRevisionID}})
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if registration.Revision.AssetID != coverAssetID || registration.Revision.RevisionID != coverRevisionID || registration.Generation != 7 {
		t.Fatalf("Register() = %#v", registration)
	}
	if implementation.describes != 1 {
		t.Fatalf("describe calls = %d", implementation.describes)
	}
	if err = store.EnsureActive(context.Background(), registration); err != nil {
		t.Fatalf("EnsureActive() error = %v", err)
	}
	if claims.active.AssetID != coverAssetID || claims.active.RevisionID != coverRevisionID || claims.active.Generation != 7 {
		t.Fatalf("claim = %#v", claims.active)
	}
}

func TestStorePresignReturnsGatewayURL(t *testing.T) {
	t.Parallel()
	storage, _ := newStorageClient(t)
	store := New(storage, &claimStoreStub{}, clockStub{now: time.Now().UTC()}, "http://gateway")
	urls, err := store.Presign(context.Background(), []applicationcoverimage.Registration{{TenantID: "tenant", Revision: applicationcoverimage.RevisionRef{AssetID: coverAssetID, RevisionID: coverRevisionID}}})
	if err != nil {
		t.Fatalf("Presign() error = %v", err)
	}
	ref := applicationcoverimage.RevisionRef{AssetID: coverAssetID, RevisionID: coverRevisionID}
	if urls[ref] != "http://gateway/api/storage-server/media/"+coverAssetID+"/revisions/"+coverRevisionID+"/content" {
		t.Fatalf("URL = %q", urls[ref])
	}
}
