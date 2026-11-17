package admin

import (
	"context"
	"errors"
	"net"
	"testing"

	applicationpackage "github.com/example/monorepo/canvas/internal/application/benefitpackage"
	adminv1 "github.com/example/monorepo/inner-api-go/gen/admin/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

type benefitServer struct {
	adminv1.UnimplementedBenefitPackageServiceServer
	listActorTenant, listActorWorkspace string
	submitError                         error
}

func (server *benefitServer) ListAvailableBenefitPackages(_ context.Context, request *adminv1.ListAvailableBenefitPackagesRequest) (*adminv1.ListAvailableBenefitPackagesResponse, error) {
	server.listActorTenant = request.GetActor().GetTenantId()
	server.listActorWorkspace = request.GetActor().GetWorkspaceId()
	return &adminv1.ListAvailableBenefitPackagesResponse{Packages: []*adminv1.BenefitPackage{{Id: "package", Name: "Preset", IsPreset: true, ModelIds: []string{"model"}}}}, nil
}

func (server *benefitServer) SubmitReviewedAsset(context.Context, *adminv1.SubmitReviewedAssetRequest) (*adminv1.SubmitReviewedAssetResponse, error) {
	return nil, server.submitError
}

func newTestDirectory(t *testing.T, implementation adminv1.BenefitPackageServiceServer) *Directory {
	t.Helper()
	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer()
	adminv1.RegisterBenefitPackageServiceServer(server, implementation)
	go func() { _ = server.Serve(listener) }()
	connection, err := grpc.NewClient("passthrough:///bufconn", grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }))
	if err != nil {
		t.Fatalf("grpc.NewClient() error = %v", err)
	}
	t.Cleanup(func() { _ = connection.Close(); server.Stop(); _ = listener.Close() })
	return New(connection)
}

func TestListBenefitPackagesUsesGeneratedContractAndActorScope(t *testing.T) {
	t.Parallel()
	implementation := &benefitServer{}
	directory := newTestDirectory(t, implementation)
	packages, err := directory.ListBenefitPackages(context.Background(), "tenant", "workspace")
	if err != nil {
		t.Fatalf("ListBenefitPackages() error = %v", err)
	}
	if implementation.listActorTenant != "tenant" || implementation.listActorWorkspace != "workspace" {
		t.Fatalf("actor scope = %q/%q", implementation.listActorTenant, implementation.listActorWorkspace)
	}
	if len(packages) != 1 || packages[0].ID != "package" || len(packages[0].ModelIDs) != 1 {
		t.Fatalf("packages = %#v", packages)
	}
}

func TestSubmitReviewedAssetMapsResourceExhaustion(t *testing.T) {
	t.Parallel()
	directory := newTestDirectory(t, &benefitServer{submitError: status.Error(codes.ResourceExhausted, "provider throttled")})
	_, err := directory.SubmitReviewedAsset(context.Background(), "tenant", "workspace", "package", "https://example.com/a.png", "image", "a.png")
	if !errors.Is(err, applicationpackage.ErrAssetReviewRateLimited) {
		t.Fatalf("SubmitReviewedAsset() error = %v", err)
	}
}
