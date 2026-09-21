package http

import (
	"context"

	"github.com/example/monorepo/canvas/internal/platform/http/topcontext"
	applicationpackage "github.com/example/monorepo/canvas/internal/server/application/benefitpackage"
	applicationquota "github.com/example/monorepo/canvas/internal/server/application/quota"
	contractbase "github.com/example/monorepo/canvas/internal/server/contracts/base"
	contractpackage "github.com/example/monorepo/canvas/internal/server/contracts/benefitpackage"
	domainpackage "github.com/example/monorepo/canvas/internal/server/domain/benefitpackage"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type benefitPackageService interface {
	ListAvailable(context.Context, applicationpackage.Scope) ([]domainpackage.Package, error)
	GetPreset(context.Context, applicationpackage.Scope) (domainpackage.Package, bool, error)
	CreatePreset(context.Context, applicationpackage.CreatePresetInput) (domainpackage.Package, error)
	UpdatePreset(context.Context, applicationpackage.UpdatePresetInput) (domainpackage.Package, error)
	SetPresetEnabled(context.Context, applicationpackage.SetPresetEnabledInput) (domainpackage.Package, error)
	ListCustom(context.Context, applicationpackage.Scope) ([]domainpackage.Package, error)
	CreateCustom(context.Context, applicationpackage.CreateCustomInput) (domainpackage.Package, error)
	UpdateCustom(context.Context, applicationpackage.UpdateCustomInput) (domainpackage.Package, error)
	DeleteCustom(context.Context, applicationpackage.DeleteCustomInput) error
}

type benefitPackageLimitProvider interface {
	Limit(context.Context, string, applicationquota.ResourceType) (applicationquota.Limit, error)
}

type BenefitPackageHandler struct {
	service benefitPackageService
	limits  benefitPackageLimitProvider
}

func NewBenefitPackageHandler(
	service *applicationpackage.Service,
	limits *applicationquota.LimitCache,
) *BenefitPackageHandler {
	return &BenefitPackageHandler{service: service, limits: limits}
}

func (h *BenefitPackageHandler) ListAvailableBenefitPackages(ctx context.Context, request *contractpackage.ListAvailableBenefitPackagesRequest) (*contractpackage.ListAvailableBenefitPackagesResponse, error) {
	if err := requireAction(ctx, "ListAvailableBenefitPackages"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	items, err := h.service.ListAvailable(ctx, benefitPackageScope(ctx))
	if err != nil {
		return nil, err
	}
	return &contractpackage.ListAvailableBenefitPackagesResponse{Items: benefitPackageDTOs(items)}, nil
}

func (h *BenefitPackageHandler) GetPresetBenefitPackage(ctx context.Context, request *contractpackage.GetPresetBenefitPackageRequest) (*contractpackage.GetPresetBenefitPackageResponse, error) {
	if err := requireAction(ctx, "GetPresetBenefitPackage"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	scope := benefitPackageScope(ctx)
	item, exists, err := h.service.GetPreset(ctx, scope)
	if err != nil {
		return nil, err
	}
	response := &contractpackage.GetPresetBenefitPackageResponse{}
	if exists {
		response.Package = benefitPackageDTO(item)
		limit, limitErr := h.limits.Limit(ctx, scope.TenantID, applicationquota.ResourcePresetEntitlement)
		if limitErr != nil {
			return nil, errno.Wrap(errno.ErrQuotaUnavailable, limitErr)
		}
		response.MaterialLimit = &limit.Tenant
	}
	return response, nil
}

func (h *BenefitPackageHandler) CreatePresetBenefitPackage(ctx context.Context, request *contractpackage.CreatePresetBenefitPackageRequest) (*contractpackage.CreatePresetBenefitPackageResponse, error) {
	if err := requireAction(ctx, "CreatePresetBenefitPackage"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	item, err := h.service.CreatePreset(ctx, applicationpackage.CreatePresetInput{
		Scope: benefitPackageScope(ctx), AccessKeyID: request.AccessKeyID, SecretAccessKey: request.SecretAccessKey,
	})
	if err != nil {
		return nil, err
	}
	return &contractpackage.CreatePresetBenefitPackageResponse{Package: benefitPackageDTO(item)}, nil
}

func (h *BenefitPackageHandler) UpdatePresetBenefitPackage(ctx context.Context, request *contractpackage.UpdatePresetBenefitPackageRequest) (*contractpackage.UpdatePresetBenefitPackageResponse, error) {
	if err := requireAction(ctx, "UpdatePresetBenefitPackage"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	item, err := h.service.UpdatePreset(ctx, applicationpackage.UpdatePresetInput{
		Scope: benefitPackageScope(ctx), PackageID: request.PackageID,
		AccessKeyID: request.GetAccessKeyID(), SecretAccessKey: request.GetSecretAccessKey(),
		ExpectedRevision: request.ExpectedRevision,
	})
	if err != nil {
		return nil, err
	}
	return &contractpackage.UpdatePresetBenefitPackageResponse{Package: benefitPackageDTO(item)}, nil
}

func (h *BenefitPackageHandler) SetPresetBenefitPackageEnabled(ctx context.Context, request *contractpackage.SetPresetBenefitPackageEnabledRequest) (*contractpackage.SetPresetBenefitPackageEnabledResponse, error) {
	if err := requireAction(ctx, "SetPresetBenefitPackageEnabled"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	item, err := h.service.SetPresetEnabled(ctx, applicationpackage.SetPresetEnabledInput{
		Scope: benefitPackageScope(ctx), PackageID: request.PackageID,
		Enabled: request.Enabled, ExpectedRevision: request.ExpectedRevision,
	})
	if err != nil {
		return nil, err
	}
	return &contractpackage.SetPresetBenefitPackageEnabledResponse{Package: benefitPackageDTO(item)}, nil
}

func (h *BenefitPackageHandler) ListCustomBenefitPackages(ctx context.Context, request *contractpackage.ListCustomBenefitPackagesRequest) (*contractpackage.ListCustomBenefitPackagesResponse, error) {
	if err := requireAction(ctx, "ListCustomBenefitPackages"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	items, err := h.service.ListCustom(ctx, benefitPackageScope(ctx))
	if err != nil {
		return nil, err
	}
	return &contractpackage.ListCustomBenefitPackagesResponse{Items: benefitPackageDTOs(items)}, nil
}

func (h *BenefitPackageHandler) CreateCustomBenefitPackage(ctx context.Context, request *contractpackage.CreateCustomBenefitPackageRequest) (*contractpackage.CreateCustomBenefitPackageResponse, error) {
	if err := requireAction(ctx, "CreateCustomBenefitPackage"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	item, err := h.service.CreateCustom(ctx, applicationpackage.CreateCustomInput{
		Scope: benefitPackageScope(ctx), Name: request.Name, ProjectName: request.ProjectName,
		AccessKeyID: request.AccessKeyID, SecretAccessKey: request.SecretAccessKey,
		Enabled: request.Enabled, ModelIDs: request.ModelIDs,
	})
	if err != nil {
		return nil, err
	}
	return &contractpackage.CreateCustomBenefitPackageResponse{Package: benefitPackageDTO(item)}, nil
}

func (h *BenefitPackageHandler) UpdateCustomBenefitPackage(ctx context.Context, request *contractpackage.UpdateCustomBenefitPackageRequest) (*contractpackage.UpdateCustomBenefitPackageResponse, error) {
	if err := requireAction(ctx, "UpdateCustomBenefitPackage"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	item, err := h.service.UpdateCustom(ctx, applicationpackage.UpdateCustomInput{
		Scope: benefitPackageScope(ctx), PackageID: request.PackageID, Name: request.Name, ProjectName: request.ProjectName,
		AccessKeyID: request.GetAccessKeyID(), SecretAccessKey: request.GetSecretAccessKey(),
		Enabled: request.Enabled, ModelIDs: request.ModelIDs, ExpectedRevision: request.ExpectedRevision,
	})
	if err != nil {
		return nil, err
	}
	return &contractpackage.UpdateCustomBenefitPackageResponse{Package: benefitPackageDTO(item)}, nil
}

func (h *BenefitPackageHandler) DeleteCustomBenefitPackage(ctx context.Context, request *contractpackage.DeleteCustomBenefitPackageRequest) (*contractbase.Empty, error) {
	if err := requireAction(ctx, "DeleteCustomBenefitPackage"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	if err := h.service.DeleteCustom(ctx, applicationpackage.DeleteCustomInput{
		Scope: benefitPackageScope(ctx), PackageID: request.PackageID, ExpectedRevision: request.ExpectedRevision,
		DeleteExternalReviewedAssets: request.GetDeleteExternalReviewedAssets(),
	}); err != nil {
		return nil, err
	}
	return &contractbase.Empty{}, nil
}

func benefitPackageScope(ctx context.Context) applicationpackage.Scope {
	metadata, _ := topcontext.MetadataFromContext(ctx)
	return applicationpackage.Scope{TenantID: metadata.TenantID, CallerID: metadata.UserID}
}

func benefitPackageDTO(item domainpackage.Package) *contractpackage.BenefitPackage {
	scopeType := contractpackage.BenefitPackageScopeType_CUSTOM_MODELS
	if item.ScopeType == domainpackage.ScopeSystemPresetModels {
		scopeType = contractpackage.BenefitPackageScopeType_SYSTEM_PRESET_MODELS
	}
	return &contractpackage.BenefitPackage{PackageID: item.ID, IsPreset: item.IsPreset, Name: item.Name, ProjectName: item.ProjectName, HasAccessKeyID: item.EncryptedAccessKeyID != "", HasSecretAccessKey: item.EncryptedSecretAccessKey != "", Enabled: item.Enabled, ModelIDs: append([]string{}, item.ModelIDs...), ScopeType: scopeType, MaterialUsed: item.MaterialUsed, Revision: item.Revision, CreatedBy: item.CreatedBy, UpdatedBy: item.UpdatedBy, CreatedAt: timestamp(item.CreatedAt), UpdatedAt: timestamp(item.UpdatedAt)}
}

func benefitPackageDTOs(items []domainpackage.Package) []*contractpackage.BenefitPackage {
	result := make([]*contractpackage.BenefitPackage, 0, len(items))
	for _, item := range items {
		result = append(result, benefitPackageDTO(item))
	}
	return result
}
