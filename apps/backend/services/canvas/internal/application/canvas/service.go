package canvas

import (
	"context"
	"errors"
	"strings"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationcoverimage "github.com/example/monorepo/canvas/internal/application/coverimage"
	applicationdeletion "github.com/example/monorepo/canvas/internal/application/deletion"
	applicationprojectstatistics "github.com/example/monorepo/canvas/internal/application/projectstatistics"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	"github.com/example/monorepo/canvas/internal/infrastructure/observability/logcontext"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const (
	maxPageSize              = 100
	maxBatchGetIDs           = 100
	maxBatchPositionUpdates  = 500
	coverImageReleaseTimeout = 5 * time.Second
)

type Service struct {
	deletion          *applicationdeletion.Queue
	deletionPreparer  CanvasDeletionPreparer
	repository        Repository
	viewRepository    CanvasViewRepository
	covers            applicationcoverimage.Store
	ids               IDGenerator
	clock             Clock
	canvas_nodes      *CanvasNodeService
	transactions      TransactionManager
	fallbackFrames    FallbackFrameRepository
	fallbackCovers    FallbackCoverPreviewer
	fallbackFailure   FallbackCoverFailureReporter
	projectStatistics applicationprojectstatistics.Projector
	storageQuota      StorageQuota
}

type Option func(*Service)

func WithCanvasNodes(canvas_nodes *CanvasNodeService, transactions TransactionManager) Option {
	return func(service *Service) {
		if canvas_nodes != nil {
			service.canvas_nodes = canvas_nodes
		}
		if transactions != nil {
			service.transactions = transactions
		}
	}
}

func WithFallbackCovers(
	frames FallbackFrameRepository,
	previewer FallbackCoverPreviewer,
	reporter FallbackCoverFailureReporter,
) Option {
	return func(service *Service) {
		service.fallbackFrames = frames
		service.fallbackCovers = previewer
		if reporter != nil {
			service.fallbackFailure = reporter
		}
	}
}

func WithProjectStatistics(projector applicationprojectstatistics.Projector) Option {
	return func(service *Service) { service.projectStatistics = projector }
}

func WithStorageQuota(quota StorageQuota, transactions TransactionManager) Option {
	return func(service *Service) {
		if quota != nil {
			service.storageQuota = quota
		}
		if transactions != nil {
			service.transactions = transactions
		}
	}
}

func NewService(repository Repository, covers applicationcoverimage.Store, ids IDGenerator, clock Clock, options ...Option) *Service {
	service := &Service{
		repository: repository, covers: covers, ids: ids, clock: clock,
		transactions:    directTransactionManager{},
		fallbackFailure: noopFallbackCoverFailureReporter{},
	}
	service.viewRepository = repository
	for _, option := range options {
		option(service)
	}
	return service
}

type CreateInput struct {
	Scope
	ProjectID            string
	Name                 string
	CoverImageAssetID    *string
	CoverImageRevisionID *string
}

type GetInput struct {
	Scope
	ProjectID string
	CanvasID  string
}

type BatchGetInput struct {
	Scope
	ProjectID string
	CanvasIDs []string
}

type ListInput struct {
	Scope
	ProjectID     string
	CreatedByMe   bool
	Keyword       string
	SortDirection SortDirection
	Page          Page
}

type UpdateInput struct {
	Scope
	ProjectID            string
	CanvasID             string
	Name                 string
	CoverImageAssetID    *string
	CoverImageRevisionID *string
}

type UpdateViewInput struct {
	Scope
	ProjectID   string
	CanvasID    string
	DefaultView *domaincanvas.ViewMode
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

type DeleteInput struct {
	Scope
	ProjectID string
	CanvasID  string
}

type DeleteByProjectInput struct {
	Scope
	ProjectID string
}

func (s *Service) Create(ctx context.Context, input CreateInput) (domaincanvas.Canvas, error) {
	if !isValidScope(input.Scope) || input.ProjectID == "" {
		return domaincanvas.Canvas{}, errno.New(errno.ErrInvalidArgument)
	}
	id, err := s.ids.NewID()
	if err != nil {
		return domaincanvas.Canvas{}, errno.Wrap(errno.ErrInternalError, err)
	}
	created, err := domaincanvas.New(domaincanvas.NewInput{
		ID: id, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID,
		ProjectID: input.ProjectID, Name: input.Name, CoverImageAssetID: valueOrEmpty(input.CoverImageAssetID), CoverImageRevisionID: valueOrEmpty(input.CoverImageRevisionID),
		CreatedBy: input.CallerID, Now: s.clock.Now(),
	})
	if err != nil {
		return domaincanvas.Canvas{}, classifyDomainError(err)
	}
	registration, err := s.registerCoverImage(ctx, input.Scope, &created)
	if err != nil {
		return domaincanvas.Canvas{}, err
	}
	reservation, err := s.reserveCoverStorage(ctx, created, registration)
	if err != nil {
		return domaincanvas.Canvas{}, errors.Join(err, s.releaseCoverImage(ctx, registration))
	}
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if createErr := s.repository.Create(txCtx, created); createErr != nil {
			return createErr
		}
		if registration != nil {
			if claimErr := s.covers.EnsureActive(txCtx, *registration); claimErr != nil {
				return claimErr
			}
		}
		if reservation.ID != "" {
			return s.storageQuota.CommitStorage(
				txCtx, reservation, canvasCoverStorageObject(created),
			)
		}
		return nil
	})
	if err != nil {
		err = errors.Join(
			err,
			s.releaseCoverImage(ctx, registration),
			s.releaseStorageReservation(ctx, reservation),
		)
		return domaincanvas.Canvas{}, classifyRepositoryError(err)
	}
	s.refreshProjectStatistics(ctx, input.Scope, input.ProjectID, applicationprojectstatistics.CanvasCountField)
	created = s.enrichedCoverImage(ctx, created)
	return created, nil
}

func (s *Service) Get(ctx context.Context, input GetInput) (domaincanvas.Canvas, error) {
	if !isValidTarget(input.Scope, input.ProjectID, input.CanvasID) {
		return domaincanvas.Canvas{}, errno.New(errno.ErrInvalidArgument)
	}
	item, err := s.repository.Get(ctx, input.Scope, input.ProjectID, input.CanvasID)
	if err != nil {
		return domaincanvas.Canvas{}, classifyRepositoryError(err)
	}
	item = s.enrichedCoverImage(ctx, item)
	return item, nil
}

func (s *Service) BatchGet(ctx context.Context, input BatchGetInput) ([]domaincanvas.Canvas, error) {
	ids, valid := normalizeBatchIDs(input.CanvasIDs)
	if !isValidScope(input.Scope) || input.ProjectID == "" || !valid {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	if len(ids) == 0 {
		return []domaincanvas.Canvas{}, nil
	}
	items, err := s.repository.BatchGet(ctx, input.Scope, input.ProjectID, ids)
	if err != nil {
		return nil, classifyRepositoryError(err)
	}
	items = orderCanvases(items, ids)
	s.enrichCoverImages(ctx, items)
	return items, nil
}

func (s *Service) List(ctx context.Context, input ListInput) ([]domaincanvas.Canvas, int64, error) {
	if !isValidScope(input.Scope) || input.ProjectID == "" || input.Page.PageSize < 1 || input.Page.PageSize > maxPageSize || input.Page.PageNum < 1 {
		return nil, 0, errno.New(errno.ErrInvalidArgument)
	}
	direction := input.SortDirection
	if direction == SortUnspecified {
		direction = SortDescending
	}
	if direction != SortAscending && direction != SortDescending {
		return nil, 0, errno.New(errno.ErrInvalidArgument)
	}
	createdBy := ""
	if input.CreatedByMe {
		createdBy = input.CallerID
	}
	items, total, err := s.repository.List(ctx, ListQuery{
		TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, ProjectID: input.ProjectID,
		CreatedBy: createdBy, Keyword: input.Keyword, SortDirection: direction,
		PageSize: input.Page.PageSize, PageNum: input.Page.PageNum,
	})
	if err != nil {
		return nil, 0, classifyRepositoryError(err)
	}
	s.enrichFallbackCovers(ctx, input.Scope, input.ProjectID, items)
	s.enrichCoverImages(ctx, items)
	return items, total, nil
}

func (s *Service) enrichFallbackCovers(ctx context.Context, scope Scope, projectID string, items []domaincanvas.Canvas) {
	if s.fallbackFrames == nil || s.fallbackCovers == nil {
		return
	}
	canvasIDs := make([]string, 0, len(items))
	for index := range items {
		if strings.TrimSpace(items[index].CoverImageRevisionID) == "" {
			canvasIDs = append(canvasIDs, items[index].ID)
		}
	}
	if len(canvasIDs) == 0 {
		return
	}
	assetByCanvas, err := s.fallbackFrames.BatchFirstFrameAssets(ctx, scope, projectID, canvasIDs)
	if err != nil {
		s.fallbackFailure.ReportFallbackCoverFailure(ctx, scope.TenantID, "batch_first_frame_asset_ids", err)
		return
	}
	references := make([]applicationasset.AssetReference, 0, len(assetByCanvas))
	for _, canvasID := range canvasIDs {
		frame := assetByCanvas[canvasID]
		if strings.TrimSpace(frame.AssetID) != "" && strings.TrimSpace(frame.TaskRunID) != "" {
			references = append(references, applicationasset.AssetReference{Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationFirstFrame, Key: frame.TaskRunID}, AssetID: frame.AssetID})
		}
	}
	if len(references) == 0 {
		return
	}
	presigned, previewErr := s.fallbackCovers.BatchPresignReferencedAssets(ctx, applicationasset.BatchGetReferencedAssetsInput{
		Scope:      applicationasset.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID},
		References: references,
	})
	if previewErr != nil {
		s.fallbackFailure.ReportFallbackCoverFailure(ctx, scope.TenantID, "batch_presign_fallback_covers", previewErr)
	}
	previewURLs := make(map[applicationasset.AssetReference]string, len(presigned))
	for _, item := range presigned {
		previewURLs[item.Reference] = item.URL
	}
	for index := range items {
		frame := assetByCanvas[items[index].ID]
		reference := applicationasset.AssetReference{Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationFirstFrame, Key: frame.TaskRunID}, AssetID: frame.AssetID}
		if previewURL := strings.TrimSpace(previewURLs[reference]); previewURL != "" {
			items[index].FallbackCoverImageURL = previewURL
		} else if frame.AssetID != "" && previewErr == nil {
			s.fallbackFailure.ReportFallbackCoverFailure(
				ctx,
				scope.TenantID,
				"missing_fallback_cover_preview",
				errors.New("fallback cover asset presign response omitted an item"),
			)
		}
	}
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (domaincanvas.Canvas, error) {
	if !isValidTarget(input.Scope, input.ProjectID, input.CanvasID) {
		return domaincanvas.Canvas{}, errno.New(errno.ErrInvalidArgument)
	}
	current, err := s.repository.Get(ctx, input.Scope, input.ProjectID, input.CanvasID)
	if err != nil {
		return domaincanvas.Canvas{}, classifyRepositoryError(err)
	}
	previousRegistration := coverImageRegistration(current)
	if err := current.Update(input.Name, input.CoverImageAssetID, input.CoverImageRevisionID, s.clock.Now()); err != nil {
		return domaincanvas.Canvas{}, classifyDomainError(err)
	}
	var newRegistration *applicationcoverimage.Registration
	if input.CoverImageRevisionID != nil && current.CoverImageRevisionID != "" && current.CoverImageSHA256 == "" {
		newRegistration, err = s.registerCoverImage(ctx, input.Scope, &current)
		if err != nil {
			return domaincanvas.Canvas{}, err
		}
	}
	reservation, err := s.reserveCoverStorage(ctx, current, newRegistration)
	if err != nil {
		return domaincanvas.Canvas{}, errors.Join(err, s.releaseCoverImage(ctx, newRegistration))
	}
	replacesPrevious := previousRegistration != nil &&
		(current.CoverImageRevisionID == "" || current.CoverImageRevisionID != previousRegistration.Revision.RevisionID)
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if updateErr := s.repository.Update(txCtx, current); updateErr != nil {
			return updateErr
		}
		if newRegistration != nil {
			if claimErr := s.covers.EnsureActive(txCtx, *newRegistration); claimErr != nil {
				return claimErr
			}
		}
		if reservation.ID != "" {
			if commitErr := s.storageQuota.CommitStorage(
				txCtx, reservation, canvasCoverStorageObject(current),
			); commitErr != nil {
				return commitErr
			}
		}
		if replacesPrevious {
			return s.markCoverReleasing(txCtx, input.TenantID, previousRegistration)
		}
		return nil
	})
	if err != nil {
		err = errors.Join(
			err,
			s.releaseCoverImage(ctx, newRegistration),
			s.releaseStorageReservation(ctx, reservation),
		)
		return domaincanvas.Canvas{}, classifyRepositoryError(err)
	}
	current = s.enrichedCoverImage(ctx, current)
	return current, nil
}

func (s *Service) enrichCoverImages(ctx context.Context, canvases []domaincanvas.Canvas) {
	if s.covers == nil {
		return
	}
	registrations := make([]applicationcoverimage.Registration, 0, len(canvases))
	for _, canvas := range canvases {
		if registration := coverImageRegistration(canvas); registration != nil {
			registrations = append(registrations, *registration)
		}
	}
	urls, err := s.covers.Presign(ctx, registrations)
	if err != nil {
		return
	}
	for index := range canvases {
		canvases[index].CoverImageURL = urls[canvases[index].CoverImageAssetID]
	}
}

func (s *Service) enrichedCoverImage(ctx context.Context, canvas domaincanvas.Canvas) domaincanvas.Canvas {
	canvases := []domaincanvas.Canvas{canvas}
	s.enrichCoverImages(ctx, canvases)
	return canvases[0]
}

func (s *Service) UpdateView(ctx context.Context, input UpdateViewInput) error {
	if !isValidTarget(input.Scope, input.ProjectID, input.CanvasID) || input.DefaultView == nil {
		return errno.New(errno.ErrInvalidArgument)
	}
	if !input.DefaultView.Valid() {
		return errno.New(errno.ErrInvalidArgument)
	}
	if s.viewRepository == nil {
		return errno.New(errno.ErrConfigurationError)
	}
	err := s.viewRepository.UpdateView(
		ctx, input.Scope, input.ProjectID, input.CanvasID,
		input.DefaultView,
	)
	if err != nil {
		return classifyRepositoryError(err)
	}
	return nil
}

func (s *Service) Delete(ctx context.Context, input DeleteInput) error {
	if !isValidTarget(input.Scope, input.ProjectID, input.CanvasID) {
		return errno.New(errno.ErrInvalidArgument)
	}
	current, err := s.repository.Get(ctx, input.Scope, input.ProjectID, input.CanvasID)
	if err != nil {
		return classifyRepositoryError(err)
	}
	registration := coverImageRegistration(current)
	now := s.clock.Now()
	if err := current.Delete(now); err != nil {
		return classifyDomainError(err)
	}
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if deleteErr := s.repository.Delete(txCtx, current); deleteErr != nil {
			return deleteErr
		}
		if err := s.markCoverReleasing(txCtx, input.TenantID, registration); err != nil {
			return err
		}
		return s.enqueueCanvasCleanup(
			txCtx, input.Scope, input.ProjectID, input.CanvasID, current.Revision, now,
		)
	})
	if err != nil {
		return classifyAggregateError(err)
	}
	s.refreshProjectStatistics(
		ctx, input.Scope, input.ProjectID,
		applicationprojectstatistics.CanvasCountField|applicationprojectstatistics.SelectedVideoDurationField,
	)
	return nil
}

func (s *Service) refreshProjectStatistics(ctx context.Context, scope Scope, projectID string, fields applicationprojectstatistics.Fields) {
	if s.projectStatistics != nil {
		projectCtx := logcontext.WithBusiness(ctx, logcontext.Business{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ProjectID: projectID,
		})
		s.projectStatistics.Refresh(projectCtx, applicationprojectstatistics.Scope{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		}, projectID, fields)
	}
}

func (s *Service) DeleteByProject(ctx context.Context, input DeleteByProjectInput) error {
	if !isValidScope(input.Scope) || input.ProjectID == "" {
		return errno.New(errno.ErrInvalidArgument)
	}
	now := s.clock.Now()
	var targets []DeletionTarget
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		var deleteErr error
		targets, deleteErr = s.repository.DeleteByProject(txCtx, input.Scope, input.ProjectID, now)
		if deleteErr != nil {
			return deleteErr
		}
		for _, target := range targets {
			if markErr := s.markCoverReleasing(txCtx, input.TenantID, target.Cover); markErr != nil {
				return markErr
			}
			if enqueueErr := s.enqueueCanvasCleanup(
				txCtx, input.Scope, input.ProjectID, target.CanvasID, target.Revision, now,
			); enqueueErr != nil {
				return enqueueErr
			}
		}
		return nil
	})
	if err != nil {
		return classifyAggregateError(err)
	}
	return nil
}

type noopFallbackCoverFailureReporter struct{}

func (noopFallbackCoverFailureReporter) ReportFallbackCoverFailure(context.Context, string, string, error) {
}

func (s *Service) registerCoverImage(
	ctx context.Context,
	scope Scope,
	canvas *domaincanvas.Canvas,
) (*applicationcoverimage.Registration, error) {
	if canvas.CoverImageRevisionID == "" || canvas.CoverImageAssetID == "" {
		return nil, nil
	}
	generation := canvas.CoverImageClaimGeneration + 1
	registration, err := s.covers.Register(ctx, applicationcoverimage.RegisterInput{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, UserID: scope.CallerID, OwnerType: "canvas_cover", OwnerID: canvas.ID, Generation: generation, Revision: applicationcoverimage.RevisionRef{AssetID: canvas.CoverImageAssetID, RevisionID: canvas.CoverImageRevisionID}})
	if err != nil {
		if errors.Is(err, applicationcoverimage.ErrTooLarge) {
			return nil, errno.Wrap(errno.ErrCoverImageTooLarge, err)
		}
		if errors.Is(err, applicationcoverimage.ErrUnsupportedFormat) ||
			errors.Is(err, applicationcoverimage.ErrInvalidReference) {
			return nil, errno.Wrap(errno.ErrInvalidArgument, err)
		}
		if errors.Is(err, applicationcoverimage.ErrIDGeneration) {
			return nil, preserveOrWrap(err, errno.ErrInternalError)
		}
		return nil, preserveOrWrap(err, errno.ErrObjectStorageDependencyError)
	}
	if registration.Revision.AssetID != canvas.CoverImageAssetID || registration.Revision.RevisionID != canvas.CoverImageRevisionID || registration.SHA256 == "" {
		return nil, errors.Join(
			errno.New(errno.ErrObjectStorageDependencyError),
			s.releaseCoverImage(ctx, &registration),
		)
	}
	canvas.CoverImageAssetID = registration.Revision.AssetID
	canvas.CoverImageRevisionID = registration.Revision.RevisionID
	canvas.CoverImageSHA256 = registration.SHA256
	canvas.CoverImageContentType = registration.ContentType
	canvas.CoverImageSizeBytes = registration.SizeBytes
	canvas.CoverImageClaimGeneration = registration.Generation
	return &registration, nil
}

func coverImageRegistration(canvas domaincanvas.Canvas) *applicationcoverimage.Registration {
	if canvas.CoverImageRevisionID == "" || canvas.CoverImageAssetID == "" || canvas.CoverImageSHA256 == "" {
		return nil
	}
	return &applicationcoverimage.Registration{
		TenantID: canvas.TenantID, WorkspaceID: canvas.WorkspaceID, Revision: applicationcoverimage.RevisionRef{AssetID: canvas.CoverImageAssetID, RevisionID: canvas.CoverImageRevisionID}, OwnerType: "canvas_cover", OwnerID: canvas.ID, Generation: canvas.CoverImageClaimGeneration,
		SHA256: canvas.CoverImageSHA256, ContentType: canvas.CoverImageContentType,
		SizeBytes: canvas.CoverImageSizeBytes,
	}
}

func (s *Service) reserveCoverStorage(
	ctx context.Context,
	canvas domaincanvas.Canvas,
	registration *applicationcoverimage.Registration,
) (applicationquota.Reservation, error) {
	if s.storageQuota == nil || registration == nil {
		return applicationquota.Reservation{}, nil
	}
	reservation, err := s.storageQuota.ReserveStorage(
		ctx, canvas.TenantID, applicationcoverimage.QuotaObjectType,
		applicationcoverimage.LifecycleKey(registration.OwnerType, registration.OwnerID, registration.Generation),
		"canvas_cover", canvas.ID, registration.SizeBytes,
	)
	if err != nil {
		return applicationquota.Reservation{}, classifyStorageQuotaError(err)
	}
	return reservation, nil
}

func canvasCoverStorageObject(canvas domaincanvas.Canvas) applicationquota.StorageObject {
	return applicationquota.StorageObject{
		TenantID: canvas.TenantID, WorkspaceID: canvas.WorkspaceID,
		ObjectType: applicationcoverimage.QuotaObjectType,
		ObjectKey:  applicationcoverimage.LifecycleKey("canvas_cover", canvas.ID, canvas.CoverImageClaimGeneration),
		Category:   "canvas_cover",
		OwnerType:  "canvas_cover", OwnerID: canvas.ID,
		SizeBytes: canvas.CoverImageSizeBytes, BillingClass: applicationquota.BillingBillable,
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
		if _, err := s.storageQuota.MarkStorageReleasing(
			ctx,
			applicationcoverimage.QuotaObjectType,
			applicationcoverimage.LifecycleKey(registration.OwnerType, registration.OwnerID, registration.Generation),
		); err != nil {
			return err
		}
	}
	return s.deletion.Enqueue(
		ctx,
		tenantID,
		applicationcoverimage.CleanupJobKind,
		applicationcoverimage.LifecycleKey(registration.OwnerType, registration.OwnerID, registration.Generation),
		registration,
	)
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
	if registration == nil || !registration.Revision.Valid() || registration.SHA256 == "" {
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

func isValidScope(scope Scope) bool {
	return scope.TenantID != "" && scope.CallerID != ""
}

func isValidTarget(scope Scope, projectID, canvasID string) bool {
	return isValidScope(scope) && projectID != "" && canvasID != ""
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

func orderCanvases(items []domaincanvas.Canvas, ids []string) []domaincanvas.Canvas {
	byID := make(map[string]domaincanvas.Canvas, len(items))
	for _, item := range items {
		byID[item.ID] = item
	}
	ordered := make([]domaincanvas.Canvas, 0, len(ids))
	for _, id := range ids {
		if item, exists := byID[id]; exists {
			ordered = append(ordered, item)
		}
	}
	return ordered
}

func classifyDomainError(err error) error {
	switch {
	case errors.Is(err, domaincanvas.ErrInvalidName), errors.Is(err, domaincanvas.ErrInvalidCoverImageReference):
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
		return errno.Wrap(errno.ErrCanvasNameAlreadyExists, err)
	case errors.Is(err, ErrLimitExceeded):
		return errno.Wrap(errno.ErrCanvasLimitExceeded, err)
	case errors.Is(err, ErrRevisionConflict):
		return errno.Wrap(errno.ErrConflict, err)
	default:
		return preserveOrWrap(err, errno.ErrPersistenceError)
	}
}

func classifyAggregateError(err error) error {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrNameConflict), errors.Is(err, ErrLimitExceeded):
		return classifyRepositoryError(err)
	default:
		return classify(err)
	}
}

func preserveOrWrap(err error, code errno.ErrorCode) error {
	var bizErr *errno.BizError
	if errors.As(err, &bizErr) {
		return err
	}
	return errno.Wrap(code, err)
}
