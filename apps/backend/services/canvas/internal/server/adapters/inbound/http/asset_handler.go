package http

import (
	"context"
	"time"

	"github.com/example/monorepo/canvas/internal/platform/http/topcontext"
	applicationpackage "github.com/example/monorepo/canvas/internal/server/application/benefitpackage"
	contractasset "github.com/example/monorepo/canvas/internal/server/contracts/asset"
	contractcommon "github.com/example/monorepo/canvas/internal/server/contracts/common"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
)

type AssetHandler struct {
	reviews *applicationpackage.ReviewService
}

func NewAssetHandler(reviews *applicationpackage.ReviewService) *AssetHandler {
	return &AssetHandler{reviews: reviews}
}

func (h *AssetHandler) BatchGetAssetReviews(ctx context.Context, request *contractasset.BatchGetAssetReviewsRequest) (*contractasset.BatchGetAssetReviewsResponse, error) {
	if err := requireAction(ctx, "BatchGetAssetReviews"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	metadata, _ := topcontext.MetadataFromContext(ctx)
	items, err := h.reviews.BatchGetReviews(ctx, applicationpackage.BatchGetReviewsInput{
		ReviewScope: applicationpackage.ReviewScope{TenantID: metadata.TenantID, WorkspaceID: nullableWorkspaceID(request.WorkspaceID), CallerID: metadata.UserID},
		ProjectID:   request.ProjectID, AssetIDs: request.AssetIDs,
	})
	if err != nil {
		return nil, err
	}
	result := make([]*contractasset.AssetReviews, 0, len(items))
	for _, item := range items {
		result = append(result, &contractasset.AssetReviews{AssetID: item.AssetID, Reviews: assetReviewDTOs(item.Reviews)})
	}
	return &contractasset.BatchGetAssetReviewsResponse{Items: result}, nil
}

func (h *AssetHandler) SubmitAssetReview(ctx context.Context, request *contractasset.SubmitAssetReviewRequest) (*contractasset.SubmitAssetReviewResponse, error) {
	if err := requireAction(ctx, "SubmitAssetReview"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	metadata, _ := topcontext.MetadataFromContext(ctx)
	var upload *applicationpackage.ReviewAssetUpload
	if request.Upload != nil {
		upload = &applicationpackage.ReviewAssetUpload{
			ClientID: request.Upload.ClientID, BlobID: request.Upload.BlobID, FileName: request.Upload.FileName,
		}
	}
	result, err := h.reviews.Submit(ctx, applicationpackage.SubmitReviewInput{
		ReviewScope: applicationpackage.ReviewScope{TenantID: metadata.TenantID, WorkspaceID: nullableWorkspaceID(request.WorkspaceID), CallerID: metadata.UserID},
		ProjectID:   request.ProjectID, AssetID: request.GetAssetID(), PackageID: request.PackageID, Upload: upload,
	})
	if err != nil {
		return nil, err
	}
	return &contractasset.SubmitAssetReviewResponse{AssetID: result.AssetID, Review: assetReviewDTO(result.Review)}, nil
}

func (h *AssetHandler) BatchSubmitAssetReviews(ctx context.Context, request *contractasset.BatchSubmitAssetReviewsRequest) (*contractasset.BatchSubmitAssetReviewsResponse, error) {
	if err := requireAction(ctx, "BatchSubmitAssetReviews"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	metadata, _ := topcontext.MetadataFromContext(ctx)
	items := make([]applicationpackage.SubmitReviewItem, 0, len(request.Items))
	for _, item := range request.Items {
		if item == nil {
			items = append(items, applicationpackage.SubmitReviewItem{})
			continue
		}
		var upload *applicationpackage.ReviewAssetUpload
		if item.Upload != nil {
			upload = &applicationpackage.ReviewAssetUpload{ClientID: item.Upload.ClientID, BlobID: item.Upload.BlobID, FileName: item.Upload.FileName}
		}
		items = append(items, applicationpackage.SubmitReviewItem{AssetID: item.GetAssetID(), PackageID: item.PackageID, Upload: upload})
	}
	results, err := h.reviews.BatchSubmit(ctx, applicationpackage.BatchSubmitReviewInput{
		ReviewScope: applicationpackage.ReviewScope{TenantID: metadata.TenantID, WorkspaceID: nullableWorkspaceID(request.WorkspaceID), CallerID: metadata.UserID},
		ProjectID:   request.ProjectID, Items: items,
	})
	if err != nil {
		return nil, err
	}
	responseItems := make([]*contractasset.SubmitAssetReviewResult, 0, len(results))
	for _, result := range results {
		item := &contractasset.SubmitAssetReviewResult{
			AssetID: optionalString(result.AssetID), PackageID: result.PackageID,
			ErrorCode: optionalString(result.ErrorCode), ErrorMessage: optionalString(result.ErrorMessage),
		}
		if result.Review != nil {
			item.Review = assetReviewDTO(*result.Review)
		}
		responseItems = append(responseItems, item)
	}
	return &contractasset.BatchSubmitAssetReviewsResponse{Items: responseItems}, nil
}

func assetDTO(item domainasset.Asset) *contractasset.Asset {
	return &contractasset.Asset{
		AssetID: item.ID, OwnerType: contractasset.AssetOwnerType(item.OwnerType), OwnerID: item.OwnerID,
		FileName: item.FileName, MediaType: contractasset.AssetMediaType(item.MediaType), SizeBytes: item.SizeBytes,
		CreatedBy: item.CreatedBy, CreatedAt: timestamp(item.CreatedAt), Reviews: assetReviewDTOs(item.Reviews),
	}
}

func assetReviewDTOs(items []domainasset.Review) []*contractasset.AssetReview {
	result := make([]*contractasset.AssetReview, 0, len(items))
	for _, item := range items {
		result = append(result, assetReviewDTO(item))
	}
	return result
}

func assetReviewDTO(item domainasset.Review) *contractasset.AssetReview {
	result := &contractasset.AssetReview{
		PackageID: item.PackageID, PackageName: item.PackageName, Status: reviewStatusDTO(item.Status),
		FailureReason: optionalString(item.FailureReason), UpdatedAt: timestamp(item.UpdatedAt),
	}
	if !item.SubmittedAt.IsZero() {
		submittedAt := timestamp(item.SubmittedAt)
		result.SubmittedAt = &submittedAt
	}
	return result
}

func reviewStatusDTO(value domainasset.ReviewStatus) contractasset.AssetReviewStatus {
	switch value {
	case domainasset.ReviewStatusSubmitting:
		return contractasset.AssetReviewStatus_SUBMITTING
	case domainasset.ReviewStatusProcessing:
		return contractasset.AssetReviewStatus_PROCESSING
	case domainasset.ReviewStatusApproved:
		return contractasset.AssetReviewStatus_APPROVED
	case domainasset.ReviewStatusFailed:
		return contractasset.AssetReviewStatus_FAILED
	default:
		return 0
	}
}

func presignExpiresAt(value time.Time) *contractcommon.Timestamp {
	if value.IsZero() {
		return nil
	}
	result := contractcommon.Timestamp(timestamp(value))
	return &result
}

func previewExpiresAt(url string, value time.Time) *contractcommon.Timestamp {
	if url == "" {
		return nil
	}
	return presignExpiresAt(value)
}
