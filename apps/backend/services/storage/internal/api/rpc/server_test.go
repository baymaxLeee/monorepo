package rpcapi

import (
	"context"
	"net"
	"testing"
	"time"

	storagev1 "github.com/example/monorepo/inner-api-go/gen/storage/v1"
	innerruntime "github.com/example/monorepo/inner-api-go/runtime"
	"github.com/example/monorepo/storage/internal/application"
	"github.com/example/monorepo/storage/internal/domain"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

type authorizationRepository struct{ application.Repository }

func (authorizationRepository) ClaimAuthorizesRevision(context.Context, application.ClaimAuthorizationInput) (bool, error) {
	return false, nil
}

func (authorizationRepository) GetRevision(context.Context, string, string) (domain.Asset, domain.Revision, string, error) {
	return domain.Asset{ID: "asset"}, domain.Revision{ID: "revision", AssetID: "asset"}, "blob", nil
}

type authorizationBlobStore struct{ application.BlobStore }

type authorizationClock struct{}

func (authorizationClock) Now() time.Time { return time.Unix(1, 0).UTC() }

func TestDescribeRevisionRequiresCallerOwnedClaim(t *testing.T) {
	service := application.NewService(authorizationRepository{}, authorizationBlobStore{}, authorizationClock{}, 1024)
	server := innerruntime.NewServer(innerruntime.ServerOptions{
		Authenticator: innerruntime.TokenAuthenticator{"canvas": "canvas-secret"},
		Authorizer:    Authorizer(),
	})
	Register(server, service, nil, nil)
	listener := bufconn.Listen(1024 * 1024)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { server.Stop() })
	connection, err := innerruntime.DialContext(context.Background(), "passthrough:///storage", innerruntime.ClientOptions{
		Caller: "canvas", Token: "canvas-secret", DefaultTimeout: time.Second,
	}, grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }))
	if err != nil {
		t.Fatalf("dial Storage: %v", err)
	}
	t.Cleanup(func() { _ = connection.Close() })

	_, err = storagev1.NewAssetServiceClient(connection).DescribeRevision(
		context.Background(), &storagev1.DescribeRevisionRequest{AssetId: "asset", RevisionId: "revision"},
	)
	if status.Code(err) != codes.NotFound {
		t.Fatalf("DescribeRevision() code = %s, want %s", status.Code(err), codes.NotFound)
	}
}

func TestAuthorizerUsesExactCallerMethodMatrix(t *testing.T) {
	authorizer := Authorizer()
	for _, caller := range []string{"admin", "canvas", "knowledge", "runtime"} {
		if !authorizer.Authorize(caller, storagev1.AssetService_DescribeRevision_FullMethodName) {
			t.Fatalf("%s was denied DescribeRevision", caller)
		}
	}
	if !authorizer.Authorize("runtime", storagev1.AssetService_AppendRevision_FullMethodName) {
		t.Fatal("runtime was denied AppendRevision")
	}
	for _, denied := range []struct{ caller, method string }{
		{"", storagev1.AssetService_DescribeRevision_FullMethodName},
		{"chat", storagev1.AssetService_DescribeRevision_FullMethodName},
		{"admin", storagev1.AssetService_AppendRevision_FullMethodName},
		{"canvas", storagev1.AssetService_ReadImageVariant_FullMethodName},
		{"runtime", "/storage.v1.OtherService/DescribeRevision"},
	} {
		if authorizer.Authorize(denied.caller, denied.method) {
			t.Fatalf("%s was allowed %s", denied.caller, denied.method)
		}
	}
}
