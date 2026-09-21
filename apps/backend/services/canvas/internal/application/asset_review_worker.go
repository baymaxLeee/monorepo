package application

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
)

const assetReviewPollInterval = 10 * time.Second

func (s *Service) RunAssetReviews(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		if err := s.processAssetReviews(ctx); err != nil && ctx.Err() == nil {
			slog.Error("canvas asset review round failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) processAssetReviews(ctx context.Context) error {
	now := time.Now().UTC()
	var rows []p.AssetReview
	if err := s.DB.WithContext(ctx).
		Where("status = ? OR (status = ? AND updated_at <= ?)", "SUBMITTING", "PROCESSING", now.Add(-assetReviewPollInterval)).
		Order("created_at, id").Limit(20).Find(&rows).Error; err != nil {
		return err
	}
	for i := range rows {
		var err error
		if rows[i].Status == "SUBMITTING" {
			err = s.submitAssetReview(ctx, rows[i], now)
		} else {
			err = s.pollAssetReview(ctx, rows[i], now)
		}
		if err != nil {
			slog.Error("canvas asset review item failed", "review_id", rows[i].ID, "error", err)
		}
	}
	return nil
}

func (s *Service) submitAssetReview(ctx context.Context, review p.AssetReview, now time.Time) error {
	if review.SubmissionStartedAt != nil {
		return s.failAssetReview(ctx, review, "素材提交结果不确定，请重新送审", true, now)
	}
	claimed := s.DB.WithContext(ctx).Model(&p.AssetReview{}).
		Where("id = ? AND status = ? AND submission_started_at IS NULL", review.ID, "SUBMITTING").
		Updates(map[string]any{"submission_started_at": now, "updated_at": now})
	if claimed.Error != nil || claimed.RowsAffected == 0 {
		return claimed.Error
	}
	var asset p.Asset
	if err := s.DB.WithContext(ctx).Where("id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ?", review.AssetID, review.TenantID, review.WorkspaceID, review.ProjectID).First(&asset).Error; err != nil {
		return s.failAssetReview(ctx, review, "送审素材不存在", true, now)
	}
	var slot p.ResourceAsset
	if err := s.DB.WithContext(ctx).Where("id = ?", review.ResourceAssetID).First(&slot).Error; err != nil {
		return s.failAssetReview(ctx, review, "送审素材不存在", true, now)
	}
	assetType := reviewAssetType(asset.MimeType)
	if assetType == "" {
		return s.failAssetReview(ctx, review, "送审素材类型不受支持", true, now)
	}
	directory, err := s.benefitPackages()
	if err != nil {
		return s.failAssetReview(ctx, review, "权益包服务不可用", true, now)
	}
	referenceURL := s.Storage.PublicURL(
		s.PublicGatewayURL,
		storage.Scope(review.TenantID, review.WorkspaceID, review.ProjectID),
		asset.ObjectKey,
		now.Add(30*time.Minute),
	)
	providerAsset, err := directory.SubmitReviewedAsset(ctx, review.TenantID, review.WorkspaceID, review.BenefitPackageID, referenceURL, assetType, slot.Name)
	if err != nil || providerAsset.ID == "" {
		return s.failAssetReview(ctx, review, "素材提交审核失败", true, now)
	}
	updated := s.DB.WithContext(ctx).Model(&p.AssetReview{}).
		Where("id = ? AND status = ?", review.ID, "SUBMITTING").
		Updates(map[string]any{"provider_asset_id": providerAsset.ID, "status": "PROCESSING", "submitted_at": now, "updated_at": now})
	if updated.Error != nil || updated.RowsAffected == 0 {
		return updated.Error
	}
	review.ProviderAssetID = providerAsset.ID
	review.Status = "PROCESSING"
	return s.commitReviewReservation(ctx, review)
}

func (s *Service) pollAssetReview(ctx context.Context, review p.AssetReview, now time.Time) error {
	if err := s.commitReviewReservation(ctx, review); err != nil {
		return err
	}
	directory, err := s.benefitPackages()
	if err != nil {
		return err
	}
	providerAsset, err := directory.GetReviewedAsset(ctx, review.TenantID, review.WorkspaceID, review.BenefitPackageID, review.ProviderAssetID)
	if err != nil {
		return s.DB.WithContext(ctx).Model(&p.AssetReview{}).Where("id = ? AND status = ?", review.ID, "PROCESSING").Update("updated_at", now).Error
	}
	switch strings.ToLower(providerAsset.Status) {
	case "active", "approved", "succeeded":
		return s.finishAssetReview(ctx, review.ID, "APPROVED", "", now)
	case "failed", "rejected", "inactive":
		reason := providerAsset.FailureReason
		if reason == "" {
			reason = "素材审核未通过"
		}
		return s.finishAssetReview(ctx, review.ID, "FAILED", reason, now)
	default:
		return s.DB.WithContext(ctx).Model(&p.AssetReview{}).Where("id = ? AND status = ?", review.ID, "PROCESSING").Update("updated_at", now).Error
	}
}

func (s *Service) commitReviewReservation(ctx context.Context, review p.AssetReview) error {
	directory, err := s.benefitPackages()
	if err != nil {
		return err
	}
	_, err = directory.TransitionBenefitPackageReview(ctx, review.TenantID, review.WorkspaceID, review.BenefitPackageID, review.ReservationID, "committed")
	return err
}

func (s *Service) failAssetReview(ctx context.Context, review p.AssetReview, reason string, release bool, now time.Time) error {
	if release {
		if directory, err := s.benefitPackages(); err == nil {
			if _, err = directory.TransitionBenefitPackageReview(ctx, review.TenantID, review.WorkspaceID, review.BenefitPackageID, review.ReservationID, "released"); err != nil {
				return err
			}
		}
	}
	return s.finishAssetReview(ctx, review.ID, "FAILED", reason, now)
}

func (s *Service) finishAssetReview(ctx context.Context, id, status, reason string, now time.Time) error {
	if len(reason) > 512 {
		reason = reason[:512]
	}
	updated := s.DB.WithContext(ctx).Model(&p.AssetReview{}).
		Where("id = ? AND status IN ?", id, []string{"SUBMITTING", "PROCESSING"}).
		Updates(map[string]any{"status": status, "failure_reason": reason, "updated_at": now})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected == 0 {
		return fmt.Errorf("asset review %s state changed", id)
	}
	return nil
}

func reviewAssetType(mime string) string {
	switch {
	case strings.HasPrefix(mime, "image/"):
		return "Image"
	case strings.HasPrefix(mime, "video/"):
		return "Video"
	case strings.HasPrefix(mime, "audio/"):
		return "Audio"
	default:
		return ""
	}
}
