package canvas

import (
	"context"
	"unicode/utf8"

	applicationmodel "github.com/example/monorepo/canvas/internal/server/application/model"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	"github.com/example/monorepo/canvas/internal/server/domain/assetmatching"
	domain "github.com/example/monorepo/canvas/internal/server/domain/canvas"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type PromptAssetMatch struct {
	ResourceAssetID string `json:"resource_asset_id"`
	AnchorText      string `json:"anchor_text"`
}
type PromptAssetMatchInput struct {
	Scope      Scope
	ProjectID  string
	Prompt     string
	Candidates []assetmatching.Candidate
	Model      applicationmodel.Selection
}
type PromptAssetMatcher interface {
	Match(context.Context, PromptAssetMatchInput) ([]PromptAssetMatch, error)
}
type MatchedAsset struct {
	ResourceAssetID, ResourceID, Name, AnchorText string
	MediaType                                     domainasset.MediaType
}
type MatchAssetsResult struct {
	Prompt  string
	Matches []MatchedAsset
}

func WithPromptAssetMatcher(matcher PromptAssetMatcher) CanvasNodeOption {
	return func(s *CanvasNodeService) { s.assetMatcher = matcher }
}

func (s *CanvasNodeService) matchAssetsForNode(ctx context.Context, scope Scope, node domain.CanvasNode) (MatchAssetsResult, error) {
	result := MatchAssetsResult{Prompt: node.Prompt, Matches: []MatchedAsset{}}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if s.assetMatcher == nil || s.assetCatalog == nil || s.models == nil {
		return result, errno.New(errno.ErrConfigurationError)
	}
	modelID := node.GenerationConfig.ModelServiceID
	limits := AssetLimits{}
	if node.Type == domain.NodeTypeVideoGeneration {
		caps, e := s.videoCapabilities(ctx, scope, modelID)
		if e != nil {
			return result, e
		}
		limits = storyboardAssetLimits(caps)
	} else {
		caps, e := s.imageCapabilities(ctx, scope, modelID, 1)
		if e != nil {
			return result, e
		}
		limits.Image = int64(modelReferenceLimit(caps.MaxInputReferences))
	}
	candidates, err := s.assetCatalog.ListProjectAssets(ctx, scope, node.ProjectID, storyboardAssetCatalogLimit+1)
	if err != nil {
		return result, classify(err)
	}
	if len(candidates) > storyboardAssetCatalogLimit {
		return result, errno.NewWithMessage(errno.ErrInvalidArgument, "项目素材过多，请缩小资产库后重试")
	}
	nodes, err := s.repository.List(ctx, scope, node.ProjectID, node.CanvasID)
	if err != nil {
		return result, classify(err)
	}
	mentions, err := domain.AssetMentionIDs(node.Prompt)
	if err != nil {
		return result, errno.New(errno.ErrInvalidArgument)
	}
	// Edges consume capacity, but only surviving mentions protect a user's choice.
	// A removed mention must be repairable without removing its existing edge.
	mentioned := make(map[string]bool, len(mentions))
	for _, id := range mentions {
		mentioned[id] = true
	}
	linked := make(map[string]bool, len(node.IncomingEdges))
	for _, edge := range node.IncomingEdges {
		linked[edge.SourceNodeID] = true
	}
	used := make(map[domainasset.MediaType]int64)
	protected := make(map[string]bool)
	reusable := make(map[string]string)
	for _, source := range nodes {
		if !linked[source.ID] && !mentioned[source.ID] {
			continue
		}
		switch source.Type {
		case domain.NodeTypeImageAsset, domain.NodeTypeImageGeneration:
			used[domainasset.MediaImage]++
		case domain.NodeTypeVideoAsset, domain.NodeTypeVideoGeneration:
			used[domainasset.MediaVideo]++
		case domain.NodeTypeAudioAsset:
			used[domainasset.MediaAudio]++
		}
		for _, c := range candidates {
			same := source.ResourceAssetID == c.ResourceAssetID ||
				(source.ResourceID != "" && source.ResourceID == c.ResourceID) ||
				(c.Asset.ID != "" && (source.AssetID == c.Asset.ID || source.SelectedAssetID == c.Asset.ID || source.CurrentAssetID == c.Asset.ID))
			if !same {
				continue
			}
			if mentioned[source.ID] || node.Type == domain.NodeTypeImageGeneration {
				protected[matchResourceKey(c)] = true
			} else if linked[source.ID] && reusable[c.ResourceAssetID] == "" {
				reusable[c.ResourceAssetID] = source.ID
			}
		}
	}
	available := make([]assetmatching.Candidate, 0, len(candidates))
	byID := make(map[string]ProjectAssetCandidate)
	for _, c := range candidates {
		if protected[matchResourceKey(c)] || byID[c.ResourceAssetID].ResourceAssetID != "" {
			continue
		}
		candidate := assetmatching.Candidate{ResourceAssetID: c.ResourceAssetID, ResourceID: c.ResourceID, ResourceName: c.ResourceName, Name: c.Name, Description: c.Description, Primary: c.Primary, MediaType: c.Asset.MediaType}
		occupancy := used
		if reusable[c.ResourceAssetID] != "" {
			// Repairing an existing edge's slot adds no media input, even at capacity.
			occupancy = nil
		}
		if len(assetmatching.AvailableCandidates([]assetmatching.Candidate{candidate}, limits, occupancy)) == 0 {
			continue
		}
		byID[c.ResourceAssetID] = c
		available = append(available, candidate)
	}
	if len(available) == 0 {
		return result, nil
	}
	models, err := s.models.Resolve(ctx, applicationmodel.Actor{TenantID: scope.TenantID, UserID: scope.CallerID}, []applicationmodel.Requirement{{Capability: applicationmodel.CapabilityStoryboardInference}})
	if err != nil {
		return result, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	if len(models) != 1 {
		return result, errno.New(errno.ErrModelUnavailable)
	}
	// Existing mention labels are visible context, but are never rewritten or re-selected.
	visible, err := domain.ReplaceAssetMentionsWithLabels(node.Prompt)
	if err != nil {
		return result, errno.New(errno.ErrInvalidArgument)
	}
	matched, err := s.assetMatcher.Match(ctx, PromptAssetMatchInput{Scope: scope, ProjectID: node.ProjectID, Prompt: visible, Candidates: available, Model: models[0].Selection})
	if err != nil {
		return result, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	if err = ctx.Err(); err != nil {
		return result, err
	}
	bindings := make([]assetmatching.Binding, 0, len(matched))
	for _, match := range matched {
		bindings = append(bindings, assetmatching.Binding{ResourceAssetID: match.ResourceAssetID, EntityName: match.AnchorText})
	}
	bindings = assetmatching.ResolveBindings(visible, bindings, available)
	budget := assetmatching.NewBudget(limits, used)
	selected := make(map[string]bool)
	for _, binding := range bindings {
		c, ok := byID[binding.ResourceAssetID]
		if !ok || selected[matchResourceKey(c)] {
			continue
		}
		targetField, start, end := assetmatching.ReferenceTarget(result.Prompt, c.Asset.MediaType, binding.EntityName)
		if targetField == "" {
			continue
		}
		mentionID := c.ResourceAssetID
		if reusable[c.ResourceAssetID] != "" {
			mentionID = reusable[c.ResourceAssetID]
		}
		next, inserted, insertErr := domain.InsertAssetMentionAfterText(result.Prompt[start:end], binding.EntityName, mentionID, c.Name)
		next = result.Prompt[:start] + next + result.Prompt[end:]
		if insertErr != nil {
			return result, errno.New(errno.ErrInvalidArgument)
		}
		if !inserted {
			continue
		}
		if node.Type == domain.NodeTypeVideoGeneration && utf8.RuneCountInString(next) > storyboardPromptMaxRunes {
			continue
		}
		if reusable[c.ResourceAssetID] == "" && !budget.Take(assetmatching.Candidate{ResourceAssetID: c.ResourceAssetID, ResourceID: c.ResourceID, MediaType: c.Asset.MediaType}) {
			continue
		}
		if node.Type == domain.NodeTypeVideoGeneration {
			result.Prompt = next
		}
		selected[matchResourceKey(c)] = true
		if reusable[c.ResourceAssetID] != "" {
			continue
		}
		result.Matches = append(result.Matches, MatchedAsset{ResourceAssetID: c.ResourceAssetID, ResourceID: c.ResourceID, Name: c.Name, MediaType: c.Asset.MediaType, AnchorText: binding.EntityName})
	}
	return result, nil
}

// Resource-less catalog entries must not collapse into one protected identity.
func matchResourceKey(c ProjectAssetCandidate) string {
	if c.ResourceID != "" {
		return c.ResourceID
	}
	return c.ResourceAssetID
}
