package rpcapi

import (
	"context"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
	adminv1 "github.com/example/monorepo/inner-api-go/gen/admin/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Server) ListAvailableBenefitPackages(ctx context.Context, request *adminv1.ListAvailableBenefitPackagesRequest) (*adminv1.ListAvailableBenefitPackagesResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	values, err := s.Benefits.Available(ctx, workspaceID, tenantID)
	if err != nil {
		return nil, rpcError(err)
	}
	packages := make([]*adminv1.BenefitPackage, 0, len(values))
	for _, value := range values {
		packages = append(packages, benefitPackage(value))
	}
	return &adminv1.ListAvailableBenefitPackagesResponse{Packages: packages}, nil
}

func (s *Server) ReserveReview(ctx context.Context, request *adminv1.ReserveReviewRequest) (*adminv1.ReserveReviewResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	value, err := s.Benefits.Reserve(ctx, workspaceID, tenantID, request.GetPackageId(), request.GetReservationId(), request.GetProjectId(), request.GetAssetId())
	if err != nil {
		return nil, rpcError(err)
	}
	return &adminv1.ReserveReviewResponse{Reservation: reviewReservation(value)}, nil
}

func (s *Server) TransitionReview(ctx context.Context, request *adminv1.TransitionReviewRequest) (*adminv1.TransitionReviewResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	value, err := s.Benefits.Transition(ctx, workspaceID, tenantID, request.GetPackageId(), request.GetReservationId(), request.GetStatus())
	if err != nil {
		return nil, rpcError(err)
	}
	return &adminv1.TransitionReviewResponse{Reservation: reviewReservation(value)}, nil
}

func (s *Server) BeginReviewCleanup(ctx context.Context, request *adminv1.BeginReviewCleanupRequest) (*adminv1.BeginReviewCleanupResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	value, err := s.Benefits.BeginCleanup(ctx, workspaceID, tenantID, request.GetPackageId(), request.GetReservationId(), request.GetCleanupId())
	if err != nil {
		return nil, rpcError(err)
	}
	return &adminv1.BeginReviewCleanupResponse{Cleanup: reviewCleanup(value)}, nil
}

func (s *Server) CompleteReviewCleanup(ctx context.Context, request *adminv1.CompleteReviewCleanupRequest) (*adminv1.CompleteReviewCleanupResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	value, err := s.Benefits.CompleteCleanup(ctx, workspaceID, tenantID, request.GetPackageId(), request.GetReservationId(), request.GetCleanupId())
	if err != nil {
		return nil, rpcError(err)
	}
	return &adminv1.CompleteReviewCleanupResponse{Cleanup: reviewCleanup(value)}, nil
}

func (s *Server) SubmitReviewedAsset(ctx context.Context, request *adminv1.SubmitReviewedAssetRequest) (*adminv1.SubmitReviewedAssetResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	value, err := s.Benefits.SubmitAsset(ctx, workspaceID, tenantID, request.GetPackageId(), request.GetUrl(), request.GetAssetType(), request.GetName())
	if err != nil {
		return nil, rpcError(err)
	}
	return &adminv1.SubmitReviewedAssetResponse{Asset: reviewedAsset(value)}, nil
}

func (s *Server) GetReviewedAsset(ctx context.Context, request *adminv1.GetReviewedAssetRequest) (*adminv1.GetReviewedAssetResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	value, err := s.Benefits.GetAsset(ctx, workspaceID, tenantID, request.GetPackageId(), request.GetAssetId())
	if err != nil {
		return nil, rpcError(err)
	}
	return &adminv1.GetReviewedAssetResponse{Asset: reviewedAsset(value)}, nil
}

func (s *Server) DeleteReviewedAsset(ctx context.Context, request *adminv1.DeleteReviewedAssetRequest) (*adminv1.DeleteReviewedAssetResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	if err = s.Benefits.DeleteAsset(ctx, workspaceID, tenantID, request.GetPackageId(), request.GetAssetId()); err != nil {
		return nil, rpcError(err)
	}
	return &adminv1.DeleteReviewedAssetResponse{}, nil
}

func benefitPackage(value domain.BenefitPackage) *adminv1.BenefitPackage {
	return &adminv1.BenefitPackage{
		Id: value.ID, IsPreset: value.IsPreset, Name: value.Name, ProjectName: value.ProjectName,
		HasAccessKeyId: value.AccessKeyIDEncrypted != "", HasSecretAccessKey: value.SecretKeyEncrypted != "",
		Enabled: value.Enabled, ModelIds: value.ModelIDs, MaterialUsed: value.MaterialUsed,
		MaterialReserved: value.MaterialReserved, MaterialLimit: value.MaterialLimit, Revision: value.Revision,
		CreatedBy: value.CreatedBy, UpdatedBy: value.UpdatedBy,
		CreatedAt: timestamppb.New(value.CreatedAt), UpdatedAt: timestamppb.New(value.UpdatedAt),
	}
}

func reviewReservation(value domain.ReviewReservation) *adminv1.ReviewReservation {
	return &adminv1.ReviewReservation{Id: value.ID, Status: value.Status}
}

func reviewCleanup(value domain.ReviewCleanup) *adminv1.ReviewCleanup {
	return &adminv1.ReviewCleanup{CleanupId: value.CleanupID, ReservationId: value.ReservationID, Status: value.Status}
}

func reviewedAsset(value application.ReviewedAsset) *adminv1.ReviewedAsset {
	return &adminv1.ReviewedAsset{Id: value.ID, Status: value.Status, FailureReason: value.FailureReason}
}
