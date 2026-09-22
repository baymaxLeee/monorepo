package canvas

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/domain/assetmatching"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	domainresource "github.com/example/monorepo/canvas/internal/domain/resource"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const maxBatchAssetRead = 100

// CanvasNodeAssetRepository exposes the project asset catalogue used by the @
// picker. Consuming an item never creates a hidden binding: the graph service
// materializes an asset node and an edge, which are the only reference facts.
type CanvasNodeAssetRepository interface {
	Get(context.Context, Scope, string, string, string) (domaincanvas.CanvasNode, error)
	List(context.Context, Scope, string, string) ([]domaincanvas.CanvasNode, error)
	SearchCanvasNodeAssets(context.Context, Scope, string, string, []domainresource.Type, *CanvasNodeAssetSearchCursor, int) (CanvasNodeAvailableAssetWindow, error)
}

type AssetService interface {
	BypassBatchGet(context.Context, applicationasset.BypassBatchGetInput) ([]domainasset.Asset, error)
}

type CanvasScopeResolver interface {
	Get(context.Context, Scope, string, string) (domaincanvas.Canvas, error)
}

type CanvasAssetCreator interface {
	Create(context.Context, applicationasset.CreateInput) (domainasset.Asset, error)
}

type AssetPreviewer interface {
	BatchPresignReferencedAssets(context.Context, applicationasset.BatchGetReferencedAssetsInput) ([]applicationasset.PresignedReferencedAsset, error)
}

type CanvasNodeAssetSource int

const CanvasNodeAssetSourceProjectResource CanvasNodeAssetSource = 1

type CanvasNodeAvailableAssetItem struct {
	Generating      bool
	Asset           domainasset.Asset
	ResourceAssetID string
	Name            string
	PreviewURL      string
	Primary         bool
}

type CanvasNodeAvailableAsset struct {
	Source       CanvasNodeAssetSource
	Name         string
	Description  string
	ResourceID   string
	ResourceType domainresource.Type
	Assets       []CanvasNodeAvailableAssetItem
}

type CanvasNodeAvailableAssetSearch struct {
	Items       []CanvasNodeAvailableAsset
	CanvasNodes []CanvasNodeMention
	NextCursor  string
}

type CanvasNodeMention struct {
	Node       domaincanvas.CanvasNode
	Asset      *domainasset.Asset
	PreviewURL string
	Connected  bool
}

type CanvasNodeAvailableAssetWindow struct {
	Items      []CanvasNodeAvailableAsset
	NextCursor *CanvasNodeAssetSearchCursor
}

type CanvasNodeAssetSearchCursor struct {
	CreatedAt time.Time
	ID        string
}

type canvasnodeAssetCursorPayload struct {
	QueryHash string `json:"q"`
	CreatedAt int64  `json:"t"`
	ID        string `json:"i"`
}

type AssetLimits = assetmatching.Limits

type CanvasAssetReferenceTracker interface {
	AcquireAssets(context.Context, applicationasset.AcquireAssetsInput) error
	ReleaseAssets(context.Context, applicationasset.ReleaseAssetsInput) error
	ReleaseAllAssets(context.Context, applicationasset.ReleaseAllAssetsInput) error
}

type CanvasNodeAssetOfficialMaterializer interface {
	MaterializeForCanvasScope(context.Context, Scope)
}

type CanvasNodeAssetService struct {
	repository           CanvasNodeAssetRepository
	canvases             CanvasScopeResolver
	assetCreator         CanvasAssetCreator
	previewer            AssetPreviewer
	officialMaterializer CanvasNodeAssetOfficialMaterializer
	resourceAssets       CanvasResourceAssetBatchResolver
}

type CanvasNodeAssetOption func(*CanvasNodeAssetService)

func WithCanvasAssetCreation(canvases CanvasScopeResolver, assets CanvasAssetCreator) CanvasNodeAssetOption {
	return func(service *CanvasNodeAssetService) {
		service.canvases = canvases
		service.assetCreator = assets
	}
}

func NewCanvasNodeAssetService(repository CanvasNodeAssetRepository, _ AssetService, previewer AssetPreviewer, officialMaterializer CanvasNodeAssetOfficialMaterializer, resourceAssets CanvasResourceAssetBatchResolver, options ...CanvasNodeAssetOption) *CanvasNodeAssetService {
	service := &CanvasNodeAssetService{repository: repository, previewer: previewer, officialMaterializer: officialMaterializer, resourceAssets: resourceAssets}
	for _, option := range options {
		option(service)
	}
	return service
}

type CreateCanvasAssetInput struct {
	Scope
	ProjectID string
	CanvasID  string
	BlobID    string
	FileName  string
}

func (s *CanvasNodeAssetService) CreateCanvasAsset(ctx context.Context, input CreateCanvasAssetInput) (domainasset.Asset, error) {
	if !validAssetScope(input.Scope) || strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.CanvasID) == "" ||
		strings.TrimSpace(input.BlobID) == "" || strings.TrimSpace(input.FileName) == "" {
		return domainasset.Asset{}, errno.New(errno.ErrInvalidArgument)
	}
	return createCanvasProjectAsset(ctx, s.canvases, s.assetCreator, input.Scope, input.ProjectID, input.CanvasID, UploadedAssetInput{
		BlobID: input.BlobID, FileName: input.FileName,
	})
}

func createCanvasProjectAsset(ctx context.Context, canvases CanvasScopeResolver, creator CanvasAssetCreator, scope Scope, projectID, canvasID string, uploaded UploadedAssetInput) (domainasset.Asset, error) {
	if !validAssetScope(scope) || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" ||
		strings.TrimSpace(uploaded.BlobID) == "" || strings.TrimSpace(uploaded.FileName) == "" {
		return domainasset.Asset{}, errno.New(errno.ErrInvalidArgument)
	}
	if canvases == nil || creator == nil {
		return domainasset.Asset{}, errno.New(errno.ErrConfigurationError)
	}
	if _, err := canvases.Get(ctx, scope, projectID, canvasID); err != nil {
		return domainasset.Asset{}, classifyCanvasNodeAssetError(err)
	}
	// Public callers select a trusted Canvas context, never the persisted Asset
	// owner. Project ownership is derived here so identity intent and owner facts
	// cannot diverge through a forged request body.
	return creator.Create(ctx, applicationasset.CreateInput{
		Scope: applicationasset.Scope{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
		},
		ProjectID: &projectID, OwnerType: domainasset.OwnerProject, OwnerID: projectID,
		BlobID: uploaded.BlobID, FileName: uploaded.FileName,
	})
}

func (s *CanvasNodeAssetService) Search(ctx context.Context, scope Scope, projectID, canvasID, nodeID, keyword, cursor string, limit int, mediaTypes []domaincanvas.MediaType) (CanvasNodeAvailableAssetSearch, error) {
	if !validAssetScope(scope) || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" || strings.TrimSpace(nodeID) == "" || limit < 1 || limit > maxPageSize {
		return CanvasNodeAvailableAssetSearch{}, errno.New(errno.ErrInvalidArgument)
	}
	mediaTypes, err := normalizeCanvasNodeMediaTypes(mediaTypes)
	if err != nil {
		return CanvasNodeAvailableAssetSearch{}, errno.Wrap(errno.ErrInvalidArgument, err)
	}
	target, err := s.repository.Get(ctx, scope, projectID, canvasID, nodeID)
	if err != nil {
		return CanvasNodeAvailableAssetSearch{}, classifyCanvasNodeAssetError(err)
	}
	canvasNodes, err := s.repository.List(ctx, scope, projectID, canvasID)
	if err != nil {
		return CanvasNodeAvailableAssetSearch{}, classifyCanvasNodeAssetError(err)
	}
	if s.officialMaterializer != nil {
		s.officialMaterializer.MaterializeForCanvasScope(ctx, scope)
	}
	keyword = strings.TrimSpace(keyword)
	queryHash := canvasnodeAssetQueryHash(scope, projectID, keyword, mediaTypes)
	position, err := decodeCanvasNodeAssetCursor(cursor, queryHash)
	if err != nil {
		return CanvasNodeAvailableAssetSearch{}, errno.Wrap(errno.ErrInvalidArgument, err)
	}
	resourceTypes, searchProjectAssets := canvasNodeAssetResourceTypes(target, mediaTypes)
	search := CanvasNodeAvailableAssetWindow{}
	if searchProjectAssets {
		search, err = s.repository.SearchCanvasNodeAssets(ctx, scope, projectID, keyword, resourceTypes, position, limit)
		if err != nil {
			return CanvasNodeAvailableAssetSearch{}, classifyCanvasNodeAssetError(err)
		}
	}
	if len(resourceTypes) > 0 {
		allowed := make(map[domainresource.Type]struct{}, len(resourceTypes))
		for _, resourceType := range resourceTypes {
			allowed[resourceType] = struct{}{}
		}
		items := search.Items[:0]
		for _, item := range search.Items {
			if _, ok := allowed[item.ResourceType]; ok {
				items = append(items, item)
			}
		}
		search.Items = items
	}
	references := make([]applicationasset.AssetReference, 0)
	for _, group := range search.Items {
		for _, item := range group.Assets {
			if item.Asset.ID == "" {
				continue
			}
			references = append(references, applicationasset.AssetReference{
				Owner:   applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetRevision, Key: item.ResourceAssetID},
				AssetID: item.Asset.ID,
			})
		}
	}
	resolved, err := s.batchPresignReferencedAssets(ctx, scope, references)
	if err != nil {
		return CanvasNodeAvailableAssetSearch{}, err
	}
	for groupIndex := range search.Items {
		for assetIndex := range search.Items[groupIndex].Assets {
			item := &search.Items[groupIndex].Assets[assetIndex]
			reference := applicationasset.AssetReference{
				Owner:   applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetRevision, Key: item.ResourceAssetID},
				AssetID: item.Asset.ID,
			}
			if current, ok := resolved[reference]; ok {
				item.Asset = current.Asset
				item.PreviewURL = current.URL
			}
		}
	}
	nextCursor, err := encodeCanvasNodeAssetCursor(search.NextCursor, queryHash)
	if err != nil {
		return CanvasNodeAvailableAssetSearch{}, err
	}
	mentions, err := s.canvasNodeMentions(ctx, scope, target, canvasNodes, keyword, cursor == "", mediaTypes)
	if err != nil {
		return CanvasNodeAvailableAssetSearch{}, err
	}
	return CanvasNodeAvailableAssetSearch{Items: search.Items, CanvasNodes: mentions, NextCursor: nextCursor}, nil
}

func (s *CanvasNodeAssetService) canvasNodeMentions(
	ctx context.Context,
	scope Scope,
	target domaincanvas.CanvasNode,
	nodes []domaincanvas.CanvasNode,
	keyword string,
	firstPage bool,
	mediaTypes []domaincanvas.MediaType,
) ([]CanvasNodeMention, error) {
	if !firstPage {
		return nil, nil
	}
	connected := make(map[string]struct{}, len(target.IncomingEdges))
	for _, edge := range target.IncomingEdges {
		connected[edge.SourceNodeID] = struct{}{}
	}
	keyword = strings.ToLower(strings.TrimSpace(keyword))
	resourceAssetIDs := make([]string, 0, len(nodes))
	for _, node := range nodes {
		if node.ID != target.ID && nodeCanFeedTarget(node, target) && canvasNodeMatchesMediaTypes(node, mediaTypes) && node.ResourceAssetID != "" {
			resourceAssetIDs = append(resourceAssetIDs, node.ResourceAssetID)
		}
	}
	if len(resourceAssetIDs) > 0 {
		if s.resourceAssets == nil {
			return nil, errno.New(errno.ErrInternalError)
		}
		resolved, resolveErr := s.resourceAssets.BatchResolveCurrentResourceAssets(ctx, scope, target.ProjectID, resourceAssetIDs)
		if resolveErr != nil {
			return nil, classifyCanvasNodeAssetError(resolveErr)
		}
		for index := range nodes {
			if current, ok := resolved[nodes[index].ResourceAssetID]; ok {
				nodes[index].CurrentAssetID = current.Asset.ID
				nodes[index].ResourceAssetRevision = current.Revision
				if !nodes[index].HasPersistedName {
					name, nameErr := canvasNodeNameFromSource(current.Name, nodes[index].Type)
					if nameErr != nil {
						return nil, errno.Wrap(errno.ErrInvalidArgument, nameErr)
					}
					nodes[index].Name = name
				}
			}
		}
	}
	candidates := make([]domaincanvas.CanvasNode, 0, len(nodes))
	references := make([]applicationasset.AssetReference, 0, len(nodes))
	for _, node := range nodes {
		if node.ID == target.ID || !nodeCanFeedTarget(node, target) || !canvasNodeMatchesMediaTypes(node, mediaTypes) {
			continue
		}
		if keyword != "" && !strings.Contains(strings.ToLower(node.Name+" "+node.Text+" "+node.Prompt), keyword) {
			continue
		}
		assetID := nodeCurrentAssetID(node)
		if node.Type == domaincanvas.NodeTypeText && strings.TrimSpace(node.Text) == "" {
			continue
		}
		if node.Type == domaincanvas.NodeTypeTextGeneration && strings.TrimSpace(node.SelectedOutputText) == "" {
			continue
		}
		if node.Type != domaincanvas.NodeTypeText && node.Type != domaincanvas.NodeTypeTextGeneration && assetID == "" {
			continue
		}
		candidates = append(candidates, node)
		if reference, ok := canvasNodeMainAssetReference(node); ok {
			references = append(references, reference)
		}
	}
	resolvedAssets, err := s.batchPresignReferencedAssets(ctx, scope, references)
	if err != nil {
		return nil, err
	}
	result := make([]CanvasNodeMention, 0, len(candidates))
	for _, node := range candidates {
		var resolved *domainasset.Asset
		var previewURL string
		if reference, ok := canvasNodeMainAssetReference(node); ok {
			item, found := resolvedAssets[reference]
			if found {
				copy := item
				resolved = &copy.Asset
				previewURL = copy.URL
			}
		}
		_, isConnected := connected[node.ID]
		result = append(result, CanvasNodeMention{Node: node, Asset: resolved, PreviewURL: previewURL, Connected: isConnected})
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Connected != result[j].Connected {
			return result[i].Connected
		}
		if !result[i].Node.CreatedAt.Equal(result[j].Node.CreatedAt) {
			return result[i].Node.CreatedAt.Before(result[j].Node.CreatedAt)
		}
		return result[i].Node.ID < result[j].Node.ID
	})
	return result, nil
}

func nodeCanFeedTarget(source, target domaincanvas.CanvasNode) bool {
	media, ok := source.OutputMediaType()
	if !ok {
		return false
	}
	return targetAcceptsMentionMedia(target, media)
}

func targetAcceptsMentionMedia(target domaincanvas.CanvasNode, media domaincanvas.MediaType) bool {
	switch target.Type {
	case domaincanvas.NodeTypeText:
		return true
	case domaincanvas.NodeTypeTextGeneration:
		return media != domaincanvas.MediaTypeAudio
	case domaincanvas.NodeTypeImageGeneration:
		return media == domaincanvas.MediaTypeImage || media == domaincanvas.MediaTypeText
	case domaincanvas.NodeTypeVideoGeneration:
		if target.VideoInputMode == domaincanvas.VideoInputModeFirstLastFrame {
			return media == domaincanvas.MediaTypeImage
		}
		return true
	default:
		return false
	}
}

func canvasNodeAssetResourceTypes(target domaincanvas.CanvasNode, mediaTypes []domaincanvas.MediaType) ([]domainresource.Type, bool) {
	if mediaTypes == nil {
		switch target.Type {
		case domaincanvas.NodeTypeImageGeneration, domaincanvas.NodeTypeTextGeneration:
			return imageResourceTypes(), true
		default:
			return nil, true
		}
	}
	resourceTypes := make([]domainresource.Type, 0, 4)
	for _, mediaType := range mediaTypes {
		if !targetAcceptsMentionMedia(target, mediaType) {
			continue
		}
		switch mediaType {
		case domaincanvas.MediaTypeImage:
			resourceTypes = append(resourceTypes, imageResourceTypes()...)
		case domaincanvas.MediaTypeAudio:
			resourceTypes = append(resourceTypes, domainresource.TypeAudio)
		}
	}
	return resourceTypes, len(resourceTypes) > 0
}

func imageResourceTypes() []domainresource.Type {
	return []domainresource.Type{domainresource.TypeCharacter, domainresource.TypeScene, domainresource.TypeProp}
}

func normalizeCanvasNodeMediaTypes(mediaTypes []domaincanvas.MediaType) ([]domaincanvas.MediaType, error) {
	if len(mediaTypes) == 0 {
		return nil, nil
	}
	seen := make(map[domaincanvas.MediaType]struct{}, len(mediaTypes))
	for _, mediaType := range mediaTypes {
		if mediaType < domaincanvas.MediaTypeImage || mediaType > domaincanvas.MediaTypeText {
			return nil, errors.New("invalid canvas node media type")
		}
		seen[mediaType] = struct{}{}
	}
	result := make([]domaincanvas.MediaType, 0, len(seen))
	for mediaType := domaincanvas.MediaTypeImage; mediaType <= domaincanvas.MediaTypeText; mediaType++ {
		if _, ok := seen[mediaType]; ok {
			result = append(result, mediaType)
		}
	}
	return result, nil
}

func canvasNodeMatchesMediaTypes(node domaincanvas.CanvasNode, mediaTypes []domaincanvas.MediaType) bool {
	if mediaTypes == nil {
		return true
	}
	mediaType, ok := node.OutputMediaType()
	if !ok {
		return false
	}
	for _, allowed := range mediaTypes {
		if mediaType == allowed {
			return true
		}
	}
	return false
}

func nodeCurrentAssetID(node domaincanvas.CanvasNode) string {
	if node.AssetID != "" {
		return node.AssetID
	}
	if node.CurrentAssetID != "" {
		return node.CurrentAssetID
	}
	return node.SelectedAssetID
}

func canvasnodeAssetQueryHash(scope Scope, projectID, keyword string, mediaTypes []domaincanvas.MediaType) string {
	workspaceID := ""
	if scope.WorkspaceID != nil {
		workspaceID = *scope.WorkspaceID
	}
	value := fmt.Sprintf("%s\x00%s\x00%s\x00%s", scope.TenantID, workspaceID, projectID, strings.ToLower(keyword))
	if mediaTypes != nil {
		values := make([]string, 0, len(mediaTypes))
		for _, mediaType := range mediaTypes {
			values = append(values, fmt.Sprintf("%d", mediaType))
		}
		value += "\x00" + strings.Join(values, ",")
	}
	return fmt.Sprintf("%x", sha256.Sum256([]byte(value)))
}

func decodeCanvasNodeAssetCursor(value, queryHash string) (*CanvasNodeAssetSearchCursor, error) {
	if value == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, err
	}
	var payload canvasnodeAssetCursorPayload
	if err = json.Unmarshal(raw, &payload); err != nil || payload.QueryHash != queryHash || payload.ID == "" || payload.CreatedAt <= 0 {
		return nil, errors.New("invalid canvas asset cursor")
	}
	return &CanvasNodeAssetSearchCursor{CreatedAt: time.UnixMicro(payload.CreatedAt), ID: payload.ID}, nil
}

func encodeCanvasNodeAssetCursor(cursor *CanvasNodeAssetSearchCursor, queryHash string) (string, error) {
	if cursor == nil {
		return "", nil
	}
	raw, err := json.Marshal(canvasnodeAssetCursorPayload{QueryHash: queryHash, CreatedAt: cursor.CreatedAt.UnixMicro(), ID: cursor.ID})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func (s *CanvasNodeAssetService) batchPresignReferencedAssets(ctx context.Context, scope Scope, references []applicationasset.AssetReference) (map[applicationasset.AssetReference]applicationasset.PresignedReferencedAsset, error) {
	resolved := make(map[applicationasset.AssetReference]applicationasset.PresignedReferencedAsset, len(references))
	if s.previewer == nil {
		return resolved, nil
	}
	for start := 0; start < len(references); start += maxBatchAssetRead {
		end := min(start+maxBatchAssetRead, len(references))
		items, err := s.previewer.BatchPresignReferencedAssets(ctx, applicationasset.BatchGetReferencedAssetsInput{Scope: applicationasset.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID}, References: references[start:end]})
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			resolved[item.Reference] = item
		}
	}
	return resolved, nil
}

func canvasAssetReferenceScope(scope Scope) applicationasset.ReferenceScope {
	return applicationasset.ReferenceScope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}
}

func validAssetScope(scope Scope) bool {
	return strings.TrimSpace(scope.TenantID) != "" && strings.TrimSpace(scope.CallerID) != ""
}

func classifyCanvasNodeAssetError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrNotFound) {
		return errno.Wrap(errno.ErrNotFound, err)
	}
	return errno.Wrap(errno.ErrPersistenceError, err)
}
