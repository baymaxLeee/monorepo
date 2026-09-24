package asset

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	applicationassetclaim "github.com/example/monorepo/canvas/internal/application/assetclaim"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const (
	maxBatchGetIDs               = 100
	maxListByOwner               = 200
	maxCreateManyItems           = 10
	assetNotFoundCode            = "AssetNotFound"
	missingArtifactCode          = "MissingArtifact"
	artifactPresignFailedCode    = "ArtifactPresignFailed"
	assetNotFoundMessage         = "asset not found"
	assetHasNoArtifactMessage    = "asset has no artifact"
	artifactMissingMessage       = "artifact is missing"
	artifactPresignFailedMessage = "failed to presign artifact"
	reviewCleanupTimeout         = 10 * time.Second
)

type Service struct {
	repository      Repository
	owners          OwnerResolver
	revisions       RevisionStore
	ids             IDGenerator
	clock           Clock
	referenceStore  ReferenceStore
	reviews         ReviewReader
	reviewCleaner   ReviewCleanupPreparer
	cleanupFailures ReviewCleanupFailureReporter
	storageQuota    StorageQuota
	transactions    TransactionManager
	claimIntents    ClaimIntentStore
}

type Option func(*Service)

func WithReferenceStore(store ReferenceStore) Option {
	return func(service *Service) { service.referenceStore = store }
}

func WithReviewReader(reader ReviewReader) Option {
	return func(service *Service) { service.reviews = reader }
}

func WithReviewCleanup(cleaner ReviewCleanupPreparer, reporter ReviewCleanupFailureReporter) Option {
	return func(service *Service) {
		service.reviewCleaner = cleaner
		service.cleanupFailures = reporter
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

func WithClaimIntents(store ClaimIntentStore, transactions TransactionManager) Option {
	return func(service *Service) {
		if store != nil && transactions != nil {
			service.claimIntents = store
			service.transactions = transactions
		}
	}
}

func NewService(repository Repository, owners OwnerResolver, revisions RevisionStore, ids IDGenerator, clock Clock, options ...Option) *Service {
	service := &Service{repository: repository, owners: owners, revisions: revisions, ids: ids, clock: clock}
	for _, option := range options {
		option(service)
	}
	return service
}

type CreateInput struct {
	Scope
	ProjectID        *string
	OwnerType        domainasset.OwnerType
	OwnerID          string
	CreationKey      string
	SourceAssetID    string
	SourceRevisionID string
	FileName         string
}

type CreateFromArtifactInput struct {
	Scope
	SourceRevisionID string
	OwnerType        domainasset.OwnerType
	OwnerID          string
	CreationKey      string
	SourceAssetID    string
	FileName         string
	MediaType        domainasset.MediaType
	ContentType      string
	SizeBytes        int64
}

type CreateManyItem struct {
	SourceAssetID    string
	SourceRevisionID string
	FileName         string
}

type CreateManyInput struct {
	Scope
	ProjectID *string
	OwnerType domainasset.OwnerType
	OwnerID   string
	Items     []CreateManyItem
}

type CreateManyResult struct {
	Asset domainasset.Asset
	Err   error
}

type PrepareCreateItem struct {
	SourceAssetID    string
	SourceRevisionID string
	FileName         string
}

type PreparedCreate struct {
	Scope            Scope
	ProjectID        *string
	ID               string
	OwnerType        domainasset.OwnerType
	OwnerID          string
	SourceAssetID    string
	SourceRevisionID string
	FileName         string
	MediaType        domainasset.MediaType
	ContentType      string
	SizeBytes        int64
	CreatedAt        time.Time
}

type GetInput struct {
	Scope
	Owner   ReferenceOwner
	AssetID string
}

type BatchGetInput struct {
	Scope
	Owner    ReferenceOwner
	AssetIDs []string
}

type BypassGetInput struct {
	Scope
	AssetID string
}

type BypassBatchGetInput struct {
	Scope
	AssetIDs []string
}

type AssetReference struct {
	Owner   ReferenceOwner
	AssetID string
}

type ReferencedAsset struct {
	Reference AssetReference
	Asset     domainasset.Asset
}

type BatchGetReferencedAssetsInput struct {
	Scope
	References []AssetReference
}

type PresignedAsset struct {
	AssetID      string
	Asset        domainasset.Asset
	URL          string
	ExpiresAt    time.Time
	ErrorCode    string
	ErrorMessage string
}

type PresignedReferencedAsset struct {
	Reference    AssetReference
	Asset        domainasset.Asset
	URL          string
	ExpiresAt    time.Time
	ErrorCode    string
	ErrorMessage string
}

type DeleteByOwnerInput struct {
	Scope
	OwnerType domainasset.OwnerType
	OwnerID   string
}

type ListByOwnerInput struct {
	Scope
	OwnerType domainasset.OwnerType
	OwnerID   string
	Limit     int
}

func (s *Service) Create(ctx context.Context, input CreateInput) (domainasset.Asset, error) {
	item, _, err := s.CreateIdempotent(ctx, input)
	return item, err
}

func (s *Service) PrepareResourceOwnedCreates(ctx context.Context, scope Scope, projectID *string, resourceID string, items []PrepareCreateItem) ([]PreparedCreate, error) {
	scope = normalizeScope(scope)
	if !isValidScope(scope) || strings.TrimSpace(resourceID) == "" || len(items) == 0 {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	prepared := make([]PreparedCreate, 0, len(items))
	createdAt := s.clock.Now()
	for _, item := range items {
		if strings.TrimSpace(item.SourceAssetID) == "" || strings.TrimSpace(item.SourceRevisionID) == "" || strings.TrimSpace(item.FileName) == "" {
			return nil, errno.New(errno.ErrInvalidArgument)
		}
		id, err := s.ids.NewID()
		if err != nil {
			return nil, errno.Wrap(errno.ErrInternalError, err)
		}
		resolved, err := s.revisions.Resolve(ctx, scope.TenantID, workspaceValue(scope.WorkspaceID), RevisionRef{SourceAssetID: item.SourceAssetID, SourceRevisionID: item.SourceRevisionID})
		if err != nil {
			return nil, classifyArtifactError(err)
		}
		if !resolved.MediaType.Valid() || strings.TrimSpace(resolved.ContentType) == "" {
			return nil, errno.New(errno.ErrUnsupportedAssetFormat)
		}
		if resolved.Category != "canvas-source" || resolved.CreatedBy != scope.CallerID {
			return nil, errno.New(errno.ErrForbidden)
		}
		prepared = append(prepared, PreparedCreate{
			Scope: scope, ProjectID: projectID, ID: id, OwnerType: domainasset.OwnerResource, OwnerID: resourceID,
			SourceAssetID: item.SourceAssetID, SourceRevisionID: item.SourceRevisionID, FileName: item.FileName, MediaType: resolved.MediaType,
			ContentType: resolved.ContentType, SizeBytes: resolved.SizeBytes, CreatedAt: createdAt,
		})
	}
	return prepared, nil
}

func (s *Service) RegisterPreparedCreates(ctx context.Context, prepared []PreparedCreate) ([]domainasset.Asset, error) {
	if len(prepared) == 0 {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	scope := normalizeScope(prepared[0].Scope)
	for _, item := range prepared {
		if !isValidScope(scope) || !sameScope(scope, normalizeScope(item.Scope)) || strings.TrimSpace(item.ID) == "" ||
			item.OwnerType != domainasset.OwnerResource || strings.TrimSpace(item.OwnerID) == "" ||
			strings.TrimSpace(item.SourceAssetID) == "" || strings.TrimSpace(item.SourceRevisionID) == "" || strings.TrimSpace(item.FileName) == "" ||
			!item.MediaType.Valid() || strings.TrimSpace(item.ContentType) == "" || item.SizeBytes <= 0 || item.CreatedAt.IsZero() {
			return nil, errno.New(errno.ErrInvalidArgument)
		}
	}
	assets := make([]domainasset.Asset, 0, len(prepared))
	for index := range prepared {
		limit, _ := prepared[index].MediaType.SizeLimitBytes()
		if prepared[index].SizeBytes > limit {
			return nil, errno.New(errno.ErrAssetTooLarge)
		}
		item := prepared[index]
		assetItem, err := domainasset.New(domainasset.NewInput{
			ID: item.ID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
			OwnerType: item.OwnerType, OwnerID: item.OwnerID, SourceAssetID: item.SourceAssetID,
			SourceRevisionID: item.SourceRevisionID,
			FileName:         item.FileName, MediaType: item.MediaType, ContentType: item.ContentType,
			SizeBytes: item.SizeBytes, CreatedBy: scope.CallerID, Now: item.CreatedAt,
		})
		if err != nil {
			return nil, errno.Wrap(errno.ErrInternalError, err)
		}
		assets = append(assets, assetItem)
	}
	return assets, nil
}

func (s *Service) PersistPreparedCreates(ctx context.Context, assets []domainasset.Asset) error {
	if len(assets) == 0 {
		return errno.New(errno.ErrInvalidArgument)
	}
	first := assets[0]
	scope := normalizeScope(Scope{TenantID: first.TenantID, WorkspaceID: first.WorkspaceID, CallerID: first.CreatedBy})
	if !isValidScope(scope) || first.OwnerType != domainasset.OwnerResource || strings.TrimSpace(first.OwnerID) == "" {
		return errno.New(errno.ErrInvalidArgument)
	}
	for _, item := range assets {
		itemScope := normalizeScope(Scope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID, CallerID: item.CreatedBy})
		if !sameScope(scope, itemScope) || item.OwnerType != first.OwnerType || item.OwnerID != first.OwnerID {
			return errno.New(errno.ErrInvalidArgument)
		}
	}
	if err := s.owners.ValidateForUpdate(ctx, scope, first.OwnerType, first.OwnerID); err != nil {
		return classifyOwnerError(err)
	}
	persist := func(txCtx context.Context) error {
		for _, item := range assets {
			var reservation applicationquota.Reservation
			var err error
			billingClass := assetBillingClass(item)
			if s.storageQuota != nil && billingClass == domainasset.BillingBillable {
				reservation, err = s.storageQuota.ReserveStorage(
					txCtx,
					item.TenantID,
					"canvas_asset",
					item.ID,
					"asset",
					item.ID,
					item.SizeBytes,
				)
				if err != nil {
					return classifyStorageQuotaError(err)
				}
			}
			if err = s.repository.Create(txCtx, item); err != nil {
				return classifyRepositoryError(err)
			}
			if err = s.ensureClaimActive(txCtx, item); err != nil {
				return err
			}
			if reservation.ID != "" {
				if err = s.storageQuota.CommitStorage(
					txCtx, reservation, storageObjectForAsset(item),
				); err != nil {
					return classifyStorageQuotaError(err)
				}
			} else if s.storageQuota != nil {
				if err = s.storageQuota.RecordStorage(
					txCtx, storageObjectForAsset(item),
				); err != nil {
					return classifyStorageQuotaError(err)
				}
			}
		}
		return nil
	}
	if s.transactions != nil {
		return s.transactions.WithinTransaction(ctx, persist)
	}
	return persist(ctx)
}

func (s *Service) CreateIdempotent(ctx context.Context, input CreateInput) (domainasset.Asset, bool, error) {
	scope := normalizeScope(input.Scope)
	if !isValidCreateInput(scope, input) {
		return domainasset.Asset{}, false, errno.New(errno.ErrInvalidArgument)
	}
	if err := s.owners.Validate(ctx, scope, input.OwnerType, input.OwnerID); err != nil {
		return domainasset.Asset{}, false, classifyOwnerError(err)
	}
	creationKey := strings.TrimSpace(input.CreationKey)
	if creationKey != "" {
		existing, getErr := s.repository.GetByCreationKey(ctx, scope, input.OwnerType, input.OwnerID, creationKey)
		switch {
		case getErr == nil:
			return existing, false, nil
		case !errors.Is(getErr, ErrNotFound):
			return domainasset.Asset{}, false, classifyRepositoryError(getErr)
		}
	}
	id, err := s.ids.NewID()
	if err != nil {
		return domainasset.Asset{}, false, errno.Wrap(errno.ErrInternalError, err)
	}
	resolved, err := s.revisions.Resolve(ctx, scope.TenantID, workspaceValue(scope.WorkspaceID), RevisionRef{
		SourceAssetID: input.SourceAssetID, SourceRevisionID: input.SourceRevisionID,
	})
	if err != nil {
		return domainasset.Asset{}, false, classifyArtifactError(err)
	}
	if !resolved.MediaType.Valid() || strings.TrimSpace(resolved.ContentType) == "" || resolved.SizeBytes <= 0 {
		return domainasset.Asset{}, false, errno.New(errno.ErrUnsupportedAssetFormat)
	}
	if resolved.Category != "canvas-source" || resolved.CreatedBy != scope.CallerID {
		return domainasset.Asset{}, false, errno.New(errno.ErrForbidden)
	}
	limit, _ := resolved.MediaType.SizeLimitBytes()
	if resolved.SizeBytes > limit {
		return domainasset.Asset{}, false, errno.New(errno.ErrAssetTooLarge)
	}
	item, err := domainasset.New(domainasset.NewInput{
		ID: id, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		OwnerType: input.OwnerType, OwnerID: input.OwnerID, CreationKey: creationKey,
		SourceAssetID: input.SourceAssetID, SourceRevisionID: input.SourceRevisionID,
		FileName: input.FileName, MediaType: resolved.MediaType, ContentType: resolved.ContentType,
		SizeBytes: resolved.SizeBytes, CreatedBy: scope.CallerID, Now: s.clock.Now(),
	})
	if err != nil {
		return domainasset.Asset{}, false, errno.Wrap(errno.ErrInternalError, err)
	}
	var reservation applicationquota.Reservation
	if s.storageQuota != nil {
		reservation, err = s.storageQuota.ReserveStorage(
			ctx, scope.TenantID, "canvas_asset", item.ID, "asset", item.ID, item.SizeBytes,
		)
		if err != nil {
			return domainasset.Asset{}, false, classifyStorageQuotaError(err)
		}
	}
	persist := func(txCtx context.Context) error {
		if createErr := s.repository.Create(txCtx, item); createErr != nil {
			return createErr
		}
		if claimErr := s.ensureClaimActive(txCtx, item); claimErr != nil {
			return claimErr
		}
		if reservation.ID == "" {
			return nil
		}
		return s.storageQuota.CommitStorage(txCtx, reservation, storageObjectForAsset(item))
	}
	if s.transactions != nil {
		err = s.transactions.WithinTransaction(ctx, persist)
	} else {
		err = persist(ctx)
	}
	if err != nil {
		if creationKey != "" {
			existing, getErr := s.repository.GetByCreationKey(ctx, scope, input.OwnerType, input.OwnerID, creationKey)
			if getErr == nil {
				if reservation.ID != "" {
					if releaseErr := s.storageQuota.ReleaseReservation(context.WithoutCancel(ctx), reservation); releaseErr != nil {
						return domainasset.Asset{}, false, classifyStorageQuotaError(releaseErr)
					}
				}
				return existing, false, nil
			}
		}
		primary := classifyRepositoryError(err)
		if reservation.ID != "" {
			primary = errors.Join(
				primary, s.storageQuota.ReleaseReservation(context.WithoutCancel(ctx), reservation),
			)
		}
		return domainasset.Asset{}, false, primary
	}
	return item, true, nil
}

func storageObjectForAsset(item domainasset.Asset) applicationquota.StorageObject {
	return applicationquota.StorageObject{
		TenantID: item.TenantID, WorkspaceID: item.WorkspaceID,
		ObjectType: "canvas_asset", ObjectKey: item.ID, Category: "asset",
		OwnerType: "asset", OwnerID: item.ID, SizeBytes: item.SizeBytes,
		BillingClass: string(assetBillingClass(item)),
	}
}

func assetBillingClass(item domainasset.Asset) domainasset.BillingClass {
	if item.BillingClass.Valid() {
		return item.BillingClass
	}
	if item.OwnerType == domainasset.OwnerOfficial {
		return domainasset.BillingBuiltin
	}
	return domainasset.BillingBillable
}

func classifyStorageQuotaError(err error) error {
	switch {
	case errors.Is(err, applicationquota.ErrExceeded):
		return errno.Wrap(errno.ErrStorageQuotaExceeded, err)
	case errors.Is(err, applicationquota.ErrUnavailable):
		return errno.Wrap(errno.ErrQuotaUnavailable, err)
	default:
		return errno.Wrap(errno.ErrPersistenceError, err)
	}
}

// CreateFromArtifact imports an already registered Artifact without assuming
// ownership of its external lifecycle. The caller owns transaction boundaries.
func (s *Service) CreateFromArtifact(ctx context.Context, input CreateFromArtifactInput) (domainasset.Asset, error) {
	billingClass := domainasset.BillingBorrowed
	if input.OwnerType == domainasset.OwnerOfficial {
		billingClass = domainasset.BillingBuiltin
	}
	return s.createFromArtifact(ctx, input, billingClass, false)
}

// CreateFromOwnedArtifact binds an Artifact created for already-admitted
// asynchronous work. Its actual size is accounted without a second limit check.
func (s *Service) CreateFromOwnedArtifact(ctx context.Context, input CreateFromArtifactInput) (domainasset.Asset, error) {
	return s.createFromArtifact(ctx, input, domainasset.BillingBillable, true)
}

func (s *Service) createFromArtifact(
	ctx context.Context,
	input CreateFromArtifactInput,
	billingClass domainasset.BillingClass,
	admitted bool,
) (domainasset.Asset, error) {
	scope := normalizeScope(input.Scope)
	limit, mediaTypeValid := input.MediaType.SizeLimitBytes()
	if !isValidScope(scope) || !input.OwnerType.Valid() || strings.TrimSpace(input.OwnerID) == "" ||
		strings.TrimSpace(input.SourceAssetID) == "" || strings.TrimSpace(input.FileName) == "" ||
		strings.TrimSpace(input.ContentType) == "" || !mediaTypeValid || input.SizeBytes <= 0 || input.SizeBytes > limit {
		return domainasset.Asset{}, errno.New(errno.ErrInvalidArgument)
	}
	if err := s.owners.ValidateForUpdate(ctx, scope, input.OwnerType, input.OwnerID); err != nil {
		return domainasset.Asset{}, classifyOwnerError(err)
	}
	creationKey := strings.TrimSpace(input.CreationKey)
	if creationKey != "" {
		existing, getErr := s.repository.GetByCreationKey(ctx, scope, input.OwnerType, input.OwnerID, creationKey)
		if getErr == nil {
			return existing, nil
		}
		if !errors.Is(getErr, ErrNotFound) {
			return domainasset.Asset{}, classifyRepositoryError(getErr)
		}
	}
	id, err := s.ids.NewID()
	if err != nil {
		return domainasset.Asset{}, errno.Wrap(errno.ErrInternalError, err)
	}
	item, err := domainasset.New(domainasset.NewInput{
		ID: id, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		OwnerType: input.OwnerType, OwnerID: input.OwnerID, CreationKey: creationKey, SourceAssetID: input.SourceAssetID,
		SourceRevisionID: input.SourceRevisionID,
		FileName:         input.FileName, MediaType: input.MediaType, ContentType: input.ContentType,
		SizeBytes: input.SizeBytes, BillingClass: billingClass,
		CreatedBy: scope.CallerID, Now: s.clock.Now(),
	})
	if err != nil {
		return domainasset.Asset{}, errno.Wrap(errno.ErrInternalError, err)
	}
	persist := func(txCtx context.Context) error {
		if createErr := s.repository.Create(txCtx, item); createErr != nil {
			return createErr
		}
		if claimErr := s.ensureClaimActive(txCtx, item); claimErr != nil {
			return claimErr
		}
		if s.storageQuota != nil {
			if admitted {
				return s.storageQuota.RecordAdmittedStorage(txCtx, storageObjectForAsset(item))
			}
			return s.storageQuota.RecordStorage(txCtx, storageObjectForAsset(item))
		}
		return nil
	}
	if s.transactions != nil {
		err = s.transactions.WithinTransaction(ctx, persist)
	} else {
		err = persist(ctx)
	}
	if err != nil {
		if creationKey != "" {
			existing, getErr := s.repository.GetByCreationKey(ctx, scope, input.OwnerType, input.OwnerID, creationKey)
			if getErr == nil {
				return existing, nil
			}
		}
		return domainasset.Asset{}, classifyRepositoryError(err)
	}
	return item, nil
}

func (s *Service) ensureClaimActive(ctx context.Context, item domainasset.Asset) error {
	if s.claimIntents == nil {
		return errors.New("asset claim intent store is not configured")
	}
	return s.claimIntents.EnsureActive(ctx, applicationassetclaim.Intent{
		TenantID: item.TenantID, WorkspaceID: workspaceValue(item.WorkspaceID), OwnerType: "canvas_asset", OwnerID: item.ID, Slot: "source",
		AssetID: item.SourceAssetID, RevisionID: item.SourceRevisionID, Kind: applicationassetclaim.KindStrong, Generation: 1, DesiredState: applicationassetclaim.DesiredActive,
	}, s.clock.Now())
}

func (s *Service) LockOwner(ctx context.Context, scope Scope, ownerType domainasset.OwnerType, ownerID string) error {
	scope = normalizeScope(scope)
	if !isValidScope(scope) || !ownerType.Valid() || strings.TrimSpace(ownerID) == "" {
		return errno.New(errno.ErrInvalidArgument)
	}
	if err := s.owners.ValidateForUpdate(ctx, scope, ownerType, ownerID); err != nil {
		return classifyOwnerError(err)
	}
	return nil
}

// CompensateCreated checks the committed database outside the caller's failed
// transaction: a lost COMMIT acknowledgement must not destroy a live artifact.
func (s *Service) CompensateCreated(ctx context.Context, item domainasset.Asset) error {
	if strings.TrimSpace(item.SourceAssetID) == "" {
		return errno.New(errno.ErrInvalidArgument)
	}
	existing, err := s.repository.GetCommitted(context.WithoutCancel(ctx), Scope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID}, item.ID)
	if err == nil {
		if existing.SourceAssetID == item.SourceAssetID && existing.SourceRevisionID == item.SourceRevisionID {
			return nil
		}
		return errors.New("asset compensation identity mismatch")
	}
	if !errors.Is(err, ErrNotFound) {
		return fmt.Errorf("confirm asset compensation: %w", err)
	}
	// Platform revisions are immutable and may be shared by other products. A
	// failed Canvas transaction never deletes their bytes; the upload-session
	// lease and Asset GC own eventual reclamation.
	return nil
}

func (s *Service) CompensateCreatedMany(ctx context.Context, items []domainasset.Asset, primary error) error {
	result := primary
	for _, item := range items {
		result = errors.Join(result, s.CompensateCreated(ctx, item))
	}
	return result
}

// CreateMany binds immutable platform revisions concurrently. Results remain
// aligned with input order and deliberately allow partial success.
func (s *Service) CreateMany(ctx context.Context, input CreateManyInput) ([]CreateManyResult, error) {
	scope := normalizeScope(input.Scope)
	if !isValidScope(scope) || !input.OwnerType.Valid() || strings.TrimSpace(input.OwnerID) == "" ||
		len(input.Items) < 1 || len(input.Items) > maxCreateManyItems {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	results := make([]CreateManyResult, len(input.Items))
	var group sync.WaitGroup
	for index, item := range input.Items {
		index, item := index, item
		group.Add(1)
		go func() {
			defer group.Done()
			if ctx.Err() != nil {
				results[index].Err = errno.Wrap(errno.ErrRequestTimeout, ctx.Err())
				return
			}
			asset, err := s.Create(ctx, CreateInput{
				Scope: scope, ProjectID: input.ProjectID, OwnerType: input.OwnerType, OwnerID: input.OwnerID,
				SourceAssetID: item.SourceAssetID, SourceRevisionID: item.SourceRevisionID, FileName: item.FileName,
			})
			results[index] = CreateManyResult{Asset: asset, Err: err}
		}()
	}
	group.Wait()
	return results, nil
}

func (s *Service) Get(ctx context.Context, input GetInput) (domainasset.Asset, error) {
	return s.getReferenced(ctx, input, false)
}

// GetForUpdate validates and locks an Asset inside the caller's transaction.
func (s *Service) GetForUpdate(ctx context.Context, input GetInput) (domainasset.Asset, error) {
	return s.getReferenced(ctx, input, true)
}

func (s *Service) getReferenced(ctx context.Context, input GetInput, lock bool) (domainasset.Asset, error) {
	scope := normalizeScope(input.Scope)
	owner, ownerValid := normalizeReferenceOwner(input.Owner)
	if !isValidScope(scope) || strings.TrimSpace(input.AssetID) == "" || !ownerValid {
		return domainasset.Asset{}, errno.New(errno.ErrInvalidArgument)
	}
	item, err := s.repository.GetReferenced(ctx, scope, owner, input.AssetID, lock)
	if err != nil {
		return domainasset.Asset{}, classifyRepositoryError(err)
	}
	if !lock {
		items := []domainasset.Asset{item}
		if err = s.attachReviews(ctx, scope, items); err != nil {
			return domainasset.Asset{}, err
		}
		item = items[0]
	}
	return item, nil
}

func (s *Service) BypassGet(ctx context.Context, input BypassGetInput) (domainasset.Asset, error) {
	scope := normalizeScope(input.Scope)
	if !isValidScope(scope) || strings.TrimSpace(input.AssetID) == "" {
		return domainasset.Asset{}, errno.New(errno.ErrInvalidArgument)
	}
	item, err := s.repository.Get(ctx, scope, input.AssetID)
	if err != nil {
		return domainasset.Asset{}, classifyRepositoryError(err)
	}
	items := []domainasset.Asset{item}
	if err = s.attachReviews(ctx, scope, items); err != nil {
		return domainasset.Asset{}, err
	}
	return items[0], nil
}

// BypassGetForUpdate is the locking counterpart of BypassGet. Callers must
// establish authorization from their own aggregate before using it.
func (s *Service) BypassGetForUpdate(ctx context.Context, input BypassGetInput) (domainasset.Asset, error) {
	scope := normalizeScope(input.Scope)
	if !isValidScope(scope) || strings.TrimSpace(input.AssetID) == "" {
		return domainasset.Asset{}, errno.New(errno.ErrInvalidArgument)
	}
	item, err := s.repository.GetForUpdate(ctx, scope, input.AssetID)
	if err != nil {
		return domainasset.Asset{}, classifyRepositoryError(err)
	}
	return item, nil
}

func (s *Service) BatchGet(ctx context.Context, input BatchGetInput) ([]domainasset.Asset, error) {
	scope := normalizeScope(input.Scope)
	owner, ownerValid := normalizeReferenceOwner(input.Owner)
	ids, valid := normalizeBatchIDs(input.AssetIDs)
	if !isValidScope(scope) || !valid || !ownerValid {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	if len(ids) == 0 {
		return []domainasset.Asset{}, nil
	}
	items, err := s.repository.BatchGetReferenced(ctx, scope, owner, ids)
	if err != nil {
		return nil, classifyRepositoryError(err)
	}
	items = orderAssets(items, ids)
	if err = s.attachReviews(ctx, scope, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Service) BypassBatchGet(ctx context.Context, input BypassBatchGetInput) ([]domainasset.Asset, error) {
	scope := normalizeScope(input.Scope)
	ids, valid := normalizeBatchIDs(input.AssetIDs)
	if !isValidScope(scope) || !valid {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	if len(ids) == 0 {
		return []domainasset.Asset{}, nil
	}
	items, err := s.repository.BatchGet(ctx, scope, ids)
	if err != nil {
		return nil, classifyRepositoryError(err)
	}
	items = orderAssets(items, ids)
	if err = s.attachReviews(ctx, scope, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Service) attachReviews(ctx context.Context, scope Scope, items []domainasset.Asset) error {
	if s.reviews == nil || len(items) == 0 {
		return nil
	}
	ids := make([]string, len(items))
	for index := range items {
		ids[index] = items[index].ID
	}
	reviews, err := s.reviews.BatchGetAssetReviews(ctx, scope, ids)
	if err != nil {
		return errno.Wrap(errno.ErrPersistenceError, err)
	}
	for index := range items {
		items[index].Reviews = reviews[items[index].ID]
	}
	return nil
}

// BatchPresignAsset reads Assets and resolves optional access URLs without
// turning preview availability into an Asset read failure.
func (s *Service) BatchPresignAsset(ctx context.Context, input BatchGetInput) ([]PresignedAsset, error) {
	assets, err := s.BatchGet(ctx, input)
	if err != nil {
		return nil, err
	}
	return s.presignAssets(ctx, input.Scope, input.AssetIDs, assets)
}

func (s *Service) BatchPresignReferencedAssets(ctx context.Context, input BatchGetReferencedAssetsInput) ([]PresignedReferencedAsset, error) {
	scope := normalizeScope(input.Scope)
	references, valid := normalizeAssetReferences(input.References)
	if !isValidScope(scope) || !valid {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	if len(references) == 0 {
		return []PresignedReferencedAsset{}, nil
	}
	items, err := s.repository.BatchGetReferencedAssets(ctx, scope, references)
	if err != nil {
		return nil, classifyRepositoryError(err)
	}
	assets := make([]domainasset.Asset, len(items))
	for index := range items {
		assets[index] = items[index].Asset
	}
	if err = s.attachReviews(ctx, scope, assets); err != nil {
		return nil, err
	}
	for index := range items {
		items[index].Asset = assets[index]
	}
	items = orderReferencedAssets(items, references)
	assetIDs := make([]string, len(items))
	assets = make([]domainasset.Asset, len(items))
	for index := range items {
		assetIDs[index] = items[index].Asset.ID
		assets[index] = items[index].Asset
	}
	presigned, err := s.presignAssets(ctx, scope, assetIDs, assets)
	if err != nil {
		return nil, err
	}
	presignedByID := make(map[string]PresignedAsset, len(presigned))
	for _, item := range presigned {
		presignedByID[item.AssetID] = item
	}
	results := make([]PresignedReferencedAsset, 0, len(items))
	for _, item := range items {
		resolved := presignedByID[item.Asset.ID]
		results = append(results, PresignedReferencedAsset{
			Reference: item.Reference, Asset: item.Asset, URL: resolved.URL, ExpiresAt: resolved.ExpiresAt,
			ErrorCode: resolved.ErrorCode, ErrorMessage: resolved.ErrorMessage,
		})
	}
	return results, nil
}

func (s *Service) BypassBatchPresignAsset(ctx context.Context, input BypassBatchGetInput) ([]PresignedAsset, error) {
	assets, err := s.BypassBatchGet(ctx, input)
	if err != nil {
		return nil, err
	}
	return s.presignAssets(ctx, input.Scope, input.AssetIDs, assets)
}

func (s *Service) presignAssets(ctx context.Context, inputScope Scope, requestedIDs []string, assets []domainasset.Asset) ([]PresignedAsset, error) {
	ids, _ := normalizeBatchIDs(requestedIDs)
	assetsByID := make(map[string]domainasset.Asset, len(assets))
	for _, item := range assets {
		assetsByID[item.ID] = item
	}
	results := make([]PresignedAsset, len(ids))
	sourceAssetIDs := make([]string, 0, len(assets))
	seen := make(map[string]struct{}, len(assets))
	for index, assetID := range ids {
		results[index].AssetID = assetID
		item, found := assetsByID[assetID]
		if !found {
			results[index].ErrorCode = assetNotFoundCode
			results[index].ErrorMessage = assetNotFoundMessage
			continue
		}
		results[index].Asset = item
		sourceAssetID := strings.TrimSpace(item.SourceAssetID)
		if sourceAssetID == "" {
			results[index].ErrorCode = missingArtifactCode
			results[index].ErrorMessage = assetHasNoArtifactMessage
			continue
		}
		if _, exists := seen[sourceAssetID]; exists {
			continue
		}
		seen[sourceAssetID] = struct{}{}
		sourceAssetIDs = append(sourceAssetIDs, sourceAssetID)
	}

	if len(sourceAssetIDs) == 0 {
		return results, nil
	}
	scope := normalizeScope(inputScope)
	presigned := make(map[string]PresignedArtifact, len(sourceAssetIDs))
	var presignErr error
	refs := make([]RevisionRef, 0, len(assets))
	refSeen := make(map[string]struct{}, len(assets))
	for _, item := range assets {
		sourceAssetID := strings.TrimSpace(item.SourceAssetID)
		if sourceAssetID != "" {
			key := revisionRefKey(sourceAssetID, item.SourceRevisionID)
			if _, exists := refSeen[key]; !exists {
				refSeen[key] = struct{}{}
				refs = append(refs, RevisionRef{SourceAssetID: sourceAssetID, SourceRevisionID: item.SourceRevisionID})
			}
		}
	}
	resolved, resolveErr := s.revisions.BatchDeliveryURLs(ctx, scope.TenantID, workspaceValue(scope.WorkspaceID), refs)
	for key, capability := range resolved {
		presigned[key] = capability
	}
	presignErr = errors.Join(presignErr, resolveErr)
	for index, result := range results {
		if result.ErrorCode != "" {
			continue
		}
		item := result.Asset
		artifact := presigned[revisionRefKey(strings.TrimSpace(item.SourceAssetID), item.SourceRevisionID)]
		if strings.TrimSpace(artifact.URL) != "" {
			results[index].URL = artifact.URL
			results[index].ExpiresAt = artifact.ExpiresAt
			continue
		}
		if presignErr != nil {
			results[index].ErrorCode = artifactPresignFailedCode
			results[index].ErrorMessage = artifactPresignFailedMessage
			continue
		}
		results[index].ErrorCode = missingArtifactCode
		results[index].ErrorMessage = artifactMissingMessage
	}
	return results, nil
}

func revisionRefKey(assetID, revisionID string) string {
	return assetID + "\x00" + revisionID
}

func (s *Service) ListByOwner(ctx context.Context, input ListByOwnerInput) ([]domainasset.Asset, error) {
	scope := normalizeScope(input.Scope)
	if !isValidScope(scope) || !input.OwnerType.Valid() || strings.TrimSpace(input.OwnerID) == "" {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	limit := input.Limit
	if limit < 1 || limit > maxListByOwner {
		limit = maxListByOwner
	}
	items, err := s.repository.ListByOwner(ctx, scope, input.OwnerType, input.OwnerID, limit)
	if err != nil {
		return nil, classifyRepositoryError(err)
	}
	return items, nil
}

func (s *Service) DeleteByOwner(ctx context.Context, input DeleteByOwnerInput) error {
	scope := normalizeScope(input.Scope)
	if !isValidScope(scope) || !input.OwnerType.Valid() || strings.TrimSpace(input.OwnerID) == "" {
		return errno.New(errno.ErrInvalidArgument)
	}
	deleted, err := s.deleteAndRelease(ctx, func(txCtx context.Context, now time.Time) ([]RetiredAsset, error) {
		return s.repository.DeleteByOwner(txCtx, scope, input.OwnerType, input.OwnerID, now)
	})
	if err != nil {
		return classifyRepositoryError(err)
	}
	s.prepareReviewCleanup(ctx, deleted)
	return nil
}

func (s *Service) DeleteByTenant(ctx context.Context, tenantID, operatorID string) error {
	if strings.TrimSpace(tenantID) == "" || strings.TrimSpace(operatorID) == "" {
		return errno.New(errno.ErrInvalidArgument)
	}
	deleted, err := s.deleteAndRelease(ctx, func(txCtx context.Context, now time.Time) ([]RetiredAsset, error) {
		return s.repository.DeleteByTenant(txCtx, tenantID, now)
	})
	if err != nil {
		return classifyRepositoryError(err)
	}
	s.prepareReviewCleanup(ctx, deleted)
	return nil
}

func (s *Service) DeleteByWorkspace(ctx context.Context, tenantID, workspaceID, operatorID string) error {
	if strings.TrimSpace(tenantID) == "" || strings.TrimSpace(workspaceID) == "" || strings.TrimSpace(operatorID) == "" {
		return errno.New(errno.ErrInvalidArgument)
	}
	deleted, err := s.deleteAndRelease(ctx, func(txCtx context.Context, now time.Time) ([]RetiredAsset, error) {
		return s.repository.DeleteByWorkspace(txCtx, tenantID, workspaceID, now)
	})
	if err != nil {
		return classifyRepositoryError(err)
	}
	s.prepareReviewCleanup(ctx, deleted)
	return nil
}

func (s *Service) deleteAndRelease(ctx context.Context, remove func(context.Context, time.Time) ([]RetiredAsset, error)) ([]RetiredAsset, error) {
	if s.transactions == nil || s.claimIntents == nil {
		return nil, errors.New("asset lifecycle transaction is not configured")
	}
	var retired []RetiredAsset
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		now := s.clock.Now()
		var err error
		retired, err = remove(txCtx, now)
		if err != nil {
			return err
		}
		for _, item := range retired {
			if err = s.claimIntents.EnsureReleased(txCtx, applicationassetclaim.Intent{
				TenantID: item.TenantID, WorkspaceID: workspaceValue(item.WorkspaceID), OwnerType: "canvas_asset", OwnerID: item.AssetID, Slot: "source",
				AssetID: item.SourceAssetID, RevisionID: item.SourceRevisionID, Kind: applicationassetclaim.KindStrong, Generation: 1,
			}, now); err != nil {
				return err
			}
			if s.storageQuota != nil {
				if _, err = s.storageQuota.ReleaseStorage(txCtx, "canvas_asset", item.AssetID); err != nil {
					return err
				}
			}
		}
		return nil
	})
	return retired, err
}

// PrepareReviewCleanup immediately retires review state and persists provider
// Asset deletion work after a business owner releases the supplied Assets.
func (s *Service) PrepareReviewCleanup(ctx context.Context, scope Scope, assetIDs []string) error {
	if s.reviewCleaner == nil {
		return nil
	}
	items := make([]RetiredAsset, 0, len(assetIDs))
	seen := make(map[string]struct{}, len(assetIDs))
	for _, assetID := range assetIDs {
		assetID = strings.TrimSpace(assetID)
		if assetID == "" {
			continue
		}
		if _, exists := seen[assetID]; exists {
			continue
		}
		seen[assetID] = struct{}{}
		items = append(items, RetiredAsset{AssetID: assetID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID})
	}
	for _, item := range items {
		if err := s.reviewCleaner.PrepareAssetReviewCleanup(ctx, item); err != nil {
			if s.cleanupFailures != nil {
				s.cleanupFailures.ReportReviewCleanupFailure(ctx, item, err)
			}
			return err
		}
	}
	return nil
}

func (s *Service) prepareReviewCleanup(ctx context.Context, items []RetiredAsset) {
	if s.reviewCleaner == nil || len(items) == 0 {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), reviewCleanupTimeout)
	defer cancel()
	for _, item := range items {
		if cleanupErr := s.reviewCleaner.PrepareAssetReviewCleanup(cleanupCtx, item); cleanupErr != nil && s.cleanupFailures != nil {
			s.cleanupFailures.ReportReviewCleanupFailure(cleanupCtx, item, cleanupErr)
		}
	}
}

func normalizeScope(scope Scope) Scope {
	if scope.WorkspaceID != nil && strings.TrimSpace(*scope.WorkspaceID) == "" {
		scope.WorkspaceID = nil
	}
	return scope
}

func sameScope(left, right Scope) bool {
	if left.TenantID != right.TenantID || left.CallerID != right.CallerID {
		return false
	}
	if left.WorkspaceID == nil || right.WorkspaceID == nil {
		return left.WorkspaceID == nil && right.WorkspaceID == nil
	}
	return *left.WorkspaceID == *right.WorkspaceID
}

func isValidCreateInput(scope Scope, input CreateInput) bool {
	return isValidScope(scope) && input.OwnerType.Valid() &&
		strings.TrimSpace(input.OwnerID) != "" && strings.TrimSpace(input.SourceAssetID) != "" &&
		strings.TrimSpace(input.SourceRevisionID) != "" &&
		strings.TrimSpace(input.FileName) != "" && len(strings.TrimSpace(input.CreationKey)) <= 255
}

func workspaceValue(workspaceID *string) string {
	if workspaceID == nil {
		return ""
	}
	return strings.TrimSpace(*workspaceID)
}

func isValidScope(scope Scope) bool {
	return strings.TrimSpace(scope.TenantID) != "" && strings.TrimSpace(scope.CallerID) != ""
}

func normalizeBatchIDs(input []string) ([]string, bool) {
	if len(input) > maxBatchGetIDs {
		return nil, false
	}
	seen := make(map[string]struct{}, len(input))
	ids := make([]string, 0, len(input))
	for _, id := range input {
		if strings.TrimSpace(id) == "" {
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

func normalizeAssetReferences(input []AssetReference) ([]AssetReference, bool) {
	if len(input) > maxBatchGetIDs {
		return nil, false
	}
	seen := make(map[AssetReference]struct{}, len(input))
	references := make([]AssetReference, 0, len(input))
	for _, reference := range input {
		owner, valid := normalizeReferenceOwner(reference.Owner)
		reference.Owner = owner
		reference.AssetID = strings.TrimSpace(reference.AssetID)
		if !valid || reference.AssetID == "" {
			return nil, false
		}
		if _, exists := seen[reference]; exists {
			continue
		}
		seen[reference] = struct{}{}
		references = append(references, reference)
	}
	return references, true
}

func orderReferencedAssets(items []ReferencedAsset, references []AssetReference) []ReferencedAsset {
	byReference := make(map[AssetReference]ReferencedAsset, len(items))
	for _, item := range items {
		byReference[item.Reference] = item
	}
	ordered := make([]ReferencedAsset, 0, len(references))
	for _, reference := range references {
		if item, exists := byReference[reference]; exists {
			ordered = append(ordered, item)
		}
	}
	return ordered
}

func orderAssets(items []domainasset.Asset, ids []string) []domainasset.Asset {
	byID := make(map[string]domainasset.Asset, len(items))
	for _, item := range items {
		byID[item.ID] = item
	}
	ordered := make([]domainasset.Asset, 0, len(ids))
	for _, id := range ids {
		if item, exists := byID[id]; exists {
			ordered = append(ordered, item)
		}
	}
	return ordered
}

func classifyOwnerError(err error) error {
	if errors.Is(err, ErrOwnerNotFound) {
		return errno.Wrap(errno.ErrNotFound, err)
	}
	return preserveOrWrap(err, errno.ErrPersistenceError)
}

func classifyArtifactError(err error) error {
	if errors.Is(err, ErrUnsupportedFormat) {
		return errno.Wrap(errno.ErrUnsupportedAssetFormat, err)
	}
	return preserveOrWrap(err, errno.ErrObjectStorageDependencyError)
}

func classifyRepositoryError(err error) error {
	if errors.Is(err, ErrOwnerNotFound) || errors.Is(err, ErrNotFound) {
		return errno.Wrap(errno.ErrNotFound, err)
	}
	return preserveOrWrap(err, errno.ErrPersistenceError)
}

func preserveOrWrap(err error, code errno.ErrorCode) error {
	var bizErr *errno.BizError
	if errors.As(err, &bizErr) {
		return err
	}
	return errno.Wrap(code, err)
}
