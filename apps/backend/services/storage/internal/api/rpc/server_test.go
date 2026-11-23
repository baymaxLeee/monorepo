package rpcapi

import (
	"context"
	"testing"
	"time"

	storagev1 "github.com/example/monorepo/inner-api-go/gen/storage/v1"
	"github.com/example/monorepo/storage/internal/application"
	"github.com/example/monorepo/storage/internal/domain"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
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
	server := &Server{service: service}
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-caller-service", "canvas"))

	_, err := server.DescribeRevision(ctx, &storagev1.DescribeRevisionRequest{AssetId: "asset", RevisionId: "revision"})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("DescribeRevision() code = %s, want %s", status.Code(err), codes.NotFound)
	}
}

func TestAuthorizerUsesConfiguredWorkloadNamespaces(t *testing.T) {
	authorizer := Authorizer([]string{"media-owner"})
	if !authorizer.Authorize("media-owner", "/storage.v1.AssetService/DescribeRevision") {
		t.Fatal("configured workload was rejected")
	}
	for _, caller := range []string{"", "Media-Owner", "media_owner", "another-service"} {
		if authorizer.Authorize(caller, "/storage.v1.AssetService/DescribeRevision") {
			t.Fatalf("unconfigured or invalid workload %q was authorized", caller)
		}
	}
	if !Authorizer(nil).Authorize("local-consumer", "/storage.v1.AssetService/DescribeRevision") {
		t.Fatal("development fallback rejected a valid workload name")
	}
}
