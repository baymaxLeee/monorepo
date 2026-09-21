package canvas

import (
	"context"
	"errors"
	"sort"
	"strings"

	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domain "github.com/example/monorepo/canvas/internal/server/domain/canvas"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type ConnectNodesInput struct {
	Scope
	ProjectID    string
	CanvasID     string
	SourceNodeID string
	TargetNodeID string
	TargetPort   domain.Port
	TargetOrder  *int32
}

type ConnectNodesResult struct {
	TargetNode     domain.CanvasNode
	CanvasRevision int64
}

type MentionReferenceType int

const (
	MentionReferenceTypeUnspecified MentionReferenceType = iota
	MentionReferenceTypeAsset
	MentionReferenceTypeResource
	MentionReferenceTypeResourceAsset
	MentionReferenceTypeCanvasNode
)

type MaterializeResourceAssetReferenceInput struct {
	Scope
	ProjectID                 string
	CanvasID                  string
	TargetNodeID              string
	ReferenceType             *MentionReferenceType
	ResourceID                string
	ResourceAssetID           string
	TargetPort                domain.Port
	ResourceAssetNodePosition *domain.Position
}

type MaterializeResourceAssetReferenceResult struct {
	ResourceAssetNode        domain.CanvasNode
	TargetNode               domain.CanvasNode
	CanvasRevision           int64
	CreatedResourceAssetNode bool
}

type MaterializeStandaloneAssetReferenceInput struct {
	Scope
	ProjectID, CanvasID, TargetNodeID, AssetID string
	ReferenceType                              *MentionReferenceType
	TargetPort                                 domain.Port
	AssetNodePosition                          *domain.Position
	UploadedAsset                              *UploadedAssetInput
}

type MaterializeStandaloneAssetReferenceResult struct {
	AssetNode        domain.CanvasNode
	TargetNode       domain.CanvasNode
	CanvasRevision   int64
	CreatedAssetNode bool
}

type DeleteEdgeInput struct {
	Scope
	ProjectID    string
	CanvasID     string
	TargetNodeID string
	EdgeID       string
}

type DeleteEdgeResult struct {
	TargetNode     domain.CanvasNode
	CanvasRevision int64
}

type DeleteNodeInput struct {
	Scope
	ProjectID string
	CanvasID  string
	NodeID    string
}

type BatchDeleteNodesInput struct {
	Scope
	ProjectID string
	CanvasID  string
	NodeIDs   []string
}

type StoryboardRank struct {
	NodeID string
	Rank   int64
}

type ReorderStoryboardInput struct {
	Scope
	ProjectID string
	CanvasID  string
	Items     []StoryboardRank
}

type ReorderStoryboardResult struct {
	Nodes          []domain.CanvasNode
	CanvasRevision int64
}

func (s *CanvasNodeService) ConnectNodes(ctx context.Context, input ConnectNodesInput) (ConnectNodesResult, error) {
	if !validGraphMutation(input.Scope, input.ProjectID, input.CanvasID) ||
		strings.TrimSpace(input.SourceNodeID) == "" || strings.TrimSpace(input.TargetNodeID) == "" ||
		input.TargetPort == domain.PortOutput {
		return ConnectNodesResult{}, errno.New(errno.ErrInvalidArgument)
	}
	if s.graphRepository == nil {
		return ConnectNodesResult{}, errno.New(errno.ErrConfigurationError)
	}
	inputPolicy, err := s.resolveGraphInputPolicy(ctx, input.Scope, input.ProjectID, input.CanvasID, input.TargetNodeID, input.TargetPort)
	if err != nil {
		return ConnectNodesResult{}, classifyGraphMutation(err)
	}
	edgeID, err := s.ids.NewID()
	if err != nil {
		return ConnectNodesResult{}, errno.Wrap(errno.ErrInternalError, err)
	}
	var result ConnectNodesResult
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		lockedRevision, lockErr := s.graphRepository.LockCanvas(txCtx, input.Scope, input.ProjectID, input.CanvasID)
		if lockErr != nil {
			return lockErr
		}
		nodes, listErr := s.repository.ListForUpdate(txCtx, input.Scope, input.ProjectID, input.CanvasID)
		if listErr != nil {
			return listErr
		}
		sourceIndex := -1
		targetIndex := -1
		for index := range nodes {
			if nodes[index].ID == input.SourceNodeID {
				sourceIndex = index
			}
			if nodes[index].ID == input.TargetNodeID {
				targetIndex = index
			}
		}
		if sourceIndex < 0 || targetIndex < 0 {
			return ErrNotFound
		}
		participants := []domain.CanvasNode{nodes[sourceIndex], nodes[targetIndex]}
		if resolveErr := s.resolveCurrentResourceAssets(txCtx, input.Scope, input.ProjectID, participants); resolveErr != nil {
			return resolveErr
		}
		if participants[0].ReferenceStatus == domain.ReferenceStatusDeleted || participants[1].ReferenceStatus == domain.ReferenceStatusDeleted {
			return domain.ErrInvalidCanvasNode
		}
		target := nodes[targetIndex]
		if target.ActiveTaskRunID != "" {
			return ErrRevisionConflict
		}
		edges, insertErr := insertIncomingEdge(
			target.IncomingEdges,
			domain.IncomingEdge{
				ID: edgeID, SourceNodeID: input.SourceNodeID, SourcePort: domain.PortOutput,
				TargetPort: input.TargetPort,
			},
			input.TargetOrder,
		)
		if insertErr != nil {
			return insertErr
		}
		if validateErr := domain.ValidateIncomingEdges(nodes, target.ID, edges, target.VideoInputMode); validateErr != nil {
			return validateErr
		}
		if validateErr := inputPolicy.Validate(target, edges); validateErr != nil {
			return validateErr
		}
		patch := domain.UpdatePatch{ExpectedRevision: target.Revision, IncomingEdges: &edges}
		if updateErr := target.Update(patch, input.CallerID, s.clock.Now()); updateErr != nil {
			return updateErr
		}
		_, _, _, updateErr := s.repository.Update(txCtx, target, patch)
		if updateErr != nil {
			return updateErr
		}
		canvasRevision, advanceErr := s.graphRepository.AdvanceCanvasRevision(
			txCtx, input.Scope, input.ProjectID, input.CanvasID, lockedRevision, s.clock.Now(),
		)
		if advanceErr != nil {
			return advanceErr
		}
		result = ConnectNodesResult{TargetNode: target, CanvasRevision: canvasRevision}
		return nil
	})
	if err != nil {
		return ConnectNodesResult{}, classifyGraphMutation(err)
	}
	projected := []domain.CanvasNode{result.TargetNode}
	if err = s.resolveCurrentResourceAssets(ctx, input.Scope, input.ProjectID, projected); err != nil {
		return ConnectNodesResult{}, err
	}
	result.TargetNode = projected[0]
	return result, nil
}

func (s *CanvasNodeService) MaterializeResourceAssetReference(
	ctx context.Context,
	input MaterializeResourceAssetReferenceInput,
) (MaterializeResourceAssetReferenceResult, error) {
	resourceID := strings.TrimSpace(input.ResourceID)
	resourceAssetID := strings.TrimSpace(input.ResourceAssetID)
	hasResourceID := resourceID != ""
	hasResourceAssetID := resourceAssetID != ""
	if !validGraphMutation(input.Scope, input.ProjectID, input.CanvasID) ||
		strings.TrimSpace(input.TargetNodeID) == "" ||
		!validResourceMaterializationReference(input.ReferenceType, hasResourceID, hasResourceAssetID) ||
		input.TargetPort == domain.PortOutput || input.ResourceAssetNodePosition == nil || !input.ResourceAssetNodePosition.Valid() {
		return MaterializeResourceAssetReferenceResult{}, errno.New(errno.ErrInvalidArgument)
	}
	if s.graphRepository == nil ||
		(hasResourceID && (s.resources == nil || s.resourceBatch == nil)) ||
		(hasResourceAssetID && (s.resourceAssets == nil || s.resourceAssetBatch == nil)) {
		return MaterializeResourceAssetReferenceResult{}, errno.New(errno.ErrConfigurationError)
	}
	inputPolicy, err := s.resolveGraphInputPolicy(ctx, input.Scope, input.ProjectID, input.CanvasID, input.TargetNodeID, input.TargetPort)
	if err != nil {
		return MaterializeResourceAssetReferenceResult{}, classifyGraphMutation(err)
	}
	edgeID, err := s.ids.NewID()
	if err != nil {
		return MaterializeResourceAssetReferenceResult{}, errno.Wrap(errno.ErrInternalError, err)
	}
	assetNodeID, err := s.ids.NewID()
	if err != nil {
		return MaterializeResourceAssetReferenceResult{}, errno.Wrap(errno.ErrInternalError, err)
	}
	var result MaterializeResourceAssetReferenceResult
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		lockedRevision, lockErr := s.graphRepository.LockCanvas(txCtx, input.Scope, input.ProjectID, input.CanvasID)
		if lockErr != nil {
			return lockErr
		}
		nodes, listErr := s.repository.ListForUpdate(txCtx, input.Scope, input.ProjectID, input.CanvasID)
		if listErr != nil {
			return listErr
		}
		targetIndex := -1
		resourceAssetNodeIndex := -1
		for index := range nodes {
			if nodes[index].ID == input.TargetNodeID {
				targetIndex = index
			}
			matchesResource := hasResourceID && nodes[index].ResourceID == resourceID && nodes[index].Type == domain.NodeTypeAudioAsset
			matchesResourceAsset := hasResourceAssetID && nodes[index].ResourceID == "" && nodes[index].ResourceAssetID == resourceAssetID &&
				(nodes[index].Type == domain.NodeTypeImageAsset || nodes[index].Type == domain.NodeTypeVideoAsset || nodes[index].Type == domain.NodeTypeAudioAsset)
			if matchesResource || matchesResourceAsset {
				resourceAssetNodeIndex = index
			}
		}
		if targetIndex < 0 {
			return ErrNotFound
		}
		target := nodes[targetIndex]
		if target.ActiveTaskRunID != "" {
			return ErrRevisionConflict
		}
		var resourceAssetNode domain.CanvasNode
		if resourceAssetNodeIndex >= 0 {
			resourceAssetNode = nodes[resourceAssetNodeIndex]
		} else {
			var resolved CanvasResourceAssetReference
			var getErr error
			if hasResourceID {
				resolved, getErr = s.resources.ResolvePrimaryResourceAsset(txCtx, input.Scope, input.ProjectID, resourceID)
			} else {
				resolved, getErr = s.resourceAssets.ResolveCurrentResourceAsset(txCtx, input.Scope, input.ProjectID, resourceAssetID)
			}
			if getErr != nil {
				return getErr
			}
			if hasResourceID && resolved.Asset.MediaType != domainasset.MediaAudio {
				return domain.ErrInvalidCanvasNode
			}
			nodeType, typeOK := assetNodeType(resolved.Asset.MediaType)
			if !typeOK {
				return domain.ErrInvalidCanvasNode
			}
			name, nameErr := canvasNodeNameFromSource(resolved.Name, nodeType)
			if nameErr != nil {
				return nameErr
			}
			resourceAssetNode, getErr = domain.NewCanvasNode(domain.CanvasNodeInput{
				ID: assetNodeID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID,
				ProjectID: input.ProjectID, CanvasID: input.CanvasID, CreatedBy: input.CallerID,
				Type: nodeType, Name: name, Position: *input.ResourceAssetNodePosition,
				ResourceID: resourceID, ResourceAssetID: resourceAssetID,
				VideoInputMode: domain.VideoInputModeReference, Now: s.clock.Now(),
			})
			if getErr != nil {
				return getErr
			}
			if _, createErr := s.repository.Create(txCtx, resourceAssetNode, nil); createErr != nil {
				return createErr
			}
			nodes = append(nodes, resourceAssetNode)
			result.CreatedResourceAssetNode = true
		}
		for _, edge := range target.IncomingEdges {
			if edge.SourceNodeID == resourceAssetNode.ID && edge.TargetPort == input.TargetPort {
				result.ResourceAssetNode = resourceAssetNode
				result.TargetNode = target
				result.CanvasRevision = lockedRevision
				return nil
			}
		}
		edges, insertErr := insertIncomingEdge(target.IncomingEdges, domain.IncomingEdge{
			ID: edgeID, SourceNodeID: resourceAssetNode.ID, SourcePort: domain.PortOutput, TargetPort: input.TargetPort,
		}, nil)
		if insertErr != nil {
			return insertErr
		}
		if validateErr := domain.ValidateIncomingEdges(nodes, target.ID, edges, target.VideoInputMode); validateErr != nil {
			return validateErr
		}
		if validateErr := inputPolicy.Validate(target, edges); validateErr != nil {
			return validateErr
		}
		patch := domain.UpdatePatch{ExpectedRevision: target.Revision, IncomingEdges: &edges}
		if updateErr := target.Update(patch, input.CallerID, s.clock.Now()); updateErr != nil {
			return updateErr
		}
		_, _, _, updateErr := s.repository.Update(txCtx, target, patch)
		if updateErr != nil {
			return updateErr
		}
		canvasRevision, advanceErr := s.graphRepository.AdvanceCanvasRevision(
			txCtx, input.Scope, input.ProjectID, input.CanvasID, lockedRevision, s.clock.Now(),
		)
		if advanceErr != nil {
			return advanceErr
		}
		result.ResourceAssetNode = resourceAssetNode
		result.TargetNode = target
		result.CanvasRevision = canvasRevision
		return nil
	})
	if err != nil {
		return MaterializeResourceAssetReferenceResult{}, classifyGraphMutation(err)
	}
	projected := []domain.CanvasNode{result.ResourceAssetNode, result.TargetNode}
	if err = s.resolveCurrentResourceAssets(ctx, input.Scope, input.ProjectID, projected); err != nil {
		return MaterializeResourceAssetReferenceResult{}, err
	}
	result.ResourceAssetNode, result.TargetNode = projected[0], projected[1]
	return result, nil
}

func assetNodeType(mediaType domainasset.MediaType) (domain.NodeType, bool) {
	switch mediaType {
	case domainasset.MediaImage:
		return domain.NodeTypeImageAsset, true
	case domainasset.MediaVideo:
		return domain.NodeTypeVideoAsset, true
	case domainasset.MediaAudio:
		return domain.NodeTypeAudioAsset, true
	default:
		return 0, false
	}
}

func (s *CanvasNodeService) MaterializeStandaloneAssetReference(ctx context.Context, input MaterializeStandaloneAssetReferenceInput) (MaterializeStandaloneAssetReferenceResult, error) {
	hasAssetID := strings.TrimSpace(input.AssetID) != ""
	hasUpload := input.UploadedAsset != nil
	if !validGraphMutation(input.Scope, input.ProjectID, input.CanvasID) ||
		strings.TrimSpace(input.TargetNodeID) == "" || hasAssetID == hasUpload ||
		!validStandaloneMaterializationReference(input.ReferenceType) ||
		input.TargetPort == domain.PortOutput || input.AssetNodePosition == nil || !input.AssetNodePosition.Valid() {
		return MaterializeStandaloneAssetReferenceResult{}, errno.New(errno.ErrInvalidArgument)
	}
	if s.graphRepository == nil || s.assets == nil {
		return MaterializeStandaloneAssetReferenceResult{}, errno.New(errno.ErrConfigurationError)
	}
	inputPolicy, err := s.resolveGraphInputPolicy(ctx, input.Scope, input.ProjectID, input.CanvasID, input.TargetNodeID, input.TargetPort)
	if err != nil {
		return MaterializeStandaloneAssetReferenceResult{}, classifyGraphMutation(err)
	}
	if hasUpload {
		createdAsset, createErr := createCanvasProjectAsset(
			ctx, s.canvases, s.assetCreator, input.Scope, input.ProjectID, input.CanvasID, *input.UploadedAsset,
		)
		if createErr != nil {
			return MaterializeStandaloneAssetReferenceResult{}, createErr
		}
		input.AssetID = createdAsset.ID
	}
	resolved, err := resolveProjectAsset(ctx, s.assets, input.Scope, input.ProjectID, input.AssetID)
	if err != nil {
		return MaterializeStandaloneAssetReferenceResult{}, classifyGraphMutation(err)
	}
	nodeType, ok := assetNodeType(resolved.MediaType)
	if !ok {
		return MaterializeStandaloneAssetReferenceResult{}, errno.New(errno.ErrInvalidArgument)
	}
	edgeID, err := s.ids.NewID()
	if err != nil {
		return MaterializeStandaloneAssetReferenceResult{}, errno.Wrap(errno.ErrInternalError, err)
	}
	assetNodeID, err := s.ids.NewID()
	if err != nil {
		return MaterializeStandaloneAssetReferenceResult{}, errno.Wrap(errno.ErrInternalError, err)
	}
	var result MaterializeStandaloneAssetReferenceResult
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		lockedRevision, lockErr := s.graphRepository.LockCanvas(txCtx, input.Scope, input.ProjectID, input.CanvasID)
		if lockErr != nil {
			return lockErr
		}
		nodes, listErr := s.repository.ListForUpdate(txCtx, input.Scope, input.ProjectID, input.CanvasID)
		if listErr != nil {
			return listErr
		}
		targetIndex, assetNodeIndex := -1, -1
		for index := range nodes {
			if nodes[index].ID == input.TargetNodeID {
				targetIndex = index
			}
			if nodes[index].AssetID == input.AssetID && nodes[index].ResourceAssetID == "" {
				assetNodeIndex = index
			}
		}
		if targetIndex < 0 {
			return ErrNotFound
		}
		target := nodes[targetIndex]
		if target.ActiveTaskRunID != "" {
			return ErrRevisionConflict
		}
		var assetNode domain.CanvasNode
		if assetNodeIndex >= 0 {
			assetNode = nodes[assetNodeIndex]
		} else {
			name, nameErr := canvasNodeNameFromSource(resolved.FileName, nodeType)
			if nameErr != nil {
				return nameErr
			}
			assetNode, err = domain.NewCanvasNode(domain.CanvasNodeInput{ID: assetNodeID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, ProjectID: input.ProjectID, CanvasID: input.CanvasID, CreatedBy: input.CallerID, Type: nodeType, Name: name, Position: *input.AssetNodePosition, AssetID: input.AssetID, VideoInputMode: domain.VideoInputModeReference, Now: s.clock.Now()})
			if err != nil {
				return err
			}
			if _, err = s.repository.Create(txCtx, assetNode, nil); err != nil {
				return err
			}
			if s.assetReferences != nil {
				if err = s.assetReferences.AcquireAssets(txCtx, applicationasset.AcquireAssetsInput{
					Scope:    canvasAssetReferenceScope(input.Scope),
					Owner:    applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerCanvasNodeAsset, Key: assetNode.ID},
					AssetIDs: []string{input.AssetID},
				}); err != nil {
					return err
				}
			}
			nodes = append(nodes, assetNode)
			result.CreatedAssetNode = true
		}
		for _, edge := range target.IncomingEdges {
			if edge.SourceNodeID == assetNode.ID && edge.TargetPort == input.TargetPort {
				result.AssetNode, result.TargetNode, result.CanvasRevision = assetNode, target, lockedRevision
				return nil
			}
		}
		edges, insertErr := insertIncomingEdge(target.IncomingEdges, domain.IncomingEdge{ID: edgeID, SourceNodeID: assetNode.ID, SourcePort: domain.PortOutput, TargetPort: input.TargetPort}, nil)
		if insertErr != nil {
			return insertErr
		}
		if err = domain.ValidateIncomingEdges(nodes, target.ID, edges, target.VideoInputMode); err != nil {
			return err
		}
		if err = inputPolicy.Validate(target, edges); err != nil {
			return err
		}
		patch := domain.UpdatePatch{ExpectedRevision: target.Revision, IncomingEdges: &edges}
		if err = target.Update(patch, input.CallerID, s.clock.Now()); err != nil {
			return err
		}
		if _, _, _, err = s.repository.Update(txCtx, target, patch); err != nil {
			return err
		}
		result.CanvasRevision, err = s.graphRepository.AdvanceCanvasRevision(txCtx, input.Scope, input.ProjectID, input.CanvasID, lockedRevision, s.clock.Now())
		result.AssetNode, result.TargetNode = assetNode, target
		return err
	})
	if err != nil {
		return MaterializeStandaloneAssetReferenceResult{}, classifyGraphMutation(err)
	}
	projected := []domain.CanvasNode{result.AssetNode, result.TargetNode}
	if err = s.resolveCurrentResourceAssets(ctx, input.Scope, input.ProjectID, projected); err != nil {
		return MaterializeStandaloneAssetReferenceResult{}, err
	}
	result.AssetNode, result.TargetNode = projected[0], projected[1]
	return result, nil
}

func validResourceMaterializationReference(referenceType *MentionReferenceType, hasResourceID, hasResourceAssetID bool) bool {
	if hasResourceID == hasResourceAssetID {
		return false
	}
	if referenceType == nil {
		return true
	}
	switch *referenceType {
	case MentionReferenceTypeResource:
		return hasResourceID
	case MentionReferenceTypeResourceAsset:
		return hasResourceAssetID
	default:
		return false
	}
}

func validStandaloneMaterializationReference(referenceType *MentionReferenceType) bool {
	return referenceType == nil || *referenceType == MentionReferenceTypeAsset
}

func (s *CanvasNodeService) DeleteEdge(ctx context.Context, input DeleteEdgeInput) (DeleteEdgeResult, error) {
	if !validGraphMutation(input.Scope, input.ProjectID, input.CanvasID) ||
		strings.TrimSpace(input.TargetNodeID) == "" || strings.TrimSpace(input.EdgeID) == "" {
		return DeleteEdgeResult{}, errno.New(errno.ErrInvalidArgument)
	}
	if s.graphRepository == nil {
		return DeleteEdgeResult{}, errno.New(errno.ErrConfigurationError)
	}
	var result DeleteEdgeResult
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		lockedRevision, lockErr := s.graphRepository.LockCanvas(txCtx, input.Scope, input.ProjectID, input.CanvasID)
		if lockErr != nil {
			return lockErr
		}
		nodes, listErr := s.repository.ListForUpdate(txCtx, input.Scope, input.ProjectID, input.CanvasID)
		if listErr != nil {
			return listErr
		}
		targetIndex := -1
		for index := range nodes {
			if nodes[index].ID == input.TargetNodeID {
				targetIndex = index
				break
			}
		}
		if targetIndex < 0 {
			return ErrNotFound
		}
		target := nodes[targetIndex]
		if target.ActiveTaskRunID != "" {
			return ErrRevisionConflict
		}
		edges := make([]domain.IncomingEdge, 0, len(target.IncomingEdges))
		found := false
		for _, edge := range target.IncomingEdges {
			if edge.ID == input.EdgeID {
				found = true
				continue
			}
			edges = append(edges, edge)
		}
		if !found {
			return ErrNotFound
		}
		normalizeEdgeOrders(edges)
		patch := domain.UpdatePatch{ExpectedRevision: target.Revision, IncomingEdges: &edges}
		if updateErr := target.Update(patch, input.CallerID, s.clock.Now()); updateErr != nil {
			return updateErr
		}
		if _, _, _, updateErr := s.repository.Update(txCtx, target, patch); updateErr != nil {
			return updateErr
		}
		canvasRevision, advanceErr := s.graphRepository.AdvanceCanvasRevision(
			txCtx, input.Scope, input.ProjectID, input.CanvasID, lockedRevision, s.clock.Now(),
		)
		if advanceErr != nil {
			return advanceErr
		}
		result = DeleteEdgeResult{TargetNode: target, CanvasRevision: canvasRevision}
		return nil
	})
	if err != nil {
		return DeleteEdgeResult{}, classifyGraphMutation(err)
	}
	projected := []domain.CanvasNode{result.TargetNode}
	if err = s.resolveCurrentResourceAssets(ctx, input.Scope, input.ProjectID, projected); err != nil {
		return DeleteEdgeResult{}, err
	}
	result.TargetNode = projected[0]
	return result, nil
}

func (s *CanvasNodeService) DeleteNode(ctx context.Context, input DeleteNodeInput) (int64, error) {
	return s.BatchDeleteNodes(ctx, BatchDeleteNodesInput{
		Scope: input.Scope, ProjectID: input.ProjectID, CanvasID: input.CanvasID, NodeIDs: []string{input.NodeID},
	})
}

// BatchDeleteNodes removes all requested nodes and their incident edges in one
// graph-revision transaction. Generation history is soft-deleted with the
// nodes and retains the original identity for audit and a future undo journal.
func (s *CanvasNodeService) BatchDeleteNodes(ctx context.Context, input BatchDeleteNodesInput) (int64, error) {
	if !validGraphMutation(input.Scope, input.ProjectID, input.CanvasID) ||
		len(input.NodeIDs) == 0 || len(input.NodeIDs) > maxBatchGetIDs {
		return 0, errno.New(errno.ErrInvalidArgument)
	}
	if s.graphRepository == nil {
		return 0, errno.New(errno.ErrConfigurationError)
	}
	deletedIDs := make(map[string]struct{}, len(input.NodeIDs))
	for _, nodeID := range input.NodeIDs {
		if strings.TrimSpace(nodeID) == "" {
			return 0, errno.New(errno.ErrInvalidArgument)
		}
		if _, duplicate := deletedIDs[nodeID]; duplicate {
			return 0, errno.New(errno.ErrInvalidArgument)
		}
		deletedIDs[nodeID] = struct{}{}
	}
	var canvasRevision int64
	deleted := make([]domain.CanvasNode, 0, len(input.NodeIDs))
	now := s.clock.Now()
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		lockedRevision, lockErr := s.graphRepository.LockCanvas(txCtx, input.Scope, input.ProjectID, input.CanvasID)
		if lockErr != nil {
			return lockErr
		}
		nodes, listErr := s.repository.ListForUpdate(txCtx, input.Scope, input.ProjectID, input.CanvasID)
		if listErr != nil {
			return listErr
		}
		found := make(map[string]struct{}, len(input.NodeIDs))
		for _, node := range nodes {
			if _, shouldDelete := deletedIDs[node.ID]; shouldDelete {
				if node.ActiveTaskRunID != "" {
					return ErrRevisionConflict
				}
				found[node.ID] = struct{}{}
			}
		}
		if len(found) != len(deletedIDs) {
			return ErrNotFound
		}
		for index := range nodes {
			if _, shouldDelete := deletedIDs[nodes[index].ID]; shouldDelete {
				continue
			}
			for _, edge := range nodes[index].IncomingEdges {
				if _, sourceDeleted := deletedIDs[edge.SourceNodeID]; sourceDeleted && nodes[index].ActiveTaskRunID != "" {
					return ErrRevisionConflict
				}
			}
		}
		for index := range nodes {
			if _, shouldDelete := deletedIDs[nodes[index].ID]; shouldDelete {
				continue
			}
			// A future Canvas operation journal must capture these survivor
			// preimages in this transaction before their incident edges change;
			// the deleted node rows alone cannot reconstruct those edge lists.
			edges := make([]domain.IncomingEdge, 0, len(nodes[index].IncomingEdges))
			for _, edge := range nodes[index].IncomingEdges {
				if _, sourceDeleted := deletedIDs[edge.SourceNodeID]; !sourceDeleted {
					edges = append(edges, edge)
				}
			}
			if len(edges) == len(nodes[index].IncomingEdges) {
				continue
			}
			normalizeEdgeOrders(edges)
			patch := domain.UpdatePatch{ExpectedRevision: nodes[index].Revision, IncomingEdges: &edges}
			if updateErr := nodes[index].Update(patch, input.CallerID, now); updateErr != nil {
				return updateErr
			}
			if _, _, _, updateErr := s.repository.Update(txCtx, nodes[index], patch); updateErr != nil {
				return updateErr
			}
		}
		for index := range nodes {
			if _, shouldDelete := deletedIDs[nodes[index].ID]; !shouldDelete {
				continue
			}
			item := nodes[index]
			if deleteErr := item.Delete(input.CallerID, now); deleteErr != nil {
				return deleteErr
			}
			revokedTaskRunID, _, deleteErr := s.repository.Delete(txCtx, item)
			if deleteErr != nil {
				return deleteErr
			}
			item.ActiveTaskRunID = revokedTaskRunID
			deleted = append(deleted, item)
			if deleteErr = s.releaseCanvasNodeReferences(txCtx, input.Scope, item); deleteErr != nil {
				return deleteErr
			}
		}
		if rebuildErr := s.statistics.Rebuild(txCtx, input.Scope, input.ProjectID, input.CanvasID); rebuildErr != nil {
			return rebuildErr
		}
		if deleteErr := s.prepareDeletedNodes(txCtx, input.Scope, deleted, now); deleteErr != nil {
			return deleteErr
		}
		var advanceErr error
		canvasRevision, advanceErr = s.graphRepository.AdvanceCanvasRevision(
			txCtx, input.Scope, input.ProjectID, input.CanvasID, lockedRevision, now,
		)
		return advanceErr
	})
	if err != nil {
		return 0, classifyGraphMutation(err)
	}
	s.refreshProjectStatistics(ctx, input.Scope, input.ProjectID)
	return canvasRevision, nil
}

func (s *CanvasNodeService) ReorderStoryboard(ctx context.Context, input ReorderStoryboardInput) (ReorderStoryboardResult, error) {
	if !validGraphMutation(input.Scope, input.ProjectID, input.CanvasID) || len(input.Items) == 0 {
		return ReorderStoryboardResult{}, errno.New(errno.ErrInvalidArgument)
	}
	if s.graphRepository == nil {
		return ReorderStoryboardResult{}, errno.New(errno.ErrConfigurationError)
	}
	var result ReorderStoryboardResult
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		lockedRevision, lockErr := s.graphRepository.LockCanvas(txCtx, input.Scope, input.ProjectID, input.CanvasID)
		if lockErr != nil {
			return lockErr
		}
		nodes, listErr := s.repository.ListForUpdate(txCtx, input.Scope, input.ProjectID, input.CanvasID)
		if listErr != nil {
			return listErr
		}
		videoIDs := make(map[string]struct{})
		for _, node := range nodes {
			if node.Type == domain.NodeTypeVideoGeneration {
				videoIDs[node.ID] = struct{}{}
			}
		}
		if len(videoIDs) != len(input.Items) {
			return domain.ErrInvalidCanvasNode
		}
		ranks := make(map[string]int64, len(input.Items))
		seenRanks := make(map[int64]struct{}, len(input.Items))
		for _, item := range input.Items {
			if _, ok := videoIDs[item.NodeID]; !ok || item.Rank < 1 {
				return domain.ErrInvalidCanvasNode
			}
			if _, duplicate := ranks[item.NodeID]; duplicate {
				return domain.ErrInvalidCanvasNode
			}
			if _, duplicate := seenRanks[item.Rank]; duplicate {
				return domain.ErrInvalidCanvasNode
			}
			ranks[item.NodeID] = item.Rank
			seenRanks[item.Rank] = struct{}{}
		}
		now := s.clock.Now()
		if updateErr := s.graphRepository.UpdateStoryboardRanks(txCtx, input.Scope, input.ProjectID, input.CanvasID, ranks, now); updateErr != nil {
			return updateErr
		}
		canvasRevision, advanceErr := s.graphRepository.AdvanceCanvasRevision(
			txCtx, input.Scope, input.ProjectID, input.CanvasID, lockedRevision, now,
		)
		if advanceErr != nil {
			return advanceErr
		}
		byID := make(map[string]domain.CanvasNode, len(nodes))
		for _, node := range nodes {
			if rank, ok := ranks[node.ID]; ok {
				node.StoryboardRank = rank
				node.Revision++
				node.UpdatedBy = input.CallerID
				node.UpdatedAt = now.UTC()
				byID[node.ID] = node
			}
		}
		ordered := make([]domain.CanvasNode, 0, len(byID))
		for _, node := range byID {
			ordered = append(ordered, node)
		}
		sort.Slice(ordered, func(i, j int) bool {
			return ordered[i].StoryboardRank < ordered[j].StoryboardRank
		})
		result = ReorderStoryboardResult{Nodes: ordered, CanvasRevision: canvasRevision}
		return nil
	})
	if err != nil {
		return ReorderStoryboardResult{}, classifyGraphMutation(err)
	}
	if err = s.resolveCurrentResourceAssets(ctx, input.Scope, input.ProjectID, result.Nodes); err != nil {
		return ReorderStoryboardResult{}, err
	}
	return result, nil
}

func insertIncomingEdge(existing []domain.IncomingEdge, edge domain.IncomingEdge, requested *int32) ([]domain.IncomingEdge, error) {
	edges := append([]domain.IncomingEdge(nil), existing...)
	order := int32(0)
	for _, current := range edges {
		if current.TargetPort == edge.TargetPort {
			order++
		}
	}
	if requested != nil {
		if *requested < 0 || *requested > order {
			return nil, domain.ErrInvalidEdge
		}
		order = *requested
	}
	for index := range edges {
		if edges[index].TargetPort == edge.TargetPort && edges[index].TargetOrder >= order {
			edges[index].TargetOrder++
		}
	}
	edge.TargetOrder = order
	edges = append(edges, edge)
	normalizeEdgeOrders(edges)
	return edges, nil
}

func normalizeEdgeOrders(edges []domain.IncomingEdge) {
	sort.SliceStable(edges, func(i, j int) bool {
		if edges[i].TargetPort != edges[j].TargetPort {
			return edges[i].TargetPort < edges[j].TargetPort
		}
		return edges[i].TargetOrder < edges[j].TargetOrder
	})
	orders := make(map[domain.Port]int32)
	for index := range edges {
		edges[index].TargetOrder = orders[edges[index].TargetPort]
		orders[edges[index].TargetPort]++
	}
}

func validGraphMutation(scope Scope, projectID, canvasID string) bool {
	return validCallerScope(scope) && strings.TrimSpace(projectID) != "" && strings.TrimSpace(canvasID) != ""
}

type graphInputPolicy struct {
	enabled  bool
	modelID  string
	nodeType domain.NodeType
	limits   canvasNodeInputLimits
}

func (s *CanvasNodeService) resolveGraphInputPolicy(
	ctx context.Context,
	scope Scope,
	projectID string,
	canvasID string,
	targetNodeID string,
	targetPort domain.Port,
) (graphInputPolicy, error) {
	if targetPort == domain.PortReferenceText {
		return graphInputPolicy{}, nil
	}
	target, err := s.repository.Get(ctx, scope, projectID, canvasID, targetNodeID)
	if err != nil {
		return graphInputPolicy{}, err
	}
	if target.Type != domain.NodeTypeImageGeneration && target.Type != domain.NodeTypeVideoGeneration {
		return graphInputPolicy{}, nil
	}
	limits, err := s.resolveCanvasNodeInputLimits(ctx, scope, target)
	if err != nil {
		return graphInputPolicy{}, err
	}
	return graphInputPolicy{
		enabled:  true,
		modelID:  target.GenerationConfig.ModelServiceID,
		nodeType: target.Type,
		limits:   limits,
	}, nil
}

func (p graphInputPolicy) Validate(target domain.CanvasNode, edges []domain.IncomingEdge) error {
	if !p.enabled {
		return nil
	}
	if target.Type != p.nodeType || target.GenerationConfig.ModelServiceID != p.modelID {
		return ErrRevisionConflict
	}
	return validateCanvasNodeInputLimits(p.limits, edges)
}

func classifyGraphMutation(err error) error {
	switch {
	case errors.Is(err, ErrRevisionConflict):
		return errno.Wrap(errno.ErrConflict, err)
	case errors.Is(err, ErrNotFound):
		return errno.Wrap(errno.ErrNotFound, err)
	case errors.Is(err, domain.ErrPortCapacity):
		return errno.WrapWithMessage(
			errno.ErrCanvasNodeAssetLimitExceeded,
			"首帧和尾帧各最多连接 1 张图片",
			err,
		)
	case errors.Is(err, domain.ErrCycleDetected):
		return errno.WrapWithMessage(errno.ErrInvalidArgument, "连接会形成环路", err)
	case errors.Is(err, domain.ErrInputModeConflict):
		return errno.WrapWithMessage(errno.ErrInvalidArgument, "当前素材与视频输入模式不匹配", err)
	case errors.Is(err, domain.ErrInvalidCanvasNode), errors.Is(err, domain.ErrInvalidEdge):
		return errno.Wrap(errno.ErrInvalidArgument, err)
	default:
		return errno.Ensure(errno.ErrPersistenceError, err)
	}
}
