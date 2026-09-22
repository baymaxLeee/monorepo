package aigw

import (
	"context"

	"github.com/volcengine/volcengine-go-sdk/service/arkruntime/model/responses"
	"go.uber.org/zap"

	applicationcanvasnode "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	"github.com/example/monorepo/canvas/internal/domain/assetmatching"
)

const storyboardAssetMatchMaxAttempts = 2

type storyboardAssetBinding = assetmatching.Binding

func (s *StoryboardSplitter) matchStoryboardDraftAssets(ctx context.Context, taskRunID string, model applicationmodel.Selection, draft applicationcanvasnode.StoryboardDraft, constraints applicationcanvasnode.StoryboardConstraints, ledger applicationcanvasnode.StoryboardModelCallLedger, ordinals *storyboardCallOrdinalAllocator) []storyboardAssetBinding {
	candidates := assetmatching.AvailableCandidates(constraints.AssetCandidates, constraints.AssetLimits, nil)
	if len(candidates) == 0 {
		return nil
	}
	input := applicationcanvasnode.PromptAssetMatchInput{Prompt: draft.Prompt, Candidates: candidates, Model: model}
	matches, err := matchPromptAssets(ctx, input, func(ctx context.Context, request *responses.ResponsesRequest) (storyboardStreamOutcome, error) {
		ordinal, err := ordinals.take()
		if err != nil {
			return storyboardStreamOutcome{}, err
		}
		return s.executeStoryboardRequest(ctx, taskRunID, model.ModelID, ordinal, request, ledger, nil)
	})
	if err == nil {
		bindings := make([]storyboardAssetBinding, 0, len(matches))
		for _, match := range matches {
			bindings = append(bindings, storyboardAssetBinding{ResourceAssetID: match.ResourceAssetID, EntityName: match.AnchorText})
		}
		return assetmatching.ResolveBindings(draft.Prompt, bindings, candidates)
	}
	if ctx.Err() != nil {
		return nil
	}
	if s.log != nil {
		s.log.Warn("storyboard asset matching exhausted retries; prompts remain usable", zap.Int("canvasnode_no", draft.CanvasNodeNo), zap.Error(err))
	}
	return assetmatching.ResolveBindings(draft.Prompt, nil, candidates)
}

func attachStoryboardAssetsToDraft(draft applicationcanvasnode.StoryboardDraft, bindings []storyboardAssetBinding, constraints applicationcanvasnode.StoryboardConstraints) applicationcanvasnode.StoryboardDraft {
	candidates := assetmatching.AvailableCandidates(constraints.AssetCandidates, constraints.AssetLimits, nil)
	bindings = assetmatching.ResolveBindings(draft.Prompt, bindings, candidates)
	byID := make(map[string]assetmatching.Candidate, len(candidates))
	for _, candidate := range candidates {
		byID[candidate.ResourceAssetID] = candidate
	}
	budget := assetmatching.NewBudget(constraints.AssetLimits, nil)
	for _, binding := range bindings {
		candidate := byID[binding.ResourceAssetID]
		target, _, _ := assetmatching.ReferenceTarget(draft.Prompt, candidate.MediaType, binding.EntityName)
		if target == "" || !budget.Take(candidate) {
			continue
		}
		draft.AssetReferences = append(draft.AssetReferences, applicationcanvasnode.StoryboardAssetReference{ResourceAssetID: binding.ResourceAssetID, TargetField: target, AnchorText: binding.EntityName})
	}
	return draft
}
