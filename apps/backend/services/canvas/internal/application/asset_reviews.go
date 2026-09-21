package application

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	adminclient "github.com/example/monorepo/canvas/internal/infrastructure/admin"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"gorm.io/gorm"
)

type benefitPackageDirectory interface {
	ListBenefitPackages(context.Context, string, string) ([]adminclient.BenefitPackage, error)
	ReserveBenefitPackageReview(context.Context, string, string, string, string, string, string) (adminclient.ReviewReservation, error)
	TransitionBenefitPackageReview(context.Context, string, string, string, string, string) (adminclient.ReviewReservation, error)
	SubmitReviewedAsset(context.Context, string, string, string, string, string, string) (adminclient.ReviewedAsset, error)
	GetReviewedAsset(context.Context, string, string, string, string) (adminclient.ReviewedAsset, error)
}

func (s *Service) benefitPackages() (benefitPackageDirectory, error) {
	directory, ok := s.ProviderDirectory.(benefitPackageDirectory)
	if !ok {
		return nil, &Error{Status: 503, Code: "benefit_package_unavailable", Message: "权益包服务不可用"}
	}
	return directory, nil
}

func (s *Service) ListAvailableBenefitPackages(ctx context.Context, actor Actor, projectID string) (c.BenefitPackageChoiceList, error) {
	if _, err := access(s.DB.WithContext(ctx), actor, projectID, false); err != nil {
		return c.BenefitPackageChoiceList{}, err
	}
	directory, err := s.benefitPackages()
	if err != nil {
		return c.BenefitPackageChoiceList{}, err
	}
	packages, err := directory.ListBenefitPackages(ctx, actor.TenantID, actor.WorkspaceID)
	if err != nil {
		return c.BenefitPackageChoiceList{}, benefitPackageError(err)
	}
	var providerIDs []string
	if err := s.DB.WithContext(ctx).Model(&projectModelGrant{}).Where(
		"project_id = ? AND tenant_id = ? AND workspace_id = ?", projectID, actor.TenantID, actor.WorkspaceID,
	).Pluck("provider_id", &providerIDs).Error; err != nil {
		return c.BenefitPackageChoiceList{}, err
	}
	granted := make(map[string]bool, len(providerIDs))
	for _, providerID := range providerIDs {
		granted[providerID] = true
	}
	out := c.BenefitPackageChoiceList{Items: make([]c.BenefitPackageChoice, 0, len(packages))}
	for _, item := range packages {
		if !item.IsPreset && !hasGrantedModel(item.ModelIDs, granted) {
			continue
		}
		out.Items = append(out.Items, c.BenefitPackageChoice{
			ID: item.ID, Name: item.Name, IsPreset: item.IsPreset, ModelIDs: item.ModelIDs,
			MaterialUsed: item.MaterialUsed, MaterialReserved: item.MaterialReserved, MaterialLimit: item.MaterialLimit,
		})
	}
	return out, nil
}

func hasGrantedModel(modelIDs []string, granted map[string]bool) bool {
	for _, modelID := range modelIDs {
		if granted[modelID] {
			return true
		}
	}
	return false
}

func assetReviewDTO(row p.AssetReview) c.AssetReview {
	submittedAt := ""
	if row.SubmittedAt != nil {
		submittedAt = isoTime(*row.SubmittedAt)
	}
	return c.AssetReview{
		ID: row.ID, ResourceAssetID: row.ResourceAssetID, AssetID: row.AssetID,
		BenefitPackageID: row.BenefitPackageID, PackageName: row.PackageName, IsPreset: row.IsPreset,
		Status: row.Status, FailureReason: row.FailureReason, SubmittedAt: submittedAt,
		CreatedAt: isoTime(row.CreatedAt), UpdatedAt: isoTime(row.UpdatedAt),
	}
}

func (s *Service) ListAssetReviews(ctx context.Context, actor Actor, projectID string) (c.AssetReviewList, error) {
	db := s.DB.WithContext(ctx)
	if _, err := access(db, actor, projectID, false); err != nil {
		return c.AssetReviewList{}, err
	}
	var rows []p.AssetReview
	err := db.Where(
		`tenant_id = ? AND workspace_id = ? AND project_id = ? AND EXISTS (
			SELECT 1 FROM resource_assets current_slot
			WHERE current_slot.id = asset_reviews.resource_asset_id
			AND current_slot.current_asset_id = asset_reviews.asset_id
			AND current_slot.deleted_at IS NULL
		)`,
		actor.TenantID, actor.WorkspaceID, projectID,
	).Order("updated_at DESC, id").Find(&rows).Error
	out := c.AssetReviewList{Items: make([]c.AssetReview, 0, len(rows))}
	for _, row := range rows {
		out.Items = append(out.Items, assetReviewDTO(row))
	}
	return out, err
}

func (s *Service) SubmitAssetReview(ctx context.Context, actor Actor, projectID, resourceAssetID string, in c.SubmitAssetReview) (c.AssetReview, error) {
	packageID := strings.TrimSpace(in.PackageID)
	operationID := strings.TrimSpace(in.OperationID)
	if packageID == "" || len(packageID) > 32 || operationID == "" || len(operationID) > 36 {
		return c.AssetReview{}, Invalid("invalid asset review request")
	}
	db := s.DB.WithContext(ctx)
	_, slot, err := resourceSlot(db, actor, projectID, resourceAssetID, false)
	if err != nil {
		return c.AssetReview{}, err
	}
	if slot.CurrentAssetID == "" {
		return c.AssetReview{}, Invalid("素材尚无可送审内容")
	}
	var content p.Asset
	if err = db.Where("id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND deleted_at IS NULL", slot.CurrentAssetID, actor.TenantID, actor.WorkspaceID, projectID).First(&content).Error; err != nil {
		return c.AssetReview{}, NotFound()
	}
	var existing p.AssetReview
	err = db.Where("tenant_id = ? AND workspace_id = ? AND created_by = ? AND operation_id = ?", actor.TenantID, actor.WorkspaceID, actor.UserID, operationID).First(&existing).Error
	if err == nil {
		if existing.ProjectID != projectID || existing.ResourceAssetID != resourceAssetID || existing.BenefitPackageID != packageID {
			return c.AssetReview{}, ConflictMessage("asset_review_operation_conflict", "送审操作编号已用于其他素材")
		}
		return assetReviewDTO(existing), nil
	}
	if err != gorm.ErrRecordNotFound {
		return c.AssetReview{}, err
	}
	directory, err := s.benefitPackages()
	if err != nil {
		return c.AssetReview{}, err
	}
	packages, err := directory.ListBenefitPackages(ctx, actor.TenantID, actor.WorkspaceID)
	if err != nil {
		return c.AssetReview{}, benefitPackageError(err)
	}
	var selected *adminclient.BenefitPackage
	for index := range packages {
		if packages[index].ID == packageID {
			selected = &packages[index]
			break
		}
	}
	if selected == nil {
		return c.AssetReview{}, &Error{Status: 404, Code: "benefit_package_not_found", Message: "权益包不存在或已停用"}
	}
	if !selected.IsPreset {
		var granted int64
		if err = db.Model(&projectModelGrant{}).Where(
			"project_id = ? AND tenant_id = ? AND workspace_id = ? AND provider_id IN ?",
			projectID, actor.TenantID, actor.WorkspaceID, selected.ModelIDs,
		).Count(&granted).Error; err != nil {
			return c.AssetReview{}, err
		}
		if granted == 0 {
			return c.AssetReview{}, &Error{Status: 403, Code: "benefit_package_not_granted", Message: "权益包未关联项目已授权的视频模型"}
		}
	}
	reservation, err := directory.ReserveBenefitPackageReview(ctx, actor.TenantID, actor.WorkspaceID, packageID, operationID, projectID, slot.CurrentAssetID)
	if err != nil {
		return c.AssetReview{}, benefitPackageError(err)
	}
	now := time.Now().UTC()
	row := p.AssetReview{
		ID: newID(), TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, ProjectID: projectID,
		ResourceAssetID: resourceAssetID, AssetID: slot.CurrentAssetID, BenefitPackageID: packageID,
		PackageName: selected.Name, IsPreset: selected.IsPreset, ReservationID: reservation.ID,
		OperationID: operationID, CreatedBy: actor.UserID, Status: "SUBMITTING", CreatedAt: now, UpdatedAt: now,
	}
	if err = db.Create(&row).Error; err != nil {
		var concurrent p.AssetReview
		lookupErr := db.Where("tenant_id = ? AND workspace_id = ? AND created_by = ? AND operation_id = ?", actor.TenantID, actor.WorkspaceID, actor.UserID, operationID).First(&concurrent).Error
		if lookupErr == nil && concurrent.ProjectID == projectID && concurrent.ResourceAssetID == resourceAssetID && concurrent.BenefitPackageID == packageID {
			return assetReviewDTO(concurrent), nil
		}
		_, releaseErr := directory.TransitionBenefitPackageReview(ctx, actor.TenantID, actor.WorkspaceID, packageID, reservation.ID, "released")
		if releaseErr != nil {
			return c.AssetReview{}, errors.Join(err, releaseErr)
		}
		if uniqueViolation(err, "asset_reviews_operation") || uniqueViolation(err, "asset_reviews_asset_package") {
			return c.AssetReview{}, ConflictMessage("asset_review_conflict", "该素材已通过此权益包送审")
		}
		return c.AssetReview{}, err
	}
	return assetReviewDTO(row), nil
}

func benefitPackageError(err error) error {
	var dependency *adminclient.DependencyError
	if !errors.As(err, &dependency) {
		return &Error{Status: 503, Code: "benefit_package_unavailable", Message: "权益包服务不可用"}
	}
	switch dependency.Status {
	case http.StatusNotFound:
		return &Error{Status: 404, Code: "benefit_package_not_found", Message: "权益包不存在或已停用"}
	case http.StatusConflict:
		return &Error{Status: 409, Code: "benefit_package_quota_exceeded", Message: dependency.Detail}
	default:
		return &Error{Status: 503, Code: "benefit_package_unavailable", Message: "权益包服务不可用"}
	}
}
