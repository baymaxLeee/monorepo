package project

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/example/monorepo/canvas/internal/platform/logcontext"
	applicationcoverimage "github.com/example/monorepo/canvas/internal/server/application/coverimage"
	applicationdeletion "github.com/example/monorepo/canvas/internal/server/application/deletion"
	applicationprojectaccess "github.com/example/monorepo/canvas/internal/server/application/projectaccess"
	applicationquota "github.com/example/monorepo/canvas/internal/server/application/quota"
	domainproject "github.com/example/monorepo/canvas/internal/server/domain/project"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const (
	maxPageSize              = 100
	maxBatchGetIDs           = 100
	coverImageReleaseTimeout = 5 * time.Second
)

type Service struct {
	repository       Repository
	covers           applicationcoverimage.Store
	ids              IDGenerator
	clock            Clock
	children         ProjectChildCleaner
	cleanupFailure   CleanupFailureReporter
	officialAssets   OfficialMaterializer
	modelPermissions ModelPermissionGateway
	usagePolicies    ProjectUsagePolicyGateway
	quota            ProjectQuota
	storageQuota     StorageQuota
	transactions     TransactionManager
	memberCache      applicationprojectaccess.CacheInvalidator
	deletion         *applicationdeletion.Queue
}

type Option func(*Service)

// WithOfficialMaterialization 开启项目列表上的官方预置补齐。未配置时读路径行为不变。
func WithOfficialMaterialization(materializer OfficialMaterializer) Option {
	return func(service *Service) {
		if materializer != nil {
			service.officialAssets = materializer
		}
	}
}

func WithProjectChildCleanup(cleaner ProjectChildCleaner, reporter CleanupFailureReporter) Option {
	return func(service *Service) {
		if cleaner != nil {
			service.children = cleaner
		}
		if reporter != nil {
			service.cleanupFailure = reporter
		}
	}
}

func WithQuota(quota ProjectQuota, transactions TransactionManager) Option {
	return func(service *Service) {
		if quota != nil && transactions != nil {
			service.quota = quota
			service.transactions = transactions
		}
	}
}

func WithStorageQuota(quota StorageQuota, transactions TransactionManager) Option {
	return func(service *Service) {
		if quota != nil && transactions != nil {
			service.storageQuota = quota
			service.transactions = transactions
		}
	}
}

func WithModelPermissionGateway(gateway ModelPermissionGateway) Option {
	return func(service *Service) { service.modelPermissions = gateway }
}

func WithProjectUsagePolicyGateway(gateway ProjectUsagePolicyGateway) Option {
	return func(service *Service) { service.usagePolicies = gateway }
}

func WithMemberCacheInvalidator(invalidator applicationprojectaccess.CacheInvalidator) Option {
	return func(service *Service) { service.memberCache = invalidator }
}

func NewService(repository Repository, covers applicationcoverimage.Store, ids IDGenerator, clock Clock, options ...Option) *Service {
	service := &Service{
		repository: repository, covers: covers, ids: ids, clock: clock,
		children: noopProjectChildCleaner{}, cleanupFailure: noopCleanupFailureReporter{},
	}
	for _, option := range options {
		option(service)
	}
	return service
}

type CreateInput struct {
	Scope
	Name           string
	MemberIDs      []string
	CoverImagePath *string
	UsageLimit     *int64
}

type UpdateInput struct {
	Scope
	ProjectID      string
	Name           string
	MemberIDs      []string
	CoverImagePath *string
	UsageLimit     *int64
}

type ProjectWithUsage struct {
	domainproject.Project
	UsageLimit *int64
	UsedAmount float64
}

const projectUsageLimitMaximum int64 = 1_000_000_000

func projectWithUsage(project domainproject.Project, limit *int64, usedAmount float64) ProjectWithUsage {
	return ProjectWithUsage{Project: project, UsageLimit: cloneInt64(limit), UsedAmount: usedAmount}
}

func cloneInt64(value *int64) *int64 {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

type UpdateByMemberInput struct {
	Scope
	ProjectID      string
	CoverImagePath *string
}

type DeleteInput struct {
	Scope
	ProjectID string
}

type GrantModelsInput struct {
	Scope
	ProjectID string
	ModelIDs  []string
}

type ListModelsInput struct {
	Scope
	ProjectID  string
	PageNumber int32
	PageSize   int32
	Types      []string
	Features   []string
	Statuses   []string
	IsGranted  *bool
}

// ProjectModel is the sanitized JSON representation of an AIGW ModelInfo.
// Keeping it opaque prevents this application boundary from silently dropping
// fields whenever AIGW extends its model catalog contract.
type ProjectModel = json.RawMessage

type ProjectModelList struct {
	Items []ProjectModel
	Total int32
}

func (s *Service) ListModels(ctx context.Context, input ListModelsInput) (ProjectModelList, error) {
	if !isValidScope(input.Scope) || input.ProjectID == "" || input.PageNumber < 1 || input.PageSize < 1 || input.PageSize > maxPageSize {
		return ProjectModelList{}, errno.New(errno.ErrInvalidArgument)
	}
	if s.modelPermissions == nil {
		return ProjectModelList{}, errno.New(errno.ErrConfigurationError)
	}
	if _, err := s.repository.GetByTenant(ctx, input.TenantID, input.ProjectID); err != nil {
		return ProjectModelList{}, classifyRepositoryError(err)
	}
	result, err := s.modelPermissions.List(ctx, input.Scope, input)
	if err != nil {
		return ProjectModelList{}, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	return result, nil
}

func (s *Service) GrantModels(ctx context.Context, input GrantModelsInput) error {
	if !isValidScope(input.Scope) || input.ProjectID == "" {
		return errno.New(errno.ErrInvalidArgument)
	}
	if s.modelPermissions == nil {
		return errno.New(errno.ErrConfigurationError)
	}
	if _, err := s.repository.GetByTenant(ctx, input.TenantID, input.ProjectID); err != nil {
		return classifyRepositoryError(err)
	}
	seen := make(map[string]struct{}, len(input.ModelIDs))
	modelIDs := make([]string, 0, len(input.ModelIDs))
	for _, modelID := range input.ModelIDs {
		if modelID == "" {
			return errno.New(errno.ErrInvalidArgument)
		}
		if _, ok := seen[modelID]; ok {
			continue
		}
		seen[modelID] = struct{}{}
		modelIDs = append(modelIDs, modelID)
	}
	if err := s.modelPermissions.Grant(ctx, input.Scope, input.ProjectID, modelIDs); err != nil {
		return errno.Wrap(errno.ErrModelDependencyError, err)
	}
	return nil
}

type GetInput struct {
	Scope
	ProjectID string
}

type BatchGetInput struct {
	Scope
	ProjectIDs []string
}

type ListInput struct {
	Scope
	Keyword       string
	SortDirection SortDirection
	Page          Page
}

func (s *Service) Create(ctx context.Context, input CreateInput) (ProjectWithUsage, error) {
	if !isValidScope(input.Scope) {
		return ProjectWithUsage{}, errno.New(errno.ErrInvalidArgument)
	}
	if err := validateUsageLimit(input.UsageLimit, 0); err != nil {
		return ProjectWithUsage{}, err
	}
	if s.usagePolicies == nil {
		return ProjectWithUsage{}, errno.New(errno.ErrConfigurationError)
	}
	id, err := s.ids.NewID()
	if err != nil {
		return ProjectWithUsage{}, errno.Wrap(errno.ErrInternalError, err)
	}

	created, err := domainproject.New(domainproject.NewInput{
		ID:             id,
		TenantID:       input.TenantID,
		WorkspaceID:    input.WorkspaceID,
		Name:           input.Name,
		CreatedBy:      input.CallerID,
		MemberIDs:      input.MemberIDs,
		CoverImagePath: input.CoverImagePath,
		Now:            s.clock.Now(),
	})
	if err != nil {
		return ProjectWithUsage{}, classifyDomainError(err)
	}
	var reservation applicationquota.Reservation
	if s.quota != nil {
		reservation, err = s.quota.ReserveProject(ctx, input.TenantID, created.ID)
		if err != nil {
			return ProjectWithUsage{}, classifyQuotaError(err)
		}
	}
	registration, err := s.registerCoverImage(ctx, input.Scope, &created)
	if err != nil {
		if releaseErr := s.releaseProjectQuota(ctx, reservation); releaseErr != nil {
			return ProjectWithUsage{}, preserveOrWrap(errors.Join(err, releaseErr), errno.ErrInternalError)
		}
		return ProjectWithUsage{}, err
	}
	storageReservation, err := s.reserveCoverStorage(ctx, created, registration)
	if err != nil {
		err = errors.Join(err, s.releaseCoverImage(ctx, registration))
		if releaseErr := s.releaseProjectQuota(ctx, reservation); releaseErr != nil {
			err = errors.Join(err, releaseErr)
		}
		return ProjectWithUsage{}, err
	}
	createdPolicy, err := s.usagePolicies.Create(ctx, input.Scope, created.ID, cloneInt64(input.UsageLimit))
	if err != nil {
		err = errors.Join(
			errno.Wrap(errno.ErrModelDependencyError, err),
			s.releaseCoverImage(ctx, registration),
			s.releaseStorageReservation(ctx, storageReservation),
			s.releaseProjectQuota(ctx, reservation),
		)
		return ProjectWithUsage{}, err
	}
	create := func(txCtx context.Context) error {
		if createErr := s.repository.Create(txCtx, created); createErr != nil {
			return createErr
		}
		if s.quota != nil && reservation.ID != "" {
			if commitErr := s.quota.CommitProject(txCtx, reservation); commitErr != nil {
				return commitErr
			}
		}
		if storageReservation.ID != "" {
			return s.storageQuota.CommitStorage(
				txCtx, storageReservation, projectCoverStorageObject(created),
			)
		}
		return nil
	}
	if s.transactions != nil {
		err = s.transactions.WithinTransaction(ctx, create)
	} else {
		err = create(ctx)
	}
	if err != nil {
		err = errors.Join(
			err,
			s.usagePolicies.Delete(context.WithoutCancel(ctx), input.Scope, createdPolicy.ID),
			s.releaseCoverImage(ctx, registration),
		)
		if releaseErr := s.releaseStorageReservation(ctx, storageReservation); releaseErr != nil {
			err = errors.Join(err, releaseErr)
		}
		if releaseErr := s.releaseProjectQuota(ctx, reservation); releaseErr != nil {
			err = errors.Join(err, releaseErr)
		}
		return ProjectWithUsage{}, classifyRepositoryError(err)
	}
	return projectWithUsage(created, input.UsageLimit, 0), nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (ProjectWithUsage, error) {
	if !isValidScope(input.Scope) || input.ProjectID == "" {
		return ProjectWithUsage{}, errno.New(errno.ErrInvalidArgument)
	}

	current, err := s.repository.Get(ctx, input.Scope, input.ProjectID)
	if err != nil {
		return ProjectWithUsage{}, classifyRepositoryError(err)
	}
	currentPolicy, err := s.getUsagePolicy(ctx, input.Scope, input.ProjectID)
	if err != nil {
		return ProjectWithUsage{}, err
	}
	usedAmount := 0.0
	if currentPolicy != nil {
		usedAmount = currentPolicy.UsedAmount
	}
	if err := validateUsageLimit(input.UsageLimit, usedAmount); err != nil {
		return ProjectWithUsage{}, err
	}
	previousRegistration := coverImageRegistration(current)
	previousMembers := append([]string(nil), current.MemberIDs...)
	if err := current.Update(input.Name, input.MemberIDs, input.CoverImagePath, s.clock.Now()); err != nil {
		return ProjectWithUsage{}, classifyDomainError(err)
	}
	var newRegistration *applicationcoverimage.Registration
	if input.CoverImagePath != nil && current.CoverImagePath != nil &&
		(current.CoverImageID == "" || current.CoverImageSHA256 == "") {
		newRegistration, err = s.registerCoverImage(ctx, input.Scope, &current)
		if err != nil {
			return ProjectWithUsage{}, err
		}
	}
	storageReservation, err := s.reserveCoverStorage(ctx, current, newRegistration)
	if err != nil {
		return ProjectWithUsage{}, errors.Join(err, s.releaseCoverImage(ctx, newRegistration))
	}
	var appliedPolicy ProjectUsagePolicy
	createdPolicy := currentPolicy == nil
	if createdPolicy {
		appliedPolicy, err = s.usagePolicies.Create(ctx, input.Scope, input.ProjectID, cloneInt64(input.UsageLimit))
	} else {
		appliedPolicy, err = s.usagePolicies.Update(ctx, input.Scope, *currentPolicy, cloneInt64(input.UsageLimit))
	}
	if err != nil {
		return ProjectWithUsage{}, errors.Join(
			errno.Wrap(errno.ErrModelDependencyError, err),
			s.releaseCoverImage(ctx, newRegistration),
			s.releaseStorageReservation(ctx, storageReservation),
		)
	}
	replacesPrevious := previousRegistration != nil &&
		(current.CoverImagePath == nil || current.CoverImageID != previousRegistration.ID)
	update := func(txCtx context.Context) error {
		if updateErr := s.repository.Update(txCtx, current); updateErr != nil {
			return updateErr
		}
		if storageReservation.ID != "" {
			if commitErr := s.storageQuota.CommitStorage(
				txCtx, storageReservation, projectCoverStorageObject(current),
			); commitErr != nil {
				return commitErr
			}
		}
		if replacesPrevious {
			return s.markCoverReleasing(txCtx, input.TenantID, previousRegistration)
		}
		return nil
	}
	if s.transactions != nil {
		err = s.transactions.WithinTransaction(ctx, update)
	} else {
		err = update(ctx)
	}
	if err != nil {
		var rollbackErr error
		if createdPolicy {
			rollbackErr = s.usagePolicies.Delete(context.WithoutCancel(ctx), input.Scope, appliedPolicy.ID)
		} else {
			_, rollbackErr = s.usagePolicies.Update(
				context.WithoutCancel(ctx), input.Scope, *currentPolicy, cloneInt64(currentPolicy.Limit),
			)
		}
		err = errors.Join(
			err,
			rollbackErr,
			s.releaseCoverImage(ctx, newRegistration),
			s.releaseStorageReservation(ctx, storageReservation),
		)
		return ProjectWithUsage{}, classifyRepositoryError(err)
	}
	if !slices.Equal(previousMembers, current.MemberIDs) {
		s.invalidateMemberCache(ctx, input.Scope, current.ID)
	}
	return projectWithUsage(current, input.UsageLimit, appliedPolicy.UsedAmount), nil
}

func (s *Service) UpdateByMember(ctx context.Context, input UpdateByMemberInput) (domainproject.Project, error) {
	if !isValidScope(input.Scope) || input.ProjectID == "" {
		return domainproject.Project{}, errno.New(errno.ErrInvalidArgument)
	}

	lookupScope := input.Scope
	lookupScope.Access = AccessAdmin
	current, err := s.repository.Get(ctx, lookupScope, input.ProjectID)
	if err != nil {
		return domainproject.Project{}, classifyRepositoryError(err)
	}
	if !slices.Contains(current.MemberIDs, input.CallerID) {
		return domainproject.Project{}, errno.New(errno.ErrForbidden)
	}
	if input.CoverImagePath == nil {
		return current, nil
	}

	previousRegistration := coverImageRegistration(current)
	if err := current.UpdateByMember(input.CoverImagePath, s.clock.Now()); err != nil {
		return domainproject.Project{}, classifyDomainError(err)
	}
	var newRegistration *applicationcoverimage.Registration
	if current.CoverImagePath != nil && (current.CoverImageID == "" || current.CoverImageSHA256 == "") {
		newRegistration, err = s.registerCoverImage(ctx, input.Scope, &current)
		if err != nil {
			return domainproject.Project{}, err
		}
	}
	storageReservation, err := s.reserveCoverStorage(ctx, current, newRegistration)
	if err != nil {
		return domainproject.Project{}, errors.Join(err, s.releaseCoverImage(ctx, newRegistration))
	}
	replacesPrevious := previousRegistration != nil &&
		(current.CoverImagePath == nil || current.CoverImageID != previousRegistration.ID)
	update := func(txCtx context.Context) error {
		if updateErr := s.repository.UpdateByMember(txCtx, current); updateErr != nil {
			return updateErr
		}
		if storageReservation.ID != "" {
			if commitErr := s.storageQuota.CommitStorage(
				txCtx, storageReservation, projectCoverStorageObject(current),
			); commitErr != nil {
				return commitErr
			}
		}
		if replacesPrevious {
			return s.markCoverReleasing(txCtx, input.TenantID, previousRegistration)
		}
		return nil
	}
	if s.transactions != nil {
		err = s.transactions.WithinTransaction(ctx, update)
	} else {
		err = update(ctx)
	}
	if err != nil {
		err = errors.Join(
			err,
			s.releaseCoverImage(ctx, newRegistration),
			s.releaseStorageReservation(ctx, storageReservation),
		)
		return domainproject.Project{}, classifyRepositoryError(err)
	}
	return current, nil
}

func (s *Service) Delete(ctx context.Context, input DeleteInput) error {
	if !isValidScope(input.Scope) || input.ProjectID == "" {
		return errno.New(errno.ErrInvalidArgument)
	}
	current, err := s.repository.Get(ctx, input.Scope, input.ProjectID)
	if err != nil {
		return classifyRepositoryError(err)
	}
	return s.deleteStoredProject(ctx, input.Scope, current)
}

func (s *Service) deleteStoredProject(ctx context.Context, scope Scope, current domainproject.Project) error {
	registration := coverImageRegistration(current)
	current.Delete(s.clock.Now())
	remove := func(txCtx context.Context) error {
		if deleteErr := s.repository.Delete(txCtx, current); deleteErr != nil {
			return deleteErr
		}
		if s.quota != nil {
			if deleteErr := s.quota.DeleteProject(txCtx, scope.TenantID); deleteErr != nil {
				return deleteErr
			}
		}
		if markErr := s.markCoverReleasing(txCtx, scope.TenantID, registration); markErr != nil {
			return markErr
		}
		return s.deletion.Enqueue(txCtx, scope.TenantID, CleanupJobKind, current.ID, CleanupPayload{Scope: scope, ProjectID: current.ID})
	}
	var err error
	if s.transactions != nil {
		err = s.transactions.WithinTransaction(ctx, remove)
	} else {
		err = remove(ctx)
	}
	if err != nil {
		return classifyRepositoryError(err)
	}
	return nil
}

func (s *Service) DeleteByTenant(ctx context.Context, tenantID, operatorID string) error {
	if tenantID == "" || operatorID == "" {
		return errno.New(errno.ErrInvalidArgument)
	}
	projects, err := s.repository.ListByTenant(ctx, tenantID)
	if err != nil {
		return classifyRepositoryError(err)
	}
	return s.deleteProjectsStrict(ctx, projects, operatorID)
}

func (s *Service) DeleteByWorkspace(ctx context.Context, tenantID, workspaceID, operatorID string) error {
	if tenantID == "" || workspaceID == "" || operatorID == "" {
		return errno.New(errno.ErrInvalidArgument)
	}
	projects, err := s.repository.ListByWorkspace(ctx, tenantID, workspaceID)
	if err != nil {
		return classifyRepositoryError(err)
	}
	return s.deleteProjectsStrict(ctx, projects, operatorID)
}

func (s *Service) deleteProjectsStrict(
	ctx context.Context,
	projects []domainproject.Project,
	operatorID string,
) error {
	for _, current := range projects {
		scope := Scope{
			TenantID: current.TenantID, WorkspaceID: current.WorkspaceID,
			CallerID: operatorID, Access: AccessAdmin,
		}
		if err := s.deleteStoredProject(ctx, scope, current); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) invalidateMemberCache(ctx context.Context, scope Scope, projectID string) {
	if s.memberCache == nil {
		return
	}
	if err := s.memberCache.Invalidate(context.WithoutCancel(ctx), scope.TenantID, scope.WorkspaceID, projectID); err != nil {
		s.reportCleanupFailure(ctx, scope, projectID, err)
	}
}

func (s *Service) reportCleanupFailure(ctx context.Context, scope Scope, projectID string, err error) {
	s.cleanupFailure.Report(logcontext.WithBusiness(ctx, logcontext.Business{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ProjectID: projectID,
	}), err)
}

func (s *Service) releaseProjectQuota(
	ctx context.Context,
	reservation applicationquota.Reservation,
) error {
	if s.quota == nil || reservation.ID == "" {
		return nil
	}
	return s.quota.ReleaseProject(context.WithoutCancel(ctx), reservation)
}

func classifyQuotaError(err error) error {
	switch {
	case errors.Is(err, applicationquota.ErrExceeded):
		return errno.Wrap(errno.ErrProjectQuotaExceeded, err)
	case errors.Is(err, applicationquota.ErrUnavailable):
		return errno.Wrap(errno.ErrQuotaUnavailable, err)
	default:
		return preserveOrWrap(err, errno.ErrInternalError)
	}
}

type noopProjectChildCleaner struct{}

func (noopProjectChildCleaner) Cleanup(context.Context, Scope, string) error { return nil }

type noopCleanupFailureReporter struct{}

func (noopCleanupFailureReporter) Report(context.Context, error) {}

func (s *Service) registerCoverImage(
	ctx context.Context,
	scope Scope,
	project *domainproject.Project,
) (*applicationcoverimage.Registration, error) {
	if project.CoverImagePath == nil {
		return nil, nil
	}
	registration, err := s.covers.Register(ctx, scope.TenantID, scope.CallerID, *project.CoverImagePath)
	if err != nil {
		if errors.Is(err, applicationcoverimage.ErrTooLarge) {
			return nil, errno.Wrap(errno.ErrCoverImageTooLarge, err)
		}
		if errors.Is(err, applicationcoverimage.ErrIDGeneration) {
			return nil, preserveOrWrap(err, errno.ErrInternalError)
		}
		return nil, preserveOrWrap(err, errno.ErrObjectStorageDependencyError)
	}
	if registration.Path != *project.CoverImagePath || registration.ID == "" || registration.SHA256 == "" {
		return nil, errors.Join(
			errno.New(errno.ErrObjectStorageDependencyError),
			s.releaseCoverImage(ctx, &registration),
		)
	}
	project.CoverImageID = registration.ID
	project.CoverImageSHA256 = registration.SHA256
	project.CoverImageSizeBytes = registration.SizeBytes
	return &registration, nil
}

func coverImageRegistration(project domainproject.Project) *applicationcoverimage.Registration {
	if project.CoverImagePath == nil || project.CoverImageID == "" || project.CoverImageSHA256 == "" {
		return nil
	}
	return &applicationcoverimage.Registration{
		Path: *project.CoverImagePath, ID: project.CoverImageID,
		SHA256: project.CoverImageSHA256, SizeBytes: project.CoverImageSizeBytes,
	}
}

func (s *Service) reserveCoverStorage(
	ctx context.Context,
	project domainproject.Project,
	registration *applicationcoverimage.Registration,
) (applicationquota.Reservation, error) {
	if s.storageQuota == nil || registration == nil {
		return applicationquota.Reservation{}, nil
	}
	reservation, err := s.storageQuota.ReserveStorage(
		ctx, project.TenantID, "cover", registration.ID,
		"project_cover", project.ID, registration.SizeBytes,
	)
	if err != nil {
		return applicationquota.Reservation{}, classifyStorageQuotaError(err)
	}
	return reservation, nil
}

func projectCoverStorageObject(project domainproject.Project) applicationquota.StorageObject {
	return applicationquota.StorageObject{
		TenantID: project.TenantID, WorkspaceID: project.WorkspaceID,
		ObjectType: "cover", ObjectKey: project.CoverImageID, Category: "project_cover",
		OwnerType: "project_cover", OwnerID: project.ID,
		SizeBytes: project.CoverImageSizeBytes, BillingClass: applicationquota.BillingBillable,
	}
}

func (s *Service) markCoverReleasing(
	ctx context.Context,
	tenantID string,
	registration *applicationcoverimage.Registration,
) error {
	if registration == nil {
		return nil
	}
	if s.storageQuota != nil {
		if _, err := s.storageQuota.MarkStorageReleasing(ctx, "cover", registration.ID); err != nil {
			return err
		}
	}
	return s.deletion.Enqueue(ctx, tenantID, applicationcoverimage.CleanupJobKind, registration.ID, registration)
}

func (s *Service) releaseStorageReservation(
	ctx context.Context,
	reservation applicationquota.Reservation,
) error {
	if s.storageQuota == nil || reservation.ID == "" {
		return nil
	}
	return s.storageQuota.ReleaseReservation(context.WithoutCancel(ctx), reservation)
}

func (s *Service) releaseCoverImage(
	ctx context.Context,
	registration *applicationcoverimage.Registration,
) error {
	if registration == nil || registration.ID == "" || registration.SHA256 == "" {
		return nil
	}
	releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), coverImageReleaseTimeout)
	defer cancel()
	return s.covers.Release(releaseCtx, *registration)
}

func classifyStorageQuotaError(err error) error {
	switch {
	case errors.Is(err, applicationquota.ErrExceeded):
		return errno.Wrap(errno.ErrStorageQuotaExceeded, err)
	case errors.Is(err, applicationquota.ErrUnavailable):
		return errno.Wrap(errno.ErrQuotaUnavailable, err)
	default:
		return preserveOrWrap(err, errno.ErrInternalError)
	}
}

func (s *Service) Get(ctx context.Context, input GetInput) (domainproject.Project, error) {
	if !isValidScope(input.Scope) || input.ProjectID == "" {
		return domainproject.Project{}, errno.New(errno.ErrInvalidArgument)
	}
	project, err := s.repository.Get(ctx, input.Scope, input.ProjectID)
	if err != nil {
		return domainproject.Project{}, classifyRepositoryError(err)
	}
	return project, nil
}

func (s *Service) GetWithUsage(ctx context.Context, input GetInput) (ProjectWithUsage, error) {
	if input.Access == AccessMember {
		return ProjectWithUsage{}, errno.New(errno.ErrForbidden)
	}
	project, err := s.Get(ctx, input)
	if err != nil {
		return ProjectWithUsage{}, err
	}
	policy, err := s.getUsagePolicy(ctx, input.Scope, input.ProjectID)
	if err != nil {
		return ProjectWithUsage{}, err
	}
	if policy == nil {
		return projectWithUsage(project, nil, 0), nil
	}
	return projectWithUsage(project, policy.Limit, policy.UsedAmount), nil
}

func (s *Service) getUsagePolicy(
	ctx context.Context,
	scope Scope,
	projectID string,
) (*ProjectUsagePolicy, error) {
	if s.usagePolicies == nil {
		return nil, errno.New(errno.ErrConfigurationError)
	}
	policy, err := s.usagePolicies.Find(ctx, scope, projectID)
	if err != nil {
		return nil, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	return policy, nil
}

func validateUsageLimit(limit *int64, used float64) error {
	if limit == nil {
		return nil
	}
	if *limit <= 0 || *limit > projectUsageLimitMaximum || float64(*limit) < used {
		return errno.New(errno.ErrInvalidArgument)
	}
	return nil
}

func (s *Service) BatchGet(ctx context.Context, input BatchGetInput) ([]domainproject.Project, error) {
	ids, valid := normalizeBatchIDs(input.ProjectIDs)
	if !isValidScope(input.Scope) || !valid {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	if len(ids) == 0 {
		return []domainproject.Project{}, nil
	}
	items, err := s.repository.BatchGet(ctx, input.Scope, ids)
	if err != nil {
		return nil, classifyRepositoryError(err)
	}
	return orderProjects(items, ids), nil
}

func (s *Service) List(ctx context.Context, input ListInput) ([]domainproject.Project, int64, error) {
	if !isValidScope(input.Scope) || input.Page.PageSize < 1 || input.Page.PageSize > maxPageSize || input.Page.PageNum < 1 {
		return nil, 0, errno.New(errno.ErrInvalidArgument)
	}
	direction := input.SortDirection
	if direction == SortUnspecified {
		direction = SortDescending
	}
	if direction != SortAscending && direction != SortDescending {
		return nil, 0, errno.New(errno.ErrInvalidArgument)
	}
	// 项目列表是进入工作台的必经入口，因此在此处补齐本 scope 的官方预置。实现自行短路，
	// 稳定态不产生额外查询；失败不影响本次读取，仅由其内部上报。
	if s.officialAssets != nil {
		s.officialAssets.MaterializeForScope(ctx, input.Scope)
	}

	projects, total, err := s.repository.List(ctx, ListQuery{
		TenantID:      input.TenantID,
		WorkspaceID:   input.WorkspaceID,
		CallerID:      input.CallerID,
		Access:        input.Access,
		Keyword:       input.Keyword,
		SortDirection: direction,
		PageSize:      input.Page.PageSize,
		PageNum:       input.Page.PageNum,
	})
	if err != nil {
		return nil, 0, classifyRepositoryError(err)
	}
	return projects, total, nil
}

func isValidScope(scope Scope) bool {
	return scope.TenantID != "" && scope.CallerID != "" &&
		(scope.Access == AccessAdmin || scope.Access == AccessMember)
}

func normalizeBatchIDs(input []string) ([]string, bool) {
	if len(input) > maxBatchGetIDs {
		return nil, false
	}
	seen := make(map[string]struct{}, len(input))
	ids := make([]string, 0, len(input))
	for _, id := range input {
		if id == "" {
			return nil, false
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, true
}

func orderProjects(items []domainproject.Project, ids []string) []domainproject.Project {
	byID := make(map[string]domainproject.Project, len(items))
	for _, item := range items {
		byID[item.ID] = item
	}
	ordered := make([]domainproject.Project, 0, len(ids))
	for _, id := range ids {
		if item, exists := byID[id]; exists {
			ordered = append(ordered, item)
		}
	}
	return ordered
}

func classifyDomainError(err error) error {
	switch {
	case errors.Is(err, domainproject.ErrMembersRequired):
		return errno.Wrap(errno.ErrProjectMembersRequired, err)
	case errors.Is(err, domainproject.ErrInvalidName), errors.Is(err, domainproject.ErrInvalidCoverImagePath):
		return errno.Wrap(errno.ErrInvalidArgument, err)
	default:
		return preserveOrWrap(err, errno.ErrInternalError)
	}
}

func classifyRepositoryError(err error) error {
	switch {
	case errors.Is(err, ErrNotFound):
		return errno.Wrap(errno.ErrNotFound, err)
	case errors.Is(err, ErrNameConflict):
		return errno.Wrap(errno.ErrProjectNameAlreadyExists, err)
	default:
		return preserveOrWrap(err, errno.ErrPersistenceError)
	}
}

func preserveOrWrap(err error, code errno.ErrorCode) error {
	var bizErr *errno.BizError
	if errors.As(err, &bizErr) {
		return err
	}
	return errno.Wrap(code, err)
}
