package coverimage

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	applicationassetclaim "github.com/example/monorepo/canvas/internal/application/assetclaim"
	applicationcoverimage "github.com/example/monorepo/canvas/internal/application/coverimage"
	"github.com/example/monorepo/canvas/internal/infrastructure/assetclient"
)

const maximumCoverImageBytes int64 = 2 << 20

type Store struct {
	assets           *assetclient.Client
	claims           applicationassetclaim.Store
	clock            interface{ Now() time.Time }
	publicGatewayURL string
}

func New(assets *assetclient.Client, claims applicationassetclaim.Store, clock interface{ Now() time.Time }, publicGatewayURL string) *Store {
	return &Store{assets: assets, claims: claims, clock: clock, publicGatewayURL: strings.TrimRight(publicGatewayURL, "/")}
}

func (s *Store) Register(ctx context.Context, input applicationcoverimage.RegisterInput) (applicationcoverimage.Registration, error) {
	if !input.Revision.Valid() || input.TenantID == "" || input.OwnerType == "" || input.OwnerID == "" {
		return applicationcoverimage.Registration{}, applicationcoverimage.ErrInvalidReference
	}
	workspace := workspaceValue(input.WorkspaceID)
	revision, err := s.assets.Describe(ctx, input.TenantID, workspace, assetclient.RevisionRef{AssetID: input.Revision.AssetID, RevisionID: input.Revision.RevisionID})
	if err != nil {
		return applicationcoverimage.Registration{}, fmt.Errorf("describe cover image revision: %w", err)
	}
	if revision.SizeBytes <= 0 || revision.SizeBytes > maximumCoverImageBytes {
		return applicationcoverimage.Registration{}, applicationcoverimage.ErrTooLarge
	}
	if revision.MediaType != "image/png" && revision.MediaType != "image/jpeg" {
		return applicationcoverimage.Registration{}, applicationcoverimage.ErrUnsupportedFormat
	}
	return applicationcoverimage.Registration{TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, Revision: applicationcoverimage.RevisionRef{AssetID: revision.AssetID, RevisionID: revision.RevisionID}, OwnerType: input.OwnerType, OwnerID: input.OwnerID, Generation: input.Generation, SHA256: revision.SHA256, ContentType: revision.MediaType, SizeBytes: revision.SizeBytes}, nil
}

func (s *Store) EnsureActive(ctx context.Context, registration applicationcoverimage.Registration) error {
	if s.claims == nil || s.clock == nil || !registration.Revision.Valid() || registration.Generation <= 0 {
		return errors.New("invalid cover image claim activation")
	}
	return s.claims.EnsureActive(ctx, coverIntent(registration, applicationassetclaim.DesiredActive), s.clock.Now())
}

func (s *Store) Release(ctx context.Context, registration applicationcoverimage.Registration) error {
	if !registration.Revision.Valid() || registration.OwnerType == "" || registration.OwnerID == "" {
		return errors.New("invalid cover image registration")
	}
	if s.claims == nil || s.clock == nil || registration.Generation <= 0 {
		return errors.New("cover image claim intent store is not configured")
	}
	return s.claims.EnsureReleased(ctx, coverIntent(registration, applicationassetclaim.DesiredReleased), s.clock.Now())
}

func coverIntent(registration applicationcoverimage.Registration, desiredState string) applicationassetclaim.Intent {
	return applicationassetclaim.Intent{
		TenantID: registration.TenantID, WorkspaceID: workspaceValue(registration.WorkspaceID), OwnerType: registration.OwnerType, OwnerID: registration.OwnerID, Slot: "cover",
		AssetID: registration.Revision.AssetID, RevisionID: registration.Revision.RevisionID, Kind: applicationassetclaim.KindStrong, Generation: registration.Generation, DesiredState: desiredState,
	}
}

func (s *Store) Presign(ctx context.Context, registrations []applicationcoverimage.Registration) (map[string]string, error) {
	inputs := make([]assetclient.DeliveryCapabilityInput, 0, len(registrations))
	for _, registration := range registrations {
		if registration.Revision.Valid() {
			inputs = append(inputs, assetclient.DeliveryCapabilityInput{TenantID: registration.TenantID, WorkspaceID: workspaceValue(registration.WorkspaceID), RevisionRef: assetclient.RevisionRef{AssetID: registration.Revision.AssetID, RevisionID: registration.Revision.RevisionID}})
		}
	}
	if len(inputs) == 0 {
		return map[string]string{}, nil
	}
	capabilities, err := s.assets.MintDeliveryCapabilities(ctx, inputs)
	if err != nil {
		return nil, fmt.Errorf("presign cover images: %w", err)
	}
	result := make(map[string]string, len(capabilities))
	for _, capability := range capabilities {
		result[capability.RevisionID] = s.absoluteURL(capability.URL)
	}
	return result, nil
}

func workspaceValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
func (s *Store) absoluteURL(value string) string {
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") || s.publicGatewayURL == "" {
		return value
	}
	if strings.HasPrefix(value, "/") {
		return s.publicGatewayURL + value
	}
	return s.publicGatewayURL + "/" + value
}
