package admin

import (
	"context"
	"errors"
	"time"

	applicationpackage "github.com/example/monorepo/canvas/internal/application/benefitpackage"
	adminv1 "github.com/example/monorepo/inner-api-go/gen/admin/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (d *Directory) ListBenefitPackages(ctx context.Context, tenantID, workspaceID string) ([]applicationpackage.BenefitPackage, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	response, err := d.benefits.ListAvailableBenefitPackages(ctx, &adminv1.ListAvailableBenefitPackagesRequest{Actor: actor(tenantID, workspaceID)})
	if err != nil {
		return nil, err
	}
	items := make([]applicationpackage.BenefitPackage, 0, len(response.GetPackages()))
	for _, item := range response.GetPackages() {
		items = append(items, applicationpackage.BenefitPackage{ID: item.GetId(), Name: item.GetName(), IsPreset: item.GetIsPreset(), ModelIDs: item.GetModelIds()})
	}
	return items, nil
}

func (d *Directory) ReserveBenefitPackageReview(ctx context.Context, tenantID, workspaceID, packageID, reservationID, projectID, assetID string) (applicationpackage.ReviewReservation, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	response, err := d.benefits.ReserveReview(ctx, &adminv1.ReserveReviewRequest{Actor: actor(tenantID, workspaceID), PackageId: packageID, ReservationId: reservationID, ProjectId: projectID, AssetId: assetID})
	if err != nil {
		return applicationpackage.ReviewReservation{}, err
	}
	return reviewReservationFromProto(response.GetReservation())
}

func (d *Directory) TransitionBenefitPackageReview(ctx context.Context, tenantID, workspaceID, packageID, reservationID, nextStatus string) (applicationpackage.ReviewReservation, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	response, err := d.benefits.TransitionReview(ctx, &adminv1.TransitionReviewRequest{Actor: actor(tenantID, workspaceID), PackageId: packageID, ReservationId: reservationID, Status: nextStatus})
	if err != nil {
		return applicationpackage.ReviewReservation{}, err
	}
	return reviewReservationFromProto(response.GetReservation())
}

func (d *Directory) SubmitReviewedAsset(ctx context.Context, tenantID, workspaceID, packageID, referenceURL, assetType, name string) (applicationpackage.ReviewedAsset, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	response, err := d.benefits.SubmitReviewedAsset(ctx, &adminv1.SubmitReviewedAssetRequest{Actor: actor(tenantID, workspaceID), PackageId: packageID, Url: referenceURL, AssetType: assetType, Name: name})
	if err != nil {
		return applicationpackage.ReviewedAsset{}, classifyAssetSubmissionError(err)
	}
	return reviewedAssetFromProto(response.GetAsset())
}

func classifyAssetSubmissionError(err error) error {
	if status.Code(err) != codes.ResourceExhausted {
		return err
	}
	return &applicationpackage.AssetReviewProviderError{Cause: applicationpackage.ErrAssetReviewRateLimited}
}

func (d *Directory) GetReviewedAsset(ctx context.Context, tenantID, workspaceID, packageID, assetID string) (applicationpackage.ReviewedAsset, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	response, err := d.benefits.GetReviewedAsset(ctx, &adminv1.GetReviewedAssetRequest{Actor: actor(tenantID, workspaceID), PackageId: packageID, AssetId: assetID})
	if err != nil {
		return applicationpackage.ReviewedAsset{}, err
	}
	return reviewedAssetFromProto(response.GetAsset())
}

func (d *Directory) BeginBenefitPackageReviewCleanup(ctx context.Context, tenantID, workspaceID, packageID, reservationID, cleanupID string) (applicationpackage.ReviewCleanup, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	response, err := d.benefits.BeginReviewCleanup(ctx, &adminv1.BeginReviewCleanupRequest{Actor: actor(tenantID, workspaceID), PackageId: packageID, ReservationId: reservationID, CleanupId: cleanupID})
	if err != nil {
		return applicationpackage.ReviewCleanup{}, err
	}
	return reviewCleanupFromProto(response.GetCleanup())
}

func (d *Directory) CompleteBenefitPackageReviewCleanup(ctx context.Context, tenantID, workspaceID, packageID, reservationID, cleanupID string) (applicationpackage.ReviewCleanup, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	response, err := d.benefits.CompleteReviewCleanup(ctx, &adminv1.CompleteReviewCleanupRequest{Actor: actor(tenantID, workspaceID), PackageId: packageID, ReservationId: reservationID, CleanupId: cleanupID})
	if err != nil {
		return applicationpackage.ReviewCleanup{}, err
	}
	return reviewCleanupFromProto(response.GetCleanup())
}

func (d *Directory) DeleteReviewedAsset(ctx context.Context, tenantID, workspaceID, packageID, assetID string) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	_, err := d.benefits.DeleteReviewedAsset(ctx, &adminv1.DeleteReviewedAssetRequest{Actor: actor(tenantID, workspaceID), PackageId: packageID, AssetId: assetID})
	return err
}

func reviewReservationFromProto(value *adminv1.ReviewReservation) (applicationpackage.ReviewReservation, error) {
	if value == nil {
		return applicationpackage.ReviewReservation{}, errors.New("admin returned no review reservation")
	}
	return applicationpackage.ReviewReservation{ID: value.GetId(), Status: value.GetStatus()}, nil
}

func reviewedAssetFromProto(value *adminv1.ReviewedAsset) (applicationpackage.ReviewedAsset, error) {
	if value == nil {
		return applicationpackage.ReviewedAsset{}, errors.New("admin returned no reviewed asset")
	}
	return applicationpackage.ReviewedAsset{ID: value.GetId(), Status: applicationpackage.ProviderAssetStatus(value.GetStatus()), FailureReason: value.GetFailureReason()}, nil
}

func reviewCleanupFromProto(value *adminv1.ReviewCleanup) (applicationpackage.ReviewCleanup, error) {
	if value == nil {
		return applicationpackage.ReviewCleanup{}, errors.New("admin returned no review cleanup")
	}
	return applicationpackage.ReviewCleanup{CleanupID: value.GetCleanupId(), ReservationID: value.GetReservationId(), Status: value.GetStatus()}, nil
}
