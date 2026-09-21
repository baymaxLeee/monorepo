package benefitpackage

import (
	"context"
	"errors"
	"strings"

	applicationmodel "github.com/example/monorepo/canvas/internal/server/application/model"
	domainpackage "github.com/example/monorepo/canvas/internal/server/domain/benefitpackage"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type Service struct {
	repository      Repository
	models          applicationmodel.Catalog
	ids             IDGenerator
	clock           Clock
	cipher          CredentialCipher
	groups          AssetGroupGateway
	cleanupFailures AssetGroupCleanupFailureReporter
	deletion        PackageDeletion
}

func NewService(repository Repository, models applicationmodel.Catalog, ids IDGenerator, clock Clock, cipher CredentialCipher, groups AssetGroupGateway, options ...ServiceOption) *Service {
	service := &Service{repository: repository, models: models, ids: ids, clock: clock, cipher: cipher, groups: groups}
	for _, option := range options {
		option(service)
	}
	return service
}

type ServiceOption func(*Service)

func WithAssetGroupCleanupFailureReporter(reporter AssetGroupCleanupFailureReporter) ServiceOption {
	return func(service *Service) { service.cleanupFailures = reporter }
}

func WithPackageDeletion(deletion PackageDeletion) ServiceOption {
	return func(service *Service) { service.deletion = deletion }
}

type CreateInput struct {
	Scope
	IsPreset                                        bool
	Name, ProjectName, AccessKeyID, SecretAccessKey string
	Enabled                                         bool
	ModelIDs                                        []string
}

type UpdateInput struct {
	Scope
	PackageID, Name, ProjectName, AccessKeyID, SecretAccessKey string
	Enabled                                                    bool
	ModelIDs                                                   []string
	ExpectedRevision                                           int64
}

type DeleteInput struct {
	Scope
	PackageID                    string
	ExpectedRevision             int64
	DeleteExternalReviewedAssets bool
}

type CreatePresetInput struct {
	Scope
	AccessKeyID, SecretAccessKey string
}

type UpdatePresetInput struct {
	Scope
	PackageID, AccessKeyID, SecretAccessKey string
	ExpectedRevision                        int64
}

type SetPresetEnabledInput struct {
	Scope
	PackageID        string
	Enabled          bool
	ExpectedRevision int64
}

type CreateCustomInput struct {
	Scope
	Name, ProjectName, AccessKeyID, SecretAccessKey string
	Enabled                                         bool
	ModelIDs                                        []string
}

type UpdateCustomInput struct {
	Scope
	PackageID, Name, ProjectName, AccessKeyID, SecretAccessKey string
	Enabled                                                    bool
	ModelIDs                                                   []string
	ExpectedRevision                                           int64
}

type DeleteCustomInput struct {
	Scope
	PackageID                    string
	ExpectedRevision             int64
	DeleteExternalReviewedAssets bool
}

func (s *Service) CreatePreset(ctx context.Context, input CreatePresetInput) (domainpackage.Package, error) {
	return s.Create(ctx, CreateInput{
		Scope: input.Scope, IsPreset: true, AccessKeyID: input.AccessKeyID, SecretAccessKey: input.SecretAccessKey,
	})
}

func (s *Service) CreateCustom(ctx context.Context, input CreateCustomInput) (domainpackage.Package, error) {
	return s.Create(ctx, CreateInput{
		Scope: input.Scope, Name: input.Name, ProjectName: input.ProjectName,
		AccessKeyID: input.AccessKeyID, SecretAccessKey: input.SecretAccessKey,
		Enabled: input.Enabled, ModelIDs: input.ModelIDs,
	})
}

func (s *Service) Create(ctx context.Context, input CreateInput) (domainpackage.Package, error) {
	name := strings.TrimSpace(input.Name)
	projectName := strings.TrimSpace(input.ProjectName)
	if input.IsPreset {
		name, projectName, input.Enabled = domainpackage.PresetName, domainpackage.PresetProjectName, true
	} else if name == domainpackage.PresetName {
		return domainpackage.Package{}, errno.New(errno.ErrInvalidArgument)
	}
	accessKeyID := strings.TrimSpace(input.AccessKeyID)
	secretAccessKey := strings.TrimSpace(input.SecretAccessKey)
	if !validScope(input.Scope) || accessKeyID == "" || secretAccessKey == "" ||
		name == "" || len([]rune(name)) > domainpackage.MaxNameLength ||
		projectName == "" || len(projectName) > domainpackage.MaxProjectNameLength {
		return domainpackage.Package{}, errno.New(errno.ErrInvalidArgument)
	}
	scopeType := domainpackage.ScopeSystemPresetModels
	var modelIDs []string
	var err error
	if !input.IsPreset {
		scopeType = domainpackage.ScopeCustomModels
		modelIDs, err = s.validateModels(ctx, input.Scope, input.ModelIDs)
		if err != nil {
			return domainpackage.Package{}, err
		}
	}
	encryptedAccessKeyID, err := s.cipher.Encrypt(input.TenantID, accessKeyID)
	if err != nil {
		return domainpackage.Package{}, errno.Wrap(errno.ErrInternalError, err)
	}
	encryptedSecret, err := s.cipher.Encrypt(input.TenantID, secretAccessKey)
	if err != nil {
		return domainpackage.Package{}, errno.Wrap(errno.ErrInternalError, err)
	}
	id, err := s.ids.NewID()
	if err != nil {
		return domainpackage.Package{}, errno.Wrap(errno.ErrInternalError, err)
	}
	assetGroupID, err := s.groups.CreateAssetGroup(ctx, CreateAssetGroupInput{
		Name: name, ProjectName: projectName, AccessKeyID: accessKeyID, SecretAccessKey: secretAccessKey,
	})
	if err != nil {
		return domainpackage.Package{}, errno.Wrap(errno.ErrExternalDependencyError, err)
	}
	item, err := domainpackage.New(domainpackage.NewInput{
		ID: id, TenantID: input.TenantID, IsPreset: input.IsPreset, Name: name, ProjectName: projectName,
		AssetGroupID:         assetGroupID,
		EncryptedAccessKeyID: encryptedAccessKeyID, EncryptedSecretAccessKey: encryptedSecret, Enabled: input.Enabled,
		ScopeType: scopeType, ModelIDs: modelIDs, CreatedBy: input.CallerID, Now: s.clock.Now(),
	})
	if err != nil {
		if cleanupErr := s.groups.DeleteAssetGroup(context.WithoutCancel(ctx), DeleteAssetGroupInput{AssetGroupID: assetGroupID, ProjectName: projectName, AccessKeyID: accessKeyID, SecretAccessKey: secretAccessKey}); cleanupErr != nil {
			return domainpackage.Package{}, errno.Wrap(errno.ErrExternalDependencyError, errors.Join(err, cleanupErr))
		}
		return domainpackage.Package{}, errno.Wrap(errno.ErrInvalidArgument, err)
	}
	if err = s.repository.Create(ctx, item); err != nil {
		cleanupErr := s.groups.DeleteAssetGroup(context.WithoutCancel(ctx), DeleteAssetGroupInput{AssetGroupID: assetGroupID, ProjectName: projectName, AccessKeyID: accessKeyID, SecretAccessKey: secretAccessKey})
		if cleanupErr != nil {
			err = errors.Join(err, cleanupErr)
		}
		return domainpackage.Package{}, classify(err)
	}
	return item, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (domainpackage.Package, error) {
	return s.update(ctx, input, nil)
}

func (s *Service) UpdatePreset(ctx context.Context, input UpdatePresetInput) (domainpackage.Package, error) {
	isPreset := true
	return s.update(ctx, UpdateInput{
		Scope: input.Scope, PackageID: input.PackageID, AccessKeyID: input.AccessKeyID,
		SecretAccessKey: input.SecretAccessKey, ExpectedRevision: input.ExpectedRevision,
	}, &isPreset)
}

func (s *Service) UpdateCustom(ctx context.Context, input UpdateCustomInput) (domainpackage.Package, error) {
	isPreset := false
	return s.update(ctx, UpdateInput(input), &isPreset)
}

func (s *Service) update(ctx context.Context, input UpdateInput, expectedPreset *bool) (domainpackage.Package, error) {
	if !validScope(input.Scope) || input.PackageID == "" || input.ExpectedRevision < 1 {
		return domainpackage.Package{}, errno.New(errno.ErrInvalidArgument)
	}
	item, err := s.repository.Get(ctx, input.Scope, input.PackageID)
	if err != nil {
		return domainpackage.Package{}, classify(err)
	}
	if expectedPreset != nil && item.IsPreset != *expectedPreset {
		return domainpackage.Package{}, classify(ErrPackageTypeMismatch)
	}
	oldItem := item
	name, projectName, enabled := input.Name, input.ProjectName, input.Enabled
	scopeType := domainpackage.ScopeCustomModels
	var modelIDs []string
	if item.IsPreset {
		name, projectName, enabled = domainpackage.PresetName, domainpackage.PresetProjectName, item.Enabled
		scopeType = domainpackage.ScopeSystemPresetModels
	} else {
		if strings.TrimSpace(name) == domainpackage.PresetName {
			return domainpackage.Package{}, errno.New(errno.ErrInvalidArgument)
		}
		modelIDs, err = s.validateModels(ctx, input.Scope, input.ModelIDs)
		if err != nil {
			return domainpackage.Package{}, err
		}
	}
	encryptedAccessKeyID := ""
	if strings.TrimSpace(input.AccessKeyID) != "" {
		encryptedAccessKeyID, err = s.cipher.Encrypt(input.TenantID, input.AccessKeyID)
		if err != nil {
			return domainpackage.Package{}, errno.Wrap(errno.ErrInternalError, err)
		}
	}
	encryptedSecret := ""
	if strings.TrimSpace(input.SecretAccessKey) != "" {
		encryptedSecret, err = s.cipher.Encrypt(input.TenantID, input.SecretAccessKey)
		if err != nil {
			return domainpackage.Package{}, errno.Wrap(errno.ErrInternalError, err)
		}
	}
	if err = item.Update(name, projectName, encryptedAccessKeyID, encryptedSecret, enabled, scopeType, modelIDs, input.CallerID, s.clock.Now()); err != nil {
		return domainpackage.Package{}, errno.Wrap(errno.ErrInvalidArgument, err)
	}
	groupChanged := item.Name != oldItem.Name || item.ProjectName != oldItem.ProjectName || encryptedAccessKeyID != "" || encryptedSecret != ""
	var effectiveAccessKeyID, effectiveSecret string
	if groupChanged {
		effectiveAccessKeyID, effectiveSecret, err = s.decryptCredentials(item.TenantID, item.EncryptedAccessKeyID, item.EncryptedSecretAccessKey)
		if err != nil {
			return domainpackage.Package{}, errno.Wrap(errno.ErrInternalError, err)
		}
		item.AssetGroupID, err = s.groups.CreateAssetGroup(ctx, CreateAssetGroupInput{Name: item.Name, ProjectName: item.ProjectName, AccessKeyID: effectiveAccessKeyID, SecretAccessKey: effectiveSecret})
		if err != nil {
			return domainpackage.Package{}, errno.Wrap(errno.ErrExternalDependencyError, err)
		}
	}
	if err = s.repository.Update(ctx, item, input.ExpectedRevision); err != nil {
		if groupChanged {
			if cleanupErr := s.groups.DeleteAssetGroup(context.WithoutCancel(ctx), DeleteAssetGroupInput{AssetGroupID: item.AssetGroupID, ProjectName: item.ProjectName, AccessKeyID: effectiveAccessKeyID, SecretAccessKey: effectiveSecret}); cleanupErr != nil {
				err = errors.Join(err, cleanupErr)
			}
		}
		return domainpackage.Package{}, classify(err)
	}
	if groupChanged {
		oldAccessKeyID, oldSecret, decryptErr := s.decryptCredentials(oldItem.TenantID, oldItem.EncryptedAccessKeyID, oldItem.EncryptedSecretAccessKey)
		if decryptErr == nil {
			if cleanupErr := s.groups.DeleteAssetGroup(context.WithoutCancel(ctx), DeleteAssetGroupInput{AssetGroupID: oldItem.AssetGroupID, ProjectName: oldItem.ProjectName, AccessKeyID: oldAccessKeyID, SecretAccessKey: oldSecret}); cleanupErr != nil {
				s.reportCleanupFailure(ctx, "replace", oldItem.ID, cleanupErr)
			}
		} else {
			s.reportCleanupFailure(ctx, "replace", oldItem.ID, decryptErr)
		}
	}
	return item, nil
}

func (s *Service) SetPresetEnabled(ctx context.Context, input SetPresetEnabledInput) (domainpackage.Package, error) {
	if !validScope(input.Scope) || input.PackageID == "" || input.ExpectedRevision < 1 {
		return domainpackage.Package{}, errno.New(errno.ErrInvalidArgument)
	}
	item, err := s.repository.Get(ctx, input.Scope, input.PackageID)
	if err != nil {
		return domainpackage.Package{}, classify(err)
	}
	if !item.IsPreset {
		return domainpackage.Package{}, classify(ErrPackageTypeMismatch)
	}
	if err = item.Update(domainpackage.PresetName, domainpackage.PresetProjectName, "", "", input.Enabled, domainpackage.ScopeSystemPresetModels, nil, input.CallerID, s.clock.Now()); err != nil {
		return domainpackage.Package{}, errno.Wrap(errno.ErrInvalidArgument, err)
	}
	if err = s.repository.Update(ctx, item, input.ExpectedRevision); err != nil {
		return domainpackage.Package{}, classify(err)
	}
	return item, nil
}

func (s *Service) reportCleanupFailure(ctx context.Context, operation, packageID string, err error) {
	if s.cleanupFailures != nil {
		s.cleanupFailures.ReportAssetGroupCleanupFailure(context.WithoutCancel(ctx), operation, packageID, err)
	}
}

func (s *Service) Delete(ctx context.Context, input DeleteInput) error {
	if !validScope(input.Scope) || input.PackageID == "" || input.ExpectedRevision < 1 {
		return errno.New(errno.ErrInvalidArgument)
	}
	item, err := s.repository.Get(ctx, input.Scope, input.PackageID)
	if err != nil {
		return classify(err)
	}
	if item.IsPreset {
		return classify(ErrPresetImmutable)
	}
	item.Delete(input.CallerID, s.clock.Now())
	if s.deletion == nil {
		return errno.New(errno.ErrInternalError)
	}
	return classify(s.deletion.DeletePackage(
		ctx, item, input.ExpectedRevision,
		deleteExternalReviewedAssetsPolicy(item.IsPreset, input.DeleteExternalReviewedAssets),
	))
}

func (s *Service) DeleteCustom(ctx context.Context, input DeleteCustomInput) error {
	return s.Delete(ctx, DeleteInput(input))
}

func (s *Service) DeleteByTenant(ctx context.Context, tenantID, operatorID string) error {
	scope := Scope{TenantID: tenantID, CallerID: operatorID}
	if !validScope(scope) {
		return errno.New(errno.ErrInvalidArgument)
	}
	if s.deletion == nil {
		return errno.New(errno.ErrInternalError)
	}
	items, err := s.repository.List(ctx, scope)
	if err != nil {
		return classify(err)
	}
	for _, item := range items {
		expectedRevision := item.Revision
		item.Delete(operatorID, s.clock.Now())
		if err := s.deletion.DeletePackage(
			ctx,
			item,
			expectedRevision,
			deleteExternalReviewedAssetsPolicy(item.IsPreset, false),
		); err != nil {
			return classify(err)
		}
	}
	return nil
}

func deleteExternalReviewedAssetsPolicy(isPreset, requested bool) bool {
	return isPreset || requested
}

func (s *Service) List(ctx context.Context, scope Scope) ([]domainpackage.Package, error) {
	if !validScope(scope) {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	items, err := s.repository.List(ctx, scope)
	if err != nil {
		return nil, classify(err)
	}
	return items, nil
}

func (s *Service) ListAvailable(ctx context.Context, scope Scope) ([]domainpackage.Package, error) {
	items, err := s.List(ctx, scope)
	if err != nil {
		return nil, err
	}
	return filterPackages(items, func(item domainpackage.Package) bool { return item.Enabled }), nil
}

func (s *Service) ListCustom(ctx context.Context, scope Scope) ([]domainpackage.Package, error) {
	items, err := s.List(ctx, scope)
	if err != nil {
		return nil, err
	}
	return filterPackages(items, func(item domainpackage.Package) bool { return !item.IsPreset }), nil
}

func (s *Service) GetPreset(ctx context.Context, scope Scope) (domainpackage.Package, bool, error) {
	items, err := s.List(ctx, scope)
	if err != nil {
		return domainpackage.Package{}, false, err
	}
	for _, item := range items {
		if item.IsPreset {
			return item, true, nil
		}
	}
	return domainpackage.Package{}, false, nil
}

func filterPackages(items []domainpackage.Package, keep func(domainpackage.Package) bool) []domainpackage.Package {
	result := make([]domainpackage.Package, 0, len(items))
	for _, item := range items {
		if keep(item) {
			result = append(result, item)
		}
	}
	return result
}

func (s *Service) validateModels(ctx context.Context, scope Scope, input []string) ([]string, error) {
	seen := make(map[string]struct{}, len(input))
	ids := make([]string, 0, len(input))
	for _, id := range input {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) < 1 || len(ids) > domainpackage.MaxModelCount {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	requirements := make([]applicationmodel.Requirement, len(ids))
	for index, id := range ids {
		requirements[index] = applicationmodel.Requirement{Capability: applicationmodel.CapabilityCanvasNodeVideo, ModelID: id}
	}
	resolved, err := s.models.Resolve(ctx, applicationmodel.Actor{TenantID: scope.TenantID, UserID: scope.CallerID}, requirements)
	if err != nil {
		if errors.Is(err, applicationmodel.ErrDefaultModelNotConfigured) {
			return nil, errno.Wrap(errno.ErrDefaultModelNotConfigured, err)
		}
		if errors.Is(err, applicationmodel.ErrUnavailable) {
			return nil, errno.Wrap(errno.ErrModelUnavailable, err)
		}
		return nil, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	for _, item := range resolved {
		// AIGW IsPreset is the sole preset contract; source and copy lineage are unrelated.
		if item.IsPreset {
			return nil, errno.New(errno.ErrModelUnavailable)
		}
	}
	return ids, nil
}

func validScope(scope Scope) bool { return scope.TenantID != "" && scope.CallerID != "" }

func (s *Service) decryptCredentials(tenantID, encryptedAccessKeyID, encryptedSecret string) (string, string, error) {
	accessKeyID, err := s.cipher.Decrypt(tenantID, encryptedAccessKeyID)
	if err != nil {
		return "", "", err
	}
	secret, err := s.cipher.Decrypt(tenantID, encryptedSecret)
	return accessKeyID, secret, err
}

func classify(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, ErrNotFound):
		return errno.Wrap(errno.ErrNotFound, err)
	case errors.Is(err, ErrNameConflict):
		return errno.Wrap(errno.ErrBenefitPackageNameAlreadyExists, err)
	case errors.Is(err, ErrModelConflict), errors.Is(err, ErrRevisionConflict):
		return errno.Wrap(errno.ErrConflict, err)
	case errors.Is(err, ErrPresetImmutable), errors.Is(err, ErrPackageTypeMismatch):
		return errno.Wrap(errno.ErrForbidden, err)
	default:
		return errno.Wrap(errno.ErrPersistenceError, err)
	}
}
