package resource

import (
	"context"
	"errors"
	"strings"

	"github.com/example/monorepo/canvas/internal/platform/logcontext"
	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
	applicationprojectstatistics "github.com/example/monorepo/canvas/internal/server/application/projectstatistics"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domainresource "github.com/example/monorepo/canvas/internal/server/domain/resource"
	domainresourceassetgeneration "github.com/example/monorepo/canvas/internal/server/domain/resourceassetgeneration"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const maxPageSize = 100
const maxBatchGetIDs = 100

type Service struct {
	generationDeleter     GenerationDeleter
	repository            Repository
	projects              ProjectResolver
	ids                   IDGenerator
	clock                 Clock
	assets                AssetReader
	assetCreator          AssetCreator
	assetImporter         AssetImporter
	transactions          TransactionManager
	assetDeleter          AssetOwnerDeleter
	cleanupFailure        CleanupFailureReporter
	assetReferences       AssetReferenceTracker
	imageGenerationDrafts ImageGenerationDraftStore
	officialMaterializer  OfficialMaterializer
	projectStatistics     applicationprojectstatistics.Projector
	canvasNodeAssets      CanvasNodeAssetBinder
}

type Option func(*Service)

func WithAssetMutations(assets AssetReader, transactions TransactionManager) Option {
	return func(service *Service) { service.assets = assets; service.transactions = transactions }
}

func WithBlobAssetCreation(assets AssetCreator, transactions TransactionManager) Option {
	return func(service *Service) { service.assetCreator = assets; service.transactions = transactions }
}

func WithAssetImport(assets AssetImporter, transactions TransactionManager) Option {
	return func(service *Service) { service.assetImporter = assets; service.transactions = transactions }
}

func WithDeletion(deleter AssetOwnerDeleter, reporter CleanupFailureReporter) Option {
	return func(service *Service) { service.assetDeleter = deleter; service.cleanupFailure = reporter }
}

type AssetReferenceTracker interface {
	AcquireAssets(context.Context, applicationasset.AcquireAssetsInput) error
	ReleaseAssets(context.Context, applicationasset.ReleaseAssetsInput) error
	ReleaseAllAssets(context.Context, applicationasset.ReleaseAllAssetsInput) error
}

func WithAssetReferenceTracker(tracker AssetReferenceTracker) Option {
	return func(service *Service) { service.assetReferences = tracker }
}

func WithCanvasNodeAssetBinding(binder CanvasNodeAssetBinder) Option {
	return func(service *Service) { service.canvasNodeAssets = binder }
}

// WithOfficialMaterialization 开启首次读物化。未配置时读路径行为不变，因此该能力可以
// 独立开关，不影响既有资源库读取。
func WithOfficialMaterialization(materializer OfficialMaterializer) Option {
	return func(service *Service) {
		if materializer != nil {
			service.officialMaterializer = materializer
		}
	}
}

func WithProjectStatistics(projector applicationprojectstatistics.Projector) Option {
	return func(service *Service) { service.projectStatistics = projector }
}

func WithImageGenerationDrafts(drafts ImageGenerationDraftStore, transactions TransactionManager) Option {
	return func(service *Service) {
		service.imageGenerationDrafts = drafts
		service.transactions = transactions
	}
}

func NewService(repository Repository, projects ProjectResolver, ids IDGenerator, clock Clock, options ...Option) *Service {
	service := &Service{repository: repository, projects: projects, ids: ids, clock: clock}
	for _, option := range options {
		option(service)
	}
	return service
}

type CreateInput struct {
	Scope
	ProjectID     string
	Type          domainresource.Type
	Name          string
	Description   string
	InitialAssets []InitialAssetInput
}

type InitialAssetInput struct {
	BlobID   string
	FileName string
	Name     *string
}

type CreateResult struct {
	Resource       domainresource.Resource
	ResourceAssets []domainresource.ResourceAsset
}

type CreateFromAssetInput struct {
	Scope
	ProjectID    string
	AssetID      string
	Type         domainresource.Type
	Name         string
	Description  string
	CanvasID     string
	CanvasNodeID string
}

type CreateFromAssetResult struct {
	Resource          domainresource.Resource
	ResourceAsset     domainresource.ResourceAsset
	CanvasNodeBinding *CanvasNodeAssetBinding
}

type GetInput struct {
	Scope
	ProjectID, ResourceID string
}
type BatchGetInput struct {
	Scope
	ProjectID   string
	ResourceIDs []string
}
type ListInput struct {
	Scope
	ProjectID     string
	Type          *domainresource.Type
	Keyword       string
	SortField     SortField
	SortDirection SortDirection
	Page          Page
}
type UpdateInput struct {
	Scope
	ProjectID, ResourceID, Name, Description string
	ExpectedRevision                         int64
}

type CreateResourceAssetInput struct {
	Scope
	ProjectID                string
	ResourceID               string
	AssetID                  string
	BlobID                   string
	FileName                 string
	Name                     *string
	ExpectedResourceRevision int64
}

type CreateGeneratedResourceAssetInput struct {
	Scope
	ProjectID                string
	ResourceID               string
	ExpectedResourceRevision int64
}

type UpdateResourceAssetInput struct {
	Scope
	ProjectID, ResourceID, ResourceAssetID string
	Name                                   *string
	AssetID                                *string
	ExpectedResourceRevision               int64
	ExpectedResourceAssetRevision          int64
}

type RenameResourceAssetInput struct {
	Scope
	ProjectID, ResourceID, ResourceAssetID string
	Name                                   string
	ExpectedResourceRevision               int64
	ExpectedResourceAssetRevision          int64
}

type ReplaceUploadedResourceAssetInput struct {
	Scope
	ProjectID, ResourceID, ResourceAssetID string
	BlobID, FileName                       string
	ExpectedResourceRevision               int64
	ExpectedResourceAssetRevision          int64
}

type SetPrimaryResourceAssetInput struct {
	Scope
	ProjectID, ResourceID, ResourceAssetID string
	ExpectedResourceRevision               int64
}

type DeleteResourceAssetInput struct {
	Scope
	ProjectID, ResourceID, ResourceAssetID string
	ExpectedResourceRevision               int64
	ExpectedResourceAssetRevision          int64
}

type DeleteInput struct {
	Scope
	ProjectID, ResourceID string
	ExpectedRevision      int64
}
type DeleteByProjectInput struct {
	Scope
	ProjectID string
}
type ListResourceAssetsInput struct {
	Scope
	ProjectID, ResourceID string
	Page                  Page
}
type GetProjectResourceStatsInput struct {
	Scope
	ProjectID string
}
type ResourceStats struct {
	CharacterCount int32
	SceneCount     int32
	PropCount      int32
	AudioCount     int32
}
type GetResourceAssetInput struct {
	Scope
	ProjectID, ResourceID, ResourceAssetID string
}
type BatchGetResourceAssetsInput struct {
	Scope
	ProjectID        string
	ResourceAssetIDs []string
}
type BatchListResourceAssetsInput struct {
	Scope
	ProjectID   string
	ResourceIDs []string
}
type ResourceAssetGroup struct {
	Resource domainresource.Resource
	Items    []domainresource.ResourceAsset
}
type DeleteResourceAssetTarget struct {
	ResourceAssetID               string
	ExpectedResourceRevision      int64
	ExpectedResourceAssetRevision int64
}
type BatchDeleteResourceAssetsInput struct {
	Scope
	ProjectID, ResourceID string
	Targets               []DeleteResourceAssetTarget
}
type DeleteTarget struct {
	ResourceID       string
	ExpectedRevision int64
}
type BatchDeleteInput struct {
	Scope
	ProjectID string
	Targets   []DeleteTarget
}

func (s *Service) Create(ctx context.Context, input CreateInput) (CreateResult, error) {
	if !validScope(input.Scope) || strings.TrimSpace(input.ProjectID) == "" {
		return CreateResult{}, errno.New(errno.ErrInvalidArgument)
	}
	if err := s.projects.Validate(ctx, input.Scope, input.ProjectID); err != nil {
		return CreateResult{}, classifyError(err)
	}
	id, err := s.ids.NewID()
	if err != nil {
		return CreateResult{}, errno.Wrap(errno.ErrInternalError, err)
	}
	item, err := domainresource.New(domainresource.NewInput{
		ID: id, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID,
		OwnerType: domainresource.OwnerProject, OwnerID: input.ProjectID,
		Type: input.Type, Name: input.Name, Description: input.Description,
		CreatedBy: input.CallerID, Now: s.clock.Now(),
	})
	if err != nil {
		return CreateResult{}, errno.Wrap(errno.ErrInvalidArgument, err)
	}
	if len(input.InitialAssets) == 0 {
		if err := s.repository.Create(ctx, item); err != nil {
			return CreateResult{}, classifyError(err)
		}
		s.refreshResourceCount(ctx, input.Scope, input.ProjectID)
		return CreateResult{Resource: item, ResourceAssets: []domainresource.ResourceAsset{}}, nil
	}
	if s.transactions == nil || s.assetCreator == nil || int32(len(input.InitialAssets)) > item.ResourceAssetLimit() {
		return CreateResult{}, errno.New(errno.ErrInvalidArgument)
	}
	bindingIDs := make([]string, len(input.InitialAssets))
	bindingNames := make([]string, len(input.InitialAssets))
	prepareItems := make([]applicationasset.PrepareCreateItem, len(input.InitialAssets))
	seenNames := make(map[string]struct{}, len(input.InitialAssets))
	for index, initial := range input.InitialAssets {
		if strings.TrimSpace(initial.BlobID) == "" || strings.TrimSpace(initial.FileName) == "" {
			return CreateResult{}, errno.New(errno.ErrInvalidArgument)
		}
		name := domainresource.DefaultResourceAssetName(initial.FileName)
		if initial.Name != nil {
			name = *initial.Name
		}
		if err := domainresource.ValidateResourceAssetName(name); err != nil {
			return CreateResult{}, errno.Wrap(errno.ErrInvalidArgument, err)
		}
		if _, exists := seenNames[name]; exists {
			return CreateResult{}, errno.New(errno.ErrResourceAssetNameConflict)
		}
		seenNames[name] = struct{}{}
		bindingNames[index] = name
		bindingIDs[index], err = s.ids.NewID()
		if err != nil {
			return CreateResult{}, errno.Wrap(errno.ErrInternalError, err)
		}
		prepareItems[index] = applicationasset.PrepareCreateItem{BlobID: initial.BlobID, FileName: initial.FileName}
	}
	if err := s.repository.ValidateCreate(ctx, item); err != nil {
		return CreateResult{}, classifyError(err)
	}
	prepared, err := s.assetCreator.PrepareResourceOwnedCreates(ctx, applicationasset.Scope{
		TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CallerID: input.CallerID,
	}, &input.ProjectID, item.ID, prepareItems)
	if err != nil {
		return CreateResult{}, err
	}
	for _, preparedItem := range prepared {
		if !mediaMatches(item.Type, preparedItem.MediaType) {
			return CreateResult{}, classifyError(ErrAssetMediaTypeMismatch)
		}
	}
	assets, err := s.assetCreator.RegisterPreparedCreates(ctx, prepared)
	if err != nil {
		return CreateResult{}, err
	}
	if len(assets) != len(prepared) {
		if compensationErr := s.assetCreator.CompensateCreatedMany(ctx, assets, nil); compensationErr != nil && s.cleanupFailure != nil {
			s.cleanupFailure.Report(ctx, compensationErr)
		}
		return CreateResult{}, errno.New(errno.ErrInternalError)
	}
	bindings := make([]domainresource.ResourceAsset, len(assets))
	for index, assetItem := range assets {
		bindings[index], err = domainresource.NewResourceAsset(domainresource.NewResourceAssetInput{
			ID: bindingIDs[index], ResourceID: item.ID, Name: bindingNames[index], SequenceNo: int64(index + 1),
			CurrentAssetID: assetItem.ID, MediaType: assetItem.MediaType, Now: s.clock.Now(),
		})
		if err != nil {
			if compensationErr := s.assetCreator.CompensateCreatedMany(ctx, assets, nil); compensationErr != nil && s.cleanupFailure != nil {
				s.cleanupFailure.Report(ctx, compensationErr)
			}
			return CreateResult{}, errno.Wrap(errno.ErrInternalError, err)
		}
	}
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if createErr := s.repository.Create(txCtx, item); createErr != nil {
			return createErr
		}
		if persistErr := s.assetCreator.PersistPreparedCreates(txCtx, assets); persistErr != nil {
			return persistErr
		}
		for index, binding := range bindings {
			if createErr := s.repository.CreateResourceAsset(txCtx, binding, assets[index].ID); createErr != nil {
				return createErr
			}
			if createErr := s.acquireResourceAssetRevision(txCtx, input.Scope, binding.ID, assets[index].ID); createErr != nil {
				return createErr
			}
			if touchErr := item.AttachResourceAsset(item.Revision, binding.ID, s.clock.Now()); touchErr != nil {
				return touchErr
			}
			if updateErr := s.repository.Update(txCtx, item); updateErr != nil {
				return updateErr
			}
		}
		return nil
	})
	if err != nil {
		if compensationErr := s.assetCreator.CompensateCreatedMany(ctx, assets, nil); compensationErr != nil && s.cleanupFailure != nil {
			s.cleanupFailure.Report(ctx, compensationErr)
		}
		return CreateResult{}, classifyError(err)
	}
	s.refreshResourceCount(ctx, input.Scope, input.ProjectID)
	return CreateResult{Resource: item, ResourceAssets: bindings}, nil
}

func (s *Service) CreateFromAsset(ctx context.Context, input CreateFromAssetInput) (CreateFromAssetResult, error) {
	bindCanvasNode := strings.TrimSpace(input.CanvasID) != "" || strings.TrimSpace(input.CanvasNodeID) != ""
	if !validScope(input.Scope) || strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.AssetID) == "" ||
		s.transactions == nil || s.assets == nil || s.assetImporter == nil ||
		(bindCanvasNode && (strings.TrimSpace(input.CanvasID) == "" || strings.TrimSpace(input.CanvasNodeID) == "" || s.canvasNodeAssets == nil)) {
		return CreateFromAssetResult{}, errno.New(errno.ErrInvalidArgument)
	}
	if err := s.projects.Validate(ctx, input.Scope, input.ProjectID); err != nil {
		return CreateFromAssetResult{}, classifyError(err)
	}
	resourceID, err := s.ids.NewID()
	if err != nil {
		return CreateFromAssetResult{}, errno.Wrap(errno.ErrInternalError, err)
	}
	resourceAssetID, err := s.ids.NewID()
	if err != nil {
		return CreateFromAssetResult{}, errno.Wrap(errno.ErrInternalError, err)
	}
	now := s.clock.Now()
	item, err := domainresource.New(domainresource.NewInput{
		ID: resourceID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID,
		OwnerType: domainresource.OwnerProject, OwnerID: input.ProjectID,
		Type: input.Type, Name: input.Name, Description: input.Description,
		CreatedBy: input.CallerID, Now: now,
	})
	if err != nil {
		return CreateFromAssetResult{}, errno.Wrap(errno.ErrInvalidArgument, err)
	}
	var binding domainresource.ResourceAsset
	var imported domainasset.Asset
	var canvasNodeBinding CanvasNodeAssetBinding
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		source, getErr := s.assets.BypassGetForUpdate(txCtx, applicationasset.BypassGetInput{
			Scope:   applicationasset.Scope{TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CallerID: input.CallerID},
			AssetID: input.AssetID,
		})
		if getErr != nil {
			return getErr
		}
		if source.TenantID != input.TenantID || !equalStrings(source.WorkspaceID, input.WorkspaceID) ||
			source.OwnerType != domainasset.OwnerProject || source.OwnerID != input.ProjectID {
			return ErrAssetOwnerMismatch
		}
		if !mediaMatches(item.Type, source.MediaType) {
			return ErrAssetMediaTypeMismatch
		}
		if createErr := s.repository.Create(txCtx, item); createErr != nil {
			return createErr
		}
		imported, getErr = s.assetImporter.CreateFromArtifact(txCtx, applicationasset.CreateFromArtifactInput{
			Scope:             applicationasset.Scope{TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CallerID: input.CallerID},
			OwnerType:         domainasset.OwnerResource,
			OwnerID:           item.ID,
			CreationKey:       "resource-import:" + item.ID + ":" + input.AssetID,
			ArtifactID:        source.ArtifactID,
			ArtifactNamespace: source.ArtifactNamespace,
			FileName:          source.FileName,
			MediaType:         source.MediaType,
			ContentType:       source.ContentType,
			SizeBytes:         source.SizeBytes,
		})
		if getErr != nil {
			return getErr
		}
		if imported.OwnerType != domainasset.OwnerResource || imported.OwnerID != item.ID || imported.ArtifactID != source.ArtifactID {
			return ErrAssetOwnerMismatch
		}
		binding, getErr = domainresource.NewResourceAsset(domainresource.NewResourceAssetInput{
			ID: resourceAssetID, ResourceID: item.ID, Name: item.Name, SequenceNo: 1,
			CurrentAssetID: imported.ID, MediaType: imported.MediaType, Now: now,
		})
		if getErr != nil {
			return errno.Wrap(errno.ErrInvalidArgument, getErr)
		}
		if createErr := s.repository.CreateResourceAsset(txCtx, binding, imported.ID); createErr != nil {
			return createErr
		}
		if createErr := s.acquireResourceAssetRevision(txCtx, input.Scope, binding.ID, imported.ID); createErr != nil {
			return createErr
		}
		if attachErr := item.AttachResourceAsset(item.Revision, binding.ID, now); attachErr != nil {
			return attachErr
		}
		if updateErr := s.repository.Update(txCtx, item); updateErr != nil {
			return updateErr
		}
		if bindCanvasNode {
			canvasNodeBinding, getErr = s.canvasNodeAssets.BindCanvasNodeAsset(txCtx, CanvasNodeAssetBindingInput{
				Scope: input.Scope, ProjectID: input.ProjectID, CanvasID: input.CanvasID, CanvasNodeID: input.CanvasNodeID,
				AssetID: input.AssetID, ResourceAssetID: binding.ID, UpdatedAt: now,
			})
			if getErr != nil {
				return getErr
			}
			canvasNodeBinding.CurrentAssetID = imported.ID
		}
		return nil
	})
	if err != nil {
		return CreateFromAssetResult{}, classifyError(err)
	}
	s.refreshResourceCount(ctx, input.Scope, input.ProjectID)
	result := CreateFromAssetResult{Resource: item, ResourceAsset: binding}
	if bindCanvasNode {
		result.CanvasNodeBinding = &canvasNodeBinding
	}
	return result, nil
}

func (s *Service) Get(ctx context.Context, input GetInput) (domainresource.Resource, error) {
	if !validScope(input.Scope) || strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.ResourceID) == "" {
		return domainresource.Resource{}, errno.New(errno.ErrInvalidArgument)
	}
	item, err := s.repository.Get(ctx, input.Scope, input.ProjectID, input.ResourceID)
	return item, classifyError(err)
}

func (s *Service) BatchGet(ctx context.Context, input BatchGetInput) ([]domainresource.Resource, error) {
	ids, valid := normalizeIDs(input.ResourceIDs)
	if !validScope(input.Scope) || strings.TrimSpace(input.ProjectID) == "" || !valid {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	if len(ids) == 0 {
		return []domainresource.Resource{}, nil
	}
	items, err := s.repository.BatchGet(ctx, input.Scope, input.ProjectID, ids)
	if err != nil {
		return nil, classifyError(err)
	}
	byID := make(map[string]domainresource.Resource, len(items))
	for _, item := range items {
		byID[item.ID] = item
	}
	ordered := make([]domainresource.Resource, 0, len(items))
	for _, id := range ids {
		if item, ok := byID[id]; ok {
			ordered = append(ordered, item)
		}
	}
	return ordered, nil
}

func (s *Service) List(ctx context.Context, input ListInput) ([]domainresource.Resource, int64, error) {
	if !validScope(input.Scope) || strings.TrimSpace(input.ProjectID) == "" || input.Page.PageSize < 1 || input.Page.PageSize > maxPageSize || input.Page.PageNum < 1 {
		return nil, 0, errno.New(errno.ErrInvalidArgument)
	}
	field := input.SortField
	if field == SortUnspecified {
		field = SortUpdatedAt
	}
	direction := input.SortDirection
	if direction == SortDirectionUnspecified {
		direction = SortDescending
	}
	if (field != SortCreatedAt && field != SortUpdatedAt) || (direction != SortAscending && direction != SortDescending) {
		return nil, 0, errno.New(errno.ErrInvalidArgument)
	}
	if input.Type != nil && !input.Type.Valid() {
		return nil, 0, errno.New(errno.ErrInvalidArgument)
	}
	// 资源库列表是官方预置的入口，因此在此处按清单补齐本 scope 的官方记录。
	s.materializeOfficial(ctx, input.Scope)
	items, total, err := s.repository.List(ctx, ListQuery{
		Scope: input.Scope, ProjectID: input.ProjectID, Type: input.Type, Keyword: input.Keyword,
		SortField: field, SortDirection: direction, PageSize: input.Page.PageSize, PageNum: input.Page.PageNum,
	})
	return items, total, classifyError(err)
}

// materializeOfficial 按官方清单补齐本 scope 的官方记录。
//
// 刻意吞掉错误：物化是让官方预置可见的补齐动作，不是本次读取的正确性前提。若它失败就让
// 整个资源库列表报错，用户会因为官方素材的问题看不到自己的资源。失败通过 reporter 可观测，
// 并在下次读取时自然重试。
func (s *Service) materializeOfficial(ctx context.Context, scope Scope) {
	if s.officialMaterializer == nil {
		return
	}
	s.officialMaterializer.MaterializeForScope(ctx, scope)
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (domainresource.Resource, error) {
	if !validScope(input.Scope) || input.ProjectID == "" || input.ResourceID == "" || input.ExpectedRevision < 1 {
		return domainresource.Resource{}, errno.New(errno.ErrInvalidArgument)
	}
	var item domainresource.Resource
	run := func(txCtx context.Context) error {
		var err error
		item, err = s.repository.GetForUpdate(txCtx, input.Scope, input.ProjectID, input.ResourceID)
		if err != nil {
			return err
		}
		if item.OwnerType.ReadOnly() {
			return domainresource.ErrReadOnly
		}
		changed, updateErr := item.Update(input.Name, input.Description, input.ExpectedRevision, s.clock.Now())
		if updateErr != nil {
			if errors.Is(updateErr, domainresource.ErrRevisionConflict) {
				return ErrRevisionConflict
			}
			return errno.Wrap(errno.ErrInvalidArgument, updateErr)
		}
		if !changed {
			return nil
		}
		return s.repository.Update(txCtx, item)
	}
	var err error
	if s.transactions == nil {
		err = run(ctx)
	} else {
		err = s.transactions.WithinTransaction(ctx, run)
	}
	return item, classifyError(err)
}

func (s *Service) CreateResourceAsset(ctx context.Context, input CreateResourceAssetInput) (domainresource.ResourceAsset, error) {
	hasAsset := strings.TrimSpace(input.AssetID) != ""
	hasBlob := strings.TrimSpace(input.BlobID) != ""
	hasFileName := strings.TrimSpace(input.FileName) != ""
	if !validScope(input.Scope) || input.ProjectID == "" || input.ResourceID == "" || input.ExpectedResourceRevision < 1 ||
		hasBlob != hasFileName || hasAsset == hasBlob || s.transactions == nil || (hasAsset && s.assets == nil) || (hasBlob && s.assetCreator == nil) {
		return domainresource.ResourceAsset{}, errno.New(errno.ErrInvalidArgument)
	}
	if input.Name != nil {
		if err := domainresource.ValidateResourceAssetName(*input.Name); err != nil {
			return domainresource.ResourceAsset{}, errno.Wrap(errno.ErrInvalidArgument, err)
		}
	}
	var created domainresource.ResourceAsset
	var createdAsset domainasset.Asset
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		parent, err := s.repository.GetForUpdate(txCtx, input.Scope, input.ProjectID, input.ResourceID)
		if err != nil {
			return err
		}
		if parent.OwnerType.ReadOnly() {
			return domainresource.ErrReadOnly
		}
		if parent.Revision != input.ExpectedResourceRevision {
			return ErrRevisionConflict
		}
		if parent.ResourceAssetCount >= parent.ResourceAssetLimit() {
			return ErrResourceAssetLimitExceeded
		}
		var assetItem domainasset.Asset
		if hasBlob {
			assetItem, err = s.assetCreator.Create(txCtx, applicationasset.CreateInput{
				Scope:     applicationasset.Scope{TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CallerID: input.CallerID},
				ProjectID: &input.ProjectID,
				OwnerType: domainasset.OwnerResource, OwnerID: parent.ID, BlobID: input.BlobID, FileName: input.FileName,
			})
			createdAsset = assetItem
		} else {
			assetItem, err = s.assets.BypassGetForUpdate(txCtx, applicationasset.BypassGetInput{Scope: applicationasset.Scope{TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CallerID: input.CallerID}, AssetID: input.AssetID})
		}
		if err != nil {
			return err
		}
		if assetItem.TenantID != parent.TenantID || !equalStrings(assetItem.WorkspaceID, parent.WorkspaceID) {
			return ErrAssetOwnerMismatch
		}
		if hasAsset && assetItem.OwnerType == domainasset.OwnerProject && assetItem.OwnerID == input.ProjectID {
			if s.assetImporter == nil {
				return errno.New(errno.ErrInvalidArgument)
			}
			assetItem, err = s.assetImporter.CreateFromArtifact(txCtx, applicationasset.CreateFromArtifactInput{
				Scope:     applicationasset.Scope{TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CallerID: input.CallerID},
				OwnerType: domainasset.OwnerResource, OwnerID: parent.ID,
				CreationKey: "resource-import:" + parent.ID + ":" + input.AssetID,
				ArtifactID:  assetItem.ArtifactID, ArtifactNamespace: assetItem.ArtifactNamespace, FileName: assetItem.FileName, MediaType: assetItem.MediaType,
				ContentType: assetItem.ContentType, SizeBytes: assetItem.SizeBytes,
			})
			if err != nil {
				return err
			}
		}
		if assetItem.OwnerType != domainasset.OwnerResource || assetItem.OwnerID != parent.ID {
			return ErrAssetOwnerMismatch
		}
		if !mediaMatches(parent.Type, assetItem.MediaType) {
			return ErrAssetMediaTypeMismatch
		}
		sequence, err := s.repository.NextResourceAssetSequence(txCtx, parent.ID)
		if err != nil {
			return err
		}
		name := ""
		if input.Name != nil {
			name = *input.Name
		} else {
			name = domainresource.DefaultResourceAssetName(assetItem.FileName)
		}
		if err = domainresource.ValidateResourceAssetName(name); err != nil {
			return errno.Wrap(errno.ErrInvalidArgument, err)
		}
		exists, err := s.repository.ResourceAssetNameExists(txCtx, parent.ID, name)
		if err != nil {
			return err
		}
		if exists {
			return ErrResourceAssetNameConflict
		}
		id, err := s.ids.NewID()
		if err != nil {
			return errno.Wrap(errno.ErrInternalError, err)
		}
		created, err = domainresource.NewResourceAsset(domainresource.NewResourceAssetInput{ID: id, ResourceID: parent.ID, Name: name, SequenceNo: sequence, CurrentAssetID: assetItem.ID, MediaType: assetItem.MediaType, Now: s.clock.Now()})
		if err != nil {
			return errno.Wrap(errno.ErrInvalidArgument, err)
		}
		if err = s.repository.CreateResourceAsset(txCtx, created, assetItem.ID); err != nil {
			return err
		}
		if err = s.acquireResourceAssetRevision(txCtx, input.Scope, created.ID, assetItem.ID); err != nil {
			return err
		}
		if err = parent.AttachResourceAsset(input.ExpectedResourceRevision, created.ID, s.clock.Now()); err != nil {
			return ErrRevisionConflict
		}
		return s.repository.Update(txCtx, parent)
	})
	if err != nil {
		if createdAsset.ID != "" {
			if compensationErr := s.assetCreator.CompensateCreated(ctx, createdAsset); compensationErr != nil && s.cleanupFailure != nil {
				reportCtx := logcontext.WithBusiness(ctx, logcontext.Business{
					TenantID: input.TenantID, WorkspaceID: input.WorkspaceID,
					ResourceID: input.ResourceID, CleanupStage: "resource_asset_artifact_compensation",
				})
				s.cleanupFailure.Report(reportCtx, compensationErr)
			}
		}
		return domainresource.ResourceAsset{}, classifyError(err)
	}
	return created, nil
}

func (s *Service) CreateGeneratedResourceAsset(ctx context.Context, input CreateGeneratedResourceAssetInput) (domainresource.ResourceAsset, domainresourceassetgeneration.Draft, error) {
	if !validScope(input.Scope) || strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.ResourceID) == "" ||
		input.ExpectedResourceRevision < 1 || s.transactions == nil || s.imageGenerationDrafts == nil {
		return domainresource.ResourceAsset{}, domainresourceassetgeneration.Draft{}, errno.New(errno.ErrInvalidArgument)
	}
	var slot domainresource.ResourceAsset
	var draft domainresourceassetgeneration.Draft
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		parent, err := s.repository.GetForUpdate(txCtx, input.Scope, input.ProjectID, input.ResourceID)
		if err != nil {
			return err
		}
		if parent.Revision != input.ExpectedResourceRevision {
			return ErrRevisionConflict
		}
		if parent.Type != domainresource.TypeCharacter && parent.Type != domainresource.TypeScene && parent.Type != domainresource.TypeProp {
			return errno.New(errno.ErrInvalidArgument)
		}
		if parent.ResourceAssetCount >= parent.ResourceAssetLimit() {
			return ErrResourceAssetLimitExceeded
		}
		sequence, err := s.repository.NextResourceAssetSequence(txCtx, parent.ID)
		if err != nil {
			return err
		}
		slotID, err := s.ids.NewID()
		if err != nil {
			return errno.Wrap(errno.ErrInternalError, err)
		}
		draftID, err := s.ids.NewID()
		if err != nil {
			return errno.Wrap(errno.ErrInternalError, err)
		}
		now := s.clock.Now()
		slot, err = domainresource.NewGeneratedResourceAsset(domainresource.NewGeneratedResourceAssetInput{
			ID: slotID, ResourceID: parent.ID, ResourceName: parent.Name, SequenceNo: sequence,
			ImageGenerationDraftID: draftID, Now: now,
		})
		if err != nil {
			return errno.Wrap(errno.ErrInvalidArgument, err)
		}
		exists, err := s.repository.ResourceAssetNameExists(txCtx, parent.ID, slot.Name)
		if err != nil {
			return err
		}
		if exists {
			return ErrResourceAssetNameConflict
		}
		draft, err = domainresourceassetgeneration.NewDraft(domainresourceassetgeneration.NewDraftInput{
			ID: draftID, TenantID: parent.TenantID, WorkspaceID: parent.WorkspaceID,
			ResourceID: parent.ID, ResourceAssetID: slot.ID, CreatedBy: input.CallerID, Now: now,
		})
		if err != nil {
			return errno.Wrap(errno.ErrInvalidArgument, err)
		}
		if err = s.repository.CreateResourceAsset(txCtx, slot, ""); err != nil {
			return err
		}
		if err = s.imageGenerationDrafts.Create(txCtx, draft); err != nil {
			return err
		}
		if err = parent.AttachResourceAsset(input.ExpectedResourceRevision, slot.ID, now); err != nil {
			return ErrRevisionConflict
		}
		return s.repository.Update(txCtx, parent)
	})
	if err != nil {
		return domainresource.ResourceAsset{}, domainresourceassetgeneration.Draft{}, classifyError(err)
	}
	return slot, draft, nil
}

func (s *Service) UpdateResourceAsset(ctx context.Context, input UpdateResourceAssetInput) (domainresource.ResourceAsset, error) {
	if !validScope(input.Scope) || input.ProjectID == "" || input.ResourceID == "" || input.ResourceAssetID == "" || input.ExpectedResourceRevision < 1 || input.ExpectedResourceAssetRevision < 1 || (input.Name == nil && input.AssetID == nil) || s.transactions == nil {
		return domainresource.ResourceAsset{}, errno.New(errno.ErrInvalidArgument)
	}
	if input.Name != nil {
		if err := domainresource.ValidateResourceAssetName(*input.Name); err != nil {
			return domainresource.ResourceAsset{}, errno.Wrap(errno.ErrInvalidArgument, err)
		}
	}
	var updated domainresource.ResourceAsset
	var revisionAssetID *string
	var replacedAssetID string
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		parent, err := s.repository.GetForUpdate(txCtx, input.Scope, input.ProjectID, input.ResourceID)
		if err != nil {
			return err
		}
		if parent.OwnerType.ReadOnly() {
			return domainresource.ErrReadOnly
		}
		if parent.Revision != input.ExpectedResourceRevision {
			return ErrRevisionConflict
		}
		updated, err = s.repository.GetResourceAssetForUpdate(txCtx, parent.ID, input.ResourceAssetID)
		if err != nil {
			return err
		}
		if updated.Revision != input.ExpectedResourceAssetRevision {
			return domainresource.ErrResourceAssetRevisionConflict
		}
		if input.Name != nil && *input.Name != updated.Name {
			exists, existsErr := s.repository.ResourceAssetNameExists(txCtx, parent.ID, *input.Name)
			if existsErr != nil {
				return existsErr
			}
			if exists {
				return ErrResourceAssetNameConflict
			}
		}
		var mediaType *domainasset.MediaType
		if input.AssetID != nil {
			selectedMediaType := updated.MediaType
			mediaType = &selectedMediaType
		}
		if input.AssetID != nil && *input.AssetID != updated.CurrentAssetID {
			if s.assets == nil {
				return errno.New(errno.ErrInvalidArgument)
			}
			assetItem, assetErr := s.assets.BypassGetForUpdate(txCtx, applicationasset.BypassGetInput{Scope: applicationasset.Scope{TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CallerID: input.CallerID}, AssetID: *input.AssetID})
			if assetErr != nil {
				return assetErr
			}
			if assetErr = validateAssetForResource(parent, assetItem); assetErr != nil {
				return assetErr
			}
			exists, existsErr := s.repository.ResourceAssetRevisionExists(txCtx, updated.ID, assetItem.ID)
			if existsErr != nil {
				return existsErr
			}
			if exists {
				return errno.New(errno.ErrInvalidArgument)
			}
			revisionAssetID = &assetItem.ID
			replacedAssetID = updated.CurrentAssetID
			selectedMediaType := assetItem.MediaType
			mediaType = &selectedMediaType
		}
		changed, err := updated.Update(input.Name, input.AssetID, mediaType, input.ExpectedResourceAssetRevision, s.clock.Now())
		if err != nil {
			if errors.Is(err, domainresource.ErrResourceAssetRevisionConflict) {
				return err
			}
			return errno.Wrap(errno.ErrInvalidArgument, err)
		}
		if !changed {
			return nil
		}
		if err = s.repository.UpdateResourceAsset(txCtx, updated, input.ExpectedResourceAssetRevision, revisionAssetID); err != nil {
			return err
		}
		if revisionAssetID != nil {
			if err = s.acquireResourceAssetRevision(txCtx, input.Scope, updated.ID, *revisionAssetID); err != nil {
				return err
			}
		}
		if revisionAssetID != nil && replacedAssetID != "" {
			if err = s.prepareResourceAssetReviewCleanup(txCtx, input.Scope, []string{replacedAssetID}); err != nil {
				return err
			}
		}
		if err = parent.Touch(input.ExpectedResourceRevision, s.clock.Now()); err != nil {
			return ErrRevisionConflict
		}
		return s.repository.Update(txCtx, parent)
	})
	if err != nil {
		return domainresource.ResourceAsset{}, classifyError(err)
	}
	return updated, nil
}

func (s *Service) RenameResourceAsset(ctx context.Context, input RenameResourceAssetInput) (domainresource.ResourceAsset, error) {
	return s.UpdateResourceAsset(ctx, UpdateResourceAssetInput{
		Scope: input.Scope, ProjectID: input.ProjectID, ResourceID: input.ResourceID,
		ResourceAssetID: input.ResourceAssetID, Name: &input.Name,
		ExpectedResourceRevision:      input.ExpectedResourceRevision,
		ExpectedResourceAssetRevision: input.ExpectedResourceAssetRevision,
	})
}

func (s *Service) ReplaceUploadedResourceAsset(ctx context.Context, input ReplaceUploadedResourceAssetInput) (domainresource.ResourceAsset, error) {
	if !validScope(input.Scope) || strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.ResourceID) == "" ||
		strings.TrimSpace(input.ResourceAssetID) == "" || strings.TrimSpace(input.BlobID) == "" || strings.TrimSpace(input.FileName) == "" ||
		input.ExpectedResourceRevision < 1 || input.ExpectedResourceAssetRevision < 1 || s.transactions == nil || s.assetCreator == nil {
		return domainresource.ResourceAsset{}, errno.New(errno.ErrInvalidArgument)
	}

	var updated domainresource.ResourceAsset
	var createdAsset domainasset.Asset
	var replacedAssetID string
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		parent, err := s.repository.GetForUpdate(txCtx, input.Scope, input.ProjectID, input.ResourceID)
		if err != nil {
			return err
		}
		if parent.OwnerType.ReadOnly() {
			return domainresource.ErrReadOnly
		}
		if parent.Revision != input.ExpectedResourceRevision {
			return ErrRevisionConflict
		}
		updated, err = s.repository.GetResourceAssetForUpdate(txCtx, parent.ID, input.ResourceAssetID)
		if err != nil {
			return err
		}
		if updated.Revision != input.ExpectedResourceAssetRevision {
			return domainresource.ErrResourceAssetRevisionConflict
		}
		if updated.SourceType != domainresource.SourceUpload {
			return domainresource.ErrResourceAssetSourceTypeMismatch
		}
		replacedAssetID = updated.CurrentAssetID

		createdAsset, err = s.assetCreator.Create(txCtx, applicationasset.CreateInput{
			Scope:     applicationasset.Scope{TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CallerID: input.CallerID},
			ProjectID: &input.ProjectID,
			OwnerType: domainasset.OwnerResource, OwnerID: parent.ID, BlobID: input.BlobID, FileName: input.FileName,
		})
		if err != nil {
			return err
		}
		if err = validateAssetForResource(parent, createdAsset); err != nil {
			return err
		}
		exists, err := s.repository.ResourceAssetRevisionExists(txCtx, updated.ID, createdAsset.ID)
		if err != nil {
			return err
		}
		if exists {
			return errno.New(errno.ErrInvalidArgument)
		}
		changed, err := updated.SelectUploadedAsset(createdAsset.ID, createdAsset.MediaType, input.ExpectedResourceAssetRevision, s.clock.Now())
		if err != nil {
			return err
		}
		if !changed {
			return nil
		}
		if err = s.repository.UpdateResourceAsset(txCtx, updated, input.ExpectedResourceAssetRevision, &createdAsset.ID); err != nil {
			return err
		}
		if err = s.acquireResourceAssetRevision(txCtx, input.Scope, updated.ID, createdAsset.ID); err != nil {
			return err
		}
		if replacedAssetID != "" {
			if err = s.prepareResourceAssetReviewCleanup(txCtx, input.Scope, []string{replacedAssetID}); err != nil {
				return err
			}
		}
		if err = parent.Touch(input.ExpectedResourceRevision, s.clock.Now()); err != nil {
			return ErrRevisionConflict
		}
		return s.repository.Update(txCtx, parent)
	})
	if err != nil {
		if createdAsset.ID != "" {
			if compensationErr := s.assetCreator.CompensateCreated(ctx, createdAsset); compensationErr != nil && s.cleanupFailure != nil {
				reportCtx := logcontext.WithBusiness(ctx, logcontext.Business{
					TenantID: input.TenantID, WorkspaceID: input.WorkspaceID,
					ResourceID: input.ResourceID, CleanupStage: "resource_asset_replacement_compensation",
				})
				s.cleanupFailure.Report(reportCtx, compensationErr)
			}
		}
		return domainresource.ResourceAsset{}, classifyError(err)
	}
	return updated, nil
}

func assetReferenceScope(scope Scope) applicationasset.ReferenceScope {
	return applicationasset.ReferenceScope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}
}

func (s *Service) SetPrimaryResourceAsset(ctx context.Context, input SetPrimaryResourceAssetInput) (domainresource.Resource, error) {
	if !validScope(input.Scope) || input.ProjectID == "" || input.ResourceID == "" || input.ResourceAssetID == "" || input.ExpectedResourceRevision < 1 || s.transactions == nil {
		return domainresource.Resource{}, errno.New(errno.ErrInvalidArgument)
	}
	var parent domainresource.Resource
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		var err error
		parent, err = s.repository.GetForUpdate(txCtx, input.Scope, input.ProjectID, input.ResourceID)
		if err != nil {
			return err
		}
		if parent.OwnerType.ReadOnly() {
			return domainresource.ErrReadOnly
		}
		if parent.Revision != input.ExpectedResourceRevision {
			return ErrRevisionConflict
		}
		if _, err = s.repository.GetResourceAssetForUpdate(txCtx, parent.ID, input.ResourceAssetID); err != nil {
			return err
		}
		changed, err := parent.TouchAssets(input.ExpectedResourceRevision, &input.ResourceAssetID, parent.ResourceAssetCount, s.clock.Now())
		if err != nil {
			return ErrRevisionConflict
		}
		if !changed {
			return nil
		}
		return s.repository.Update(txCtx, parent)
	})
	if err != nil {
		return domainresource.Resource{}, classifyError(err)
	}
	return parent, nil
}

func (s *Service) DeleteResourceAsset(ctx context.Context, input DeleteResourceAssetInput) error {
	if !validScope(input.Scope) || input.ProjectID == "" || input.ResourceID == "" || input.ResourceAssetID == "" || input.ExpectedResourceRevision < 1 || input.ExpectedResourceAssetRevision < 1 || s.transactions == nil {
		return errno.New(errno.ErrInvalidArgument)
	}
	var reviewCleanupAssetIDs []string
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		parent, err := s.repository.GetForUpdate(txCtx, input.Scope, input.ProjectID, input.ResourceID)
		if err != nil {
			return err
		}
		if parent.OwnerType.ReadOnly() {
			return domainresource.ErrReadOnly
		}
		if parent.Revision != input.ExpectedResourceRevision {
			return ErrRevisionConflict
		}
		child, err := s.repository.GetResourceAssetForUpdate(txCtx, parent.ID, input.ResourceAssetID)
		if err != nil {
			return err
		}
		if child.Revision != input.ExpectedResourceAssetRevision {
			return domainresource.ErrResourceAssetRevisionConflict
		}
		if err = child.Delete(input.ExpectedResourceAssetRevision, s.clock.Now()); err != nil {
			return err
		}
		items, _, err := s.repository.ListResourceAssets(txCtx, parent.ID, nil, 1000, 1)
		if err != nil {
			return err
		}
		var nextPrimary *string
		if parent.PrimaryResourceAssetID != nil && *parent.PrimaryResourceAssetID != child.ID {
			nextPrimary = parent.PrimaryResourceAssetID
		} else {
			for _, candidate := range items {
				if candidate.ID != child.ID {
					id := candidate.ID
					nextPrimary = &id
					break
				}
			}
		}
		reviewCleanupAssetIDs, err = s.repository.DeleteResourceAsset(txCtx, child, input.ExpectedResourceAssetRevision, s.clock.Now())
		if err != nil {
			return err
		}
		if err = s.releaseAllResourceAssetRevisions(txCtx, input.Scope, child.ID); err != nil {
			return err
		}
		if err = s.prepareResourceAssetReviewCleanup(txCtx, input.Scope, reviewCleanupAssetIDs); err != nil {
			return err
		}
		if child.SourceType == domainresource.SourceGenerated && child.ImageGenerationDraftID != "" {
			if s.generationDeleter != nil {
				if err = s.generationDeleter.DeleteGeneration(txCtx, input.Scope, child.ImageGenerationDraftID, s.clock.Now()); err != nil {
					return err
				}
			}
			if s.imageGenerationDrafts == nil {
				return errors.New("image generation draft store is not configured")
			}
			_, err = s.imageGenerationDrafts.Delete(
				txCtx, input.TenantID, input.WorkspaceID, child.ImageGenerationDraftID, s.clock.Now(),
			)
			if err != nil {
				return err
			}
			if err = s.releaseImageGenerationDraftUploads(txCtx, input.Scope, child.ImageGenerationDraftID); err != nil {
				return err
			}
		}
		if _, err = parent.TouchAssets(input.ExpectedResourceRevision, nextPrimary, parent.ResourceAssetCount-1, s.clock.Now()); err != nil {
			return ErrRevisionConflict
		}
		return s.repository.Update(txCtx, parent)
	})
	if err != nil {
		return classifyError(err)
	}
	return nil
}

func (s *Service) Delete(ctx context.Context, input DeleteInput) error {
	if !validScope(input.Scope) || input.ProjectID == "" || input.ResourceID == "" || input.ExpectedRevision < 1 || s.transactions == nil {
		return errno.New(errno.ErrInvalidArgument)
	}
	var reviewCleanupAssetIDs []string
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		item, err := s.repository.GetForUpdate(txCtx, input.Scope, input.ProjectID, input.ResourceID)
		if err != nil {
			return err
		}
		if item.OwnerType.ReadOnly() {
			return domainresource.ErrReadOnly
		}
		if err = item.Delete(input.ExpectedRevision, s.clock.Now()); err != nil {
			return ErrRevisionConflict
		}
		children, _, listErr := s.repository.ListResourceAssets(txCtx, item.ID, nil, 1000, 1)
		if listErr != nil {
			return listErr
		}
		reviewCleanupAssetIDs, err = s.repository.DeleteWithRevisionAssets(txCtx, item, s.clock.Now())
		if err != nil {
			return err
		}
		if err = s.prepareResourceAssetReviewCleanup(txCtx, input.Scope, reviewCleanupAssetIDs); err != nil {
			return err
		}
		for _, child := range children {
			if err = s.releaseAllResourceAssetRevisions(txCtx, input.Scope, child.ID); err != nil {
				return err
			}
			if child.ImageGenerationDraftID != "" && s.generationDeleter != nil {
				if err = s.generationDeleter.DeleteGeneration(txCtx, input.Scope, child.ImageGenerationDraftID, s.clock.Now()); err != nil {
					return err
				}
			}
		}
		if s.imageGenerationDrafts != nil {
			_, err = s.imageGenerationDrafts.DeleteByResource(
				txCtx, input.TenantID, input.WorkspaceID, input.ResourceID, s.clock.Now(),
			)
			if err == nil {
				for _, child := range children {
					if child.ImageGenerationDraftID != "" {
						err = s.releaseImageGenerationDraftUploads(txCtx, input.Scope, child.ImageGenerationDraftID)
						if err != nil {
							break
						}
					}
				}
			}
		}
		return err
	})
	if err != nil {
		return classifyError(err)
	}
	s.cleanupResourceAssets(ctx, input.Scope, input.ResourceID)
	s.refreshResourceCount(ctx, input.Scope, input.ProjectID)
	return nil
}

func (s *Service) prepareResourceAssetReviewCleanup(ctx context.Context, scope Scope, assetIDs []string) error {
	if s.assetDeleter == nil || len(assetIDs) == 0 {
		return nil
	}
	return s.assetDeleter.PrepareReviewCleanup(ctx, applicationasset.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
	}, assetIDs)
}

func (s *Service) DeleteByProject(ctx context.Context, input DeleteByProjectInput) error {
	if !validScope(input.Scope) || input.ProjectID == "" || s.transactions == nil {
		return errno.New(errno.ErrInvalidArgument)
	}
	var items []domainresource.Resource
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		var err error
		items, err = s.repository.ListByProjectForUpdate(txCtx, input.Scope, input.ProjectID)
		if err != nil {
			return err
		}
		for index := range items {
			children, _, listErr := s.repository.ListResourceAssets(txCtx, items[index].ID, nil, 1000, 1)
			if listErr != nil {
				return listErr
			}
			if err = items[index].Delete(items[index].Revision, s.clock.Now()); err != nil {
				return err
			}
			var deletedAssetIDs []string
			deletedAssetIDs, err = s.repository.DeleteWithRevisionAssets(txCtx, items[index], s.clock.Now())
			if err != nil {
				return err
			}
			if err = s.prepareResourceAssetReviewCleanup(txCtx, input.Scope, deletedAssetIDs); err != nil {
				return err
			}
			for _, child := range children {
				if err = s.releaseAllResourceAssetRevisions(txCtx, input.Scope, child.ID); err != nil {
					return err
				}
				if child.ImageGenerationDraftID != "" && s.generationDeleter != nil {
					if err = s.generationDeleter.DeleteGeneration(txCtx, input.Scope, child.ImageGenerationDraftID, s.clock.Now()); err != nil {
						return err
					}
				}
			}
			if s.imageGenerationDrafts != nil {
				_, err = s.imageGenerationDrafts.DeleteByResource(
					txCtx, input.TenantID, input.WorkspaceID, items[index].ID, s.clock.Now(),
				)
				if err != nil {
					return err
				}
				for _, child := range children {
					if child.ImageGenerationDraftID != "" {
						if err = s.releaseImageGenerationDraftUploads(txCtx, input.Scope, child.ImageGenerationDraftID); err != nil {
							return err
						}
					}
				}
			}
		}
		return nil
	})
	if err != nil {
		return classifyError(err)
	}
	for _, item := range items {
		s.cleanupResourceAssets(ctx, input.Scope, item.ID)
	}
	return nil
}

func (s *Service) ListResourceAssets(ctx context.Context, input ListResourceAssetsInput) ([]domainresource.ResourceAsset, int64, error) {
	if !validScope(input.Scope) || input.ProjectID == "" || input.ResourceID == "" || input.Page.PageSize < 1 || input.Page.PageSize > maxPageSize || input.Page.PageNum < 1 {
		return nil, 0, errno.New(errno.ErrInvalidArgument)
	}
	parent, err := s.repository.Get(ctx, input.Scope, input.ProjectID, input.ResourceID)
	if err != nil {
		return nil, 0, classifyError(err)
	}
	items, total, err := s.repository.ListResourceAssets(ctx, input.ResourceID, parent.PrimaryResourceAssetID, input.Page.PageSize, input.Page.PageNum)
	if err != nil {
		return nil, 0, classifyError(err)
	}
	return items, total, nil
}

func (s *Service) GetProjectResourceStats(ctx context.Context, input GetProjectResourceStatsInput) (ResourceStats, error) {
	if !validScope(input.Scope) || strings.TrimSpace(input.ProjectID) == "" {
		return ResourceStats{}, errno.New(errno.ErrInvalidArgument)
	}
	s.materializeOfficial(ctx, input.Scope)
	stats, err := s.repository.StatsByProject(ctx, input.Scope, input.ProjectID)
	return stats, classifyError(err)
}

func (s *Service) GetResourceAsset(ctx context.Context, input GetResourceAssetInput) (domainresource.ResourceAsset, error) {
	if !validScope(input.Scope) || input.ProjectID == "" || input.ResourceID == "" || input.ResourceAssetID == "" {
		return domainresource.ResourceAsset{}, errno.New(errno.ErrInvalidArgument)
	}
	if _, err := s.repository.Get(ctx, input.Scope, input.ProjectID, input.ResourceID); err != nil {
		return domainresource.ResourceAsset{}, classifyError(err)
	}
	item, err := s.repository.GetResourceAsset(ctx, input.ResourceID, input.ResourceAssetID)
	return item, classifyError(err)
}

func (s *Service) BatchGetResourceAssets(ctx context.Context, input BatchGetResourceAssetsInput) ([]domainresource.ResourceAsset, error) {
	ids, valid := normalizeIDs(input.ResourceAssetIDs)
	if !validScope(input.Scope) || input.ProjectID == "" || !valid {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	if len(ids) == 0 {
		return []domainresource.ResourceAsset{}, nil
	}
	items, err := s.repository.BatchGetResourceAssets(ctx, input.Scope, input.ProjectID, ids)
	return items, classifyError(err)
}

func (s *Service) BatchListResourceAssets(ctx context.Context, input BatchListResourceAssetsInput) ([]ResourceAssetGroup, error) {
	ids, valid := normalizeIDs(input.ResourceIDs)
	if !validScope(input.Scope) || strings.TrimSpace(input.ProjectID) == "" || !valid || len(ids) == 0 || len(ids) > 100 {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	parents, err := s.BatchGet(ctx, BatchGetInput{Scope: input.Scope, ProjectID: input.ProjectID, ResourceIDs: ids})
	if err != nil {
		return nil, err
	}
	if len(parents) != len(ids) {
		return nil, errno.New(errno.ErrResourceNotFound)
	}
	items, err := s.repository.ListResourceAssetsByResourceIDs(ctx, input.Scope, input.ProjectID, ids)
	if err != nil {
		return nil, classifyError(err)
	}
	byResource := make(map[string][]domainresource.ResourceAsset, len(ids))
	for _, item := range items {
		byResource[item.ResourceID] = append(byResource[item.ResourceID], item)
	}
	groups := make([]ResourceAssetGroup, 0, len(parents))
	for _, parent := range parents {
		groups = append(groups, ResourceAssetGroup{Resource: parent, Items: byResource[parent.ID]})
	}
	return groups, nil
}

type resourceAssetDeleter interface {
	DeleteResourceAsset(context.Context, DeleteResourceAssetInput) error
}

func batchDeleteResourceAssets(ctx context.Context, service resourceAssetDeleter, input BatchDeleteResourceAssetsInput) error {
	if !validScope(input.Scope) || input.ProjectID == "" || input.ResourceID == "" || len(input.Targets) == 0 || len(input.Targets) > 100 {
		return errno.New(errno.ErrInvalidArgument)
	}
	seen := make(map[string]struct{}, len(input.Targets))
	for _, target := range input.Targets {
		if target.ResourceAssetID == "" || target.ExpectedResourceRevision < 1 || target.ExpectedResourceAssetRevision < 1 {
			return errno.New(errno.ErrInvalidArgument)
		}
		if _, ok := seen[target.ResourceAssetID]; ok {
			continue
		}
		seen[target.ResourceAssetID] = struct{}{}
		if err := service.DeleteResourceAsset(ctx, DeleteResourceAssetInput{
			Scope: input.Scope, ProjectID: input.ProjectID, ResourceID: input.ResourceID,
			ResourceAssetID: target.ResourceAssetID, ExpectedResourceRevision: target.ExpectedResourceRevision,
			ExpectedResourceAssetRevision: target.ExpectedResourceAssetRevision,
		}); err != nil && errno.CodeOf(err) != errno.ErrResourceAssetNotFound {
			return err
		}
	}
	return nil
}

func (s *Service) BatchDeleteResourceAssets(ctx context.Context, input BatchDeleteResourceAssetsInput) error {
	return batchDeleteResourceAssets(ctx, s, input)
}

func (s *Service) BatchDelete(ctx context.Context, input BatchDeleteInput) error {
	if !validScope(input.Scope) || input.ProjectID == "" || len(input.Targets) > 100 {
		return errno.New(errno.ErrInvalidArgument)
	}
	if err := s.projects.Validate(ctx, input.Scope, input.ProjectID); err != nil {
		return classifyError(err)
	}
	seen := make(map[string]struct{}, len(input.Targets))
	for _, target := range input.Targets {
		if target.ResourceID == "" || target.ExpectedRevision < 1 {
			return errno.New(errno.ErrInvalidArgument)
		}
		if _, exists := seen[target.ResourceID]; exists {
			continue
		}
		seen[target.ResourceID] = struct{}{}
		err := s.Delete(ctx, DeleteInput{Scope: input.Scope, ProjectID: input.ProjectID, ResourceID: target.ResourceID, ExpectedRevision: target.ExpectedRevision})
		if errno.CodeOf(err) == errno.ErrResourceNotFound {
			continue
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) cleanupResourceAssets(ctx context.Context, scope Scope, resourceID string) {
	if s.assetDeleter == nil {
		return
	}
	err := s.assetDeleter.DeleteByOwner(ctx, applicationasset.DeleteByOwnerInput{Scope: applicationasset.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID}, OwnerType: domainasset.OwnerResource, OwnerID: resourceID})
	if err != nil && s.cleanupFailure != nil {
		reportCtx := logcontext.WithBusiness(ctx, logcontext.Business{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
			ResourceID: resourceID, CleanupStage: "resource_asset_metadata",
		})
		s.cleanupFailure.Report(reportCtx, err)
	}
}

func (s *Service) acquireResourceAssetRevision(ctx context.Context, scope Scope, resourceAssetID, assetID string) error {
	if s.assetReferences == nil {
		return nil
	}
	return s.assetReferences.AcquireAssets(ctx, applicationasset.AcquireAssetsInput{
		Scope:    assetReferenceScope(scope),
		Owner:    applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetRevision, Key: resourceAssetID},
		AssetIDs: []string{assetID},
	})
}

func (s *Service) releaseAllResourceAssetRevisions(ctx context.Context, scope Scope, resourceAssetID string) error {
	if s.assetReferences == nil {
		return nil
	}
	return s.assetReferences.ReleaseAllAssets(ctx, applicationasset.ReleaseAllAssetsInput{
		Scope: assetReferenceScope(scope),
		Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetRevision, Key: resourceAssetID},
	})
}

func (s *Service) releaseImageGenerationDraftUploads(ctx context.Context, scope Scope, draftID string) error {
	if s.assetReferences == nil {
		return nil
	}
	return s.assetReferences.ReleaseAllAssets(ctx, applicationasset.ReleaseAllAssetsInput{
		Scope: assetReferenceScope(scope),
		Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetGenerationUpload, Key: draftID},
	})
}

func (s *Service) refreshResourceCount(ctx context.Context, scope Scope, projectID string) {
	if s.projectStatistics == nil {
		return
	}
	projectCtx := logcontext.WithBusiness(ctx, logcontext.Business{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ProjectID: projectID,
	})
	s.projectStatistics.Refresh(projectCtx, applicationprojectstatistics.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	}, projectID, applicationprojectstatistics.ResourceCountField)
}

func validScope(scope Scope) bool {
	return strings.TrimSpace(scope.TenantID) != "" && strings.TrimSpace(scope.CallerID) != ""
}

func normalizeIDs(input []string) ([]string, bool) {
	if len(input) > maxBatchGetIDs {
		return nil, false
	}
	seen := make(map[string]struct{}, len(input))
	result := make([]string, 0, len(input))
	for _, id := range input {
		if strings.TrimSpace(id) == "" {
			return nil, false
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result, true
}

func mediaMatches(resourceType domainresource.Type, mediaType domainasset.MediaType) bool {
	if resourceType == domainresource.TypeAudio {
		return mediaType == domainasset.MediaAudio
	}
	return (resourceType == domainresource.TypeCharacter || resourceType == domainresource.TypeScene || resourceType == domainresource.TypeProp) && mediaType == domainasset.MediaImage
}

func validateAssetForResource(parent domainresource.Resource, item domainasset.Asset) error {
	if item.OwnerType != domainasset.OwnerResource || item.OwnerID != parent.ID || item.TenantID != parent.TenantID || !equalStrings(item.WorkspaceID, parent.WorkspaceID) {
		return ErrAssetOwnerMismatch
	}
	if !mediaMatches(parent.Type, item.MediaType) {
		return ErrAssetMediaTypeMismatch
	}
	return nil
}

func equalStrings(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func classifyError(err error) error {
	if err == nil {
		return nil
	}
	var bizErr *errno.BizError
	if errors.As(err, &bizErr) {
		return err
	}
	switch {
	case errors.Is(err, ErrNotFound):
		return errno.Wrap(errno.ErrResourceNotFound, err)
	case errors.Is(err, ErrResourceAssetNotFound):
		return errno.Wrap(errno.ErrResourceAssetNotFound, err)
	case errors.Is(err, ErrProjectNotFound):
		return errno.Wrap(errno.ErrNotFound, err)
	case errors.Is(err, ErrNameConflict):
		return errno.Wrap(errno.ErrResourceNameConflict, err)
	case errors.Is(err, ErrLimitExceeded):
		return errno.Wrap(errno.ErrResourceLimitExceeded, err)
	case errors.Is(err, ErrRevisionConflict), errors.Is(err, domainresource.ErrRevisionConflict):
		return errno.Wrap(errno.ErrResourceRevisionConflict, err)
	case errors.Is(err, ErrResourceAssetNameConflict):
		return errno.Wrap(errno.ErrResourceAssetNameConflict, err)
	case errors.Is(err, ErrResourceAssetLimitExceeded):
		return errno.Wrap(errno.ErrResourceAssetLimitExceeded, err)
	case errors.Is(err, domainresource.ErrReadOnly):
		return errno.Wrap(errno.ErrResourceReadOnly, err)
	case errors.Is(err, domainresource.ErrResourceAssetRevisionConflict):
		return errno.Wrap(errno.ErrResourceAssetRevisionConflict, err)
	case errors.Is(err, domainresource.ErrResourceAssetSourceTypeMismatch):
		return errno.Wrap(errno.ErrResourceAssetSourceTypeMismatch, err)
	case errors.Is(err, ErrAssetMediaTypeMismatch):
		return errno.Wrap(errno.ErrResourceAssetMediaTypeMismatch, err)
	case errors.Is(err, ErrAssetOwnerMismatch):
		return errno.Wrap(errno.ErrResourceAssetOwnerMismatch, err)
	case errors.Is(err, ErrCanvasNodeAssetNotBindable):
		return errno.Wrap(errno.ErrFailedPrecondition, err)
	default:
		return errno.Wrap(errno.ErrInternalError, err)
	}
}
