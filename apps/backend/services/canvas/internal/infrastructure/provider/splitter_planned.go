package provider

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"go.uber.org/zap"

	applicationcanvasnode "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	providerclient "github.com/example/monorepo/canvas/internal/infrastructure/provider/client"
)

type storyboardCallOrdinalAllocator struct {
	mu   sync.Mutex
	next int
}

func (a *storyboardCallOrdinalAllocator) take() (int, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.next < 1 || a.next > storyboardMaxModelCalls {
		return 0, newStoryboardModelError("storyboard generation exceeded the bounded model-call budget of %d", storyboardMaxModelCalls)
	}
	ordinal := a.next
	a.next++
	return ordinal, nil
}

type storyboardPlannedBatchResult struct {
	drafts      []applicationcanvasnode.StoryboardDraft
	diagnostics []applicationcanvasnode.StoryboardRoundDiagnostic
	err         error
}

func (s *StoryboardSplitter) splitFrozenStoryboard(
	ctx context.Context,
	taskRunID string,
	model applicationmodel.Selection,
	plot string,
	constraints applicationcanvasnode.StoryboardConstraints,
	state applicationcanvasnode.StoryboardGenerationState,
	modelCalls applicationcanvasnode.StoryboardModelCallLedger,
	checkpoint func(applicationcanvasnode.StoryboardGenerationState) error,
	emit func(applicationcanvasnode.StoryboardDraft) error,
) error {
	taskRunID = strings.TrimSpace(taskRunID)
	if taskRunID == "" {
		return errors.New("storyboard task run ID is required")
	}
	ctx = withStoryboardTraceContext(ctx, constraints)
	var beats []storyboardSourceBeat
	if strings.TrimSpace(plot) == "" {
		return errors.New("storyboard plot did not contain a source beat")
	}
	if len(state.SourceBeats) > 0 {
		if !storyboardSourceBeatsMatchPlot(state.SourceBeats, plot) {
			return errors.New("persisted storyboard source beats do not match the immutable plot")
		}
		beats = append([]storyboardSourceBeat(nil), state.SourceBeats...)
	}
	nextOrdinal, err := nextStoryboardModelCallOrdinal(ctx, taskRunID, modelCalls)
	if err != nil {
		return err
	}
	ordinals := &storyboardCallOrdinalAllocator{next: nextOrdinal}
	planItems, normalized := normalizeStoryboardPlan(state.Plan)
	plan := storyboardPlan{PlannedCanvasNodeCount: len(planItems), CanvasNodes: planItems}
	if len(plan.CanvasNodes) == 0 {
		if len(state.Completed) > 0 || len(state.Drafts) > 0 {
			return errors.New("completed storyboard drafts require their frozen plan")
		}
		plan, beats, err = s.planStoryboard(ctx, taskRunID, model, plot, constraints, modelCalls, ordinals)
		if err != nil {
			return err
		}
		state.ProtocolVersion = applicationcanvasnode.StoryboardGenerationProtocolVersion
		state.SourceBeats = append([]applicationcanvasnode.StoryboardSourceBeat(nil), beats...)
		state.Plan = append([]applicationcanvasnode.StoryboardPlanItem(nil), plan.CanvasNodes...)
		if err = checkpoint(state); err != nil {
			return fmt.Errorf("persist frozen storyboard plan: %w", err)
		}
	} else {
		// Old checkpoints may lack source beats; reconstruct only their input
		// mapping. This path never plans a new task.
		if len(beats) == 0 {
			beats = splitStoryboardSourceBeats(plot, constraints)
		}
		if err = validateFrozenStoryboardPlan(plan, beats, constraints); err != nil {
			return newStoryboardCauseModelError(err, "persisted storyboard plan failed local validation")
		}
		if normalized || state.ProtocolVersion != applicationcanvasnode.StoryboardGenerationProtocolVersion || len(state.SourceBeats) == 0 {
			if s.log != nil {
				s.log.Info("normalizing persisted storyboard plan into the current core shape",
					zap.String("task_run_id", taskRunID), zap.Bool("plan_fields_added", normalized))
			}
			state.ProtocolVersion = applicationcanvasnode.StoryboardGenerationProtocolVersion
			state.SourceBeats = append([]applicationcanvasnode.StoryboardSourceBeat(nil), beats...)
			state.Plan = append([]applicationcanvasnode.StoryboardPlanItem(nil), plan.CanvasNodes...)
			if err = checkpoint(state); err != nil {
				return fmt.Errorf("persist normalized storyboard plan: %w", err)
			}
		}
	}

	return s.runStoryboardPipeline(ctx, taskRunID, model, plan, beats, constraints, state, modelCalls, ordinals, emit)
}

func (s *StoryboardSplitter) runStoryboardPipeline(ctx context.Context, taskRunID string, model applicationmodel.Selection, plan storyboardPlan, beats []storyboardSourceBeat, constraints applicationcanvasnode.StoryboardConstraints, state applicationcanvasnode.StoryboardGenerationState, modelCalls applicationcanvasnode.StoryboardModelCallLedger, ordinals *storyboardCallOrdinalAllocator, emit func(applicationcanvasnode.StoryboardDraft) error) error {
	ctx, cancel := context.WithCancel(ctx)
	completed := make(map[int]struct{}, len(state.Completed))
	for _, number := range state.Completed {
		completed[number] = struct{}{}
	}
	batches := pendingStoryboardBatches(plan.CanvasNodes, completed)
	results := make(chan storyboardPlannedBatchResult, len(batches))
	jobs := make(chan []storyboardPlanItem)
	var workers sync.WaitGroup
	for range min(s.storyboardConcurrencyLimit(), len(batches)) {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for batch := range jobs {
				if ctx.Err() != nil {
					return
				}
				results <- s.generateStoryboardBatch(ctx, taskRunID, model, plan, batch, beats, constraints, modelCalls, ordinals)
			}
		}()
	}
	workers.Add(1)
	go func() {
		defer workers.Done()
		defer close(jobs)
		for _, batch := range batches {
			select {
			case jobs <- batch:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() { workers.Wait(); close(results) }()

	// The coordinator alone emits projections; asynchronous matching can never
	// race plain-draft persistence or overwrite a newer enrichment with plain text.
	assetJobs := make(chan applicationcanvasnode.StoryboardDraft, len(plan.CanvasNodes))
	assetResults := make(chan applicationcanvasnode.StoryboardDraft, len(plan.CanvasNodes))
	var assetWorkers sync.WaitGroup
	var catalogOnce sync.Once
	matchConstraints := constraints
	assetsEnabled := len(constraints.AssetCandidates) > 0 || constraints.LoadAssetCandidates != nil
	if assetsEnabled {
		for range min(s.storyboardConcurrencyLimit(), len(plan.CanvasNodes)) {
			assetWorkers.Add(1)
			go func() {
				defer assetWorkers.Done()
				for draft := range assetJobs {
					if ctx.Err() != nil {
						return
					}
					catalogOnce.Do(func() {
						if constraints.LoadAssetCandidates != nil {
							candidates, err := constraints.LoadAssetCandidates(ctx)
							if err != nil {
								matchConstraints.AssetCandidates = nil
								if s.log != nil {
									s.log.Warn("storyboard asset catalog unavailable; keeping plain drafts", zap.Error(err))
								}
								return
							}
							matchConstraints.AssetCandidates = candidates
						}
					})
					bindings := s.matchStoryboardDraftAssets(ctx, taskRunID, model, draft, matchConstraints, modelCalls, ordinals)
					enriched := attachStoryboardAssetsToDraft(draft, bindings, matchConstraints)
					select {
					case assetResults <- enriched:
					case <-ctx.Done():
						return
					}
				}
			}()
		}
	}
	// Buffered result queues allow producers to finish even after an emit failure.
	// Every exit cancels and joins both pipelines; no background writer survives.
	defer func() { cancel(); close(assetJobs); workers.Wait(); assetWorkers.Wait() }()
	pendingAssets := 0
	enqueueAsset := func(draft applicationcanvasnode.StoryboardDraft) {
		if assetsEnabled && len(draft.AssetReferences) == 0 {
			assetJobs <- draft
			pendingAssets++
		}
	}
	for _, draft := range state.Drafts {
		if _, ok := completed[draft.CanvasNodeNo]; ok {
			enqueueAsset(draft)
		}
	}
	pendingNumbers := make([]int, 0)
	for _, item := range plan.CanvasNodes {
		if _, ok := completed[item.Number]; !ok {
			pendingNumbers = append(pendingNumbers, item.Number)
		}
	}
	draftByNumber := make(map[int]applicationcanvasnode.StoryboardDraft)
	nextToEmit := 0
	var firstErr error
	var diagnostics []applicationcanvasnode.StoryboardRoundDiagnostic
	for results != nil || pendingAssets > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case draft := <-assetResults:
			pendingAssets--
			if len(draft.AssetReferences) > 0 {
				// Matching may finish before this node's ordered first publication.
				// Retain the enriched draft instead of publishing it out of order.
				if _, published := completed[draft.CanvasNodeNo]; !published {
					draftByNumber[draft.CanvasNodeNo] = draft
					continue
				}
				if err := emit(draft); err != nil {
					if ctx.Err() != nil {
						return ctx.Err()
					}
					if s.log != nil {
						s.log.Warn("storyboard asset enrichment failed; keeping plain draft", zap.String("task_run_id", taskRunID), zap.Int("canvasnode_no", draft.CanvasNodeNo), zap.Error(err))
					}
				}
			}
		case result, ok := <-results:
			if !ok {
				results = nil
				continue
			}
			if result.err != nil && firstErr == nil {
				firstErr = result.err
				diagnostics = append(diagnostics, result.diagnostics...)
			}
			for _, draft := range result.drafts {
				draftByNumber[draft.CanvasNodeNo] = draft
			}
			for nextToEmit < len(pendingNumbers) {
				draft, exists := draftByNumber[pendingNumbers[nextToEmit]]
				if !exists {
					break
				}
				if err := emit(draft); err != nil {
					return err
				}
				completed[draft.CanvasNodeNo] = struct{}{}
				nextToEmit++
			}
			// Inference depends on this node's complete prompt, not on earlier
			// nodes being ready for ordered publication.
			for _, draft := range result.drafts {
				enqueueAsset(draft)
			}
		}
	}
	if firstErr != nil {
		return newStoryboardCauseDiagnosticModelError(firstErr, diagnostics, firstErr.Error())
	}
	return ctx.Err()
}

func normalizeStoryboardPlan(items []storyboardPlanItem) ([]storyboardPlanItem, bool) {
	result := append([]storyboardPlanItem(nil), items...)
	changed := false
	for index := range result {
		item := &result[index]
		if strings.TrimSpace(item.Scene) == "" {
			item.Scene = "依据原剧情确定的场景"
			changed = true
		}
		if strings.TrimSpace(item.ContinuityGroup) == "" {
			item.ContinuityGroup = fmt.Sprintf("storyboard-%03d", item.Number)
			changed = true
		}
		if item.Characters == nil {
			item.Characters = []string{}
			changed = true
		}
		if item.Props == nil {
			item.Props = []string{}
			changed = true
		}
		if strings.TrimSpace(item.PositionReference) == "" {
			item.PositionReference = "第一帧根据原剧情建立人物、道具、朝向、视线和前后景关系。"
			changed = true
		}
		if item.AssetRequirements == nil {
			item.AssetRequirements = []string{}
			changed = true
		}
	}
	return result, changed
}

func storyboardSourceBeatsMatchPlot(beats []storyboardSourceBeat, plot string) bool {
	if len(beats) == 0 {
		return false
	}
	var joined strings.Builder
	seen := make(map[string]struct{}, len(beats))
	for _, beat := range beats {
		if strings.TrimSpace(beat.ID) == "" || strings.TrimSpace(beat.Text) == "" {
			return false
		}
		if _, duplicate := seen[beat.ID]; duplicate {
			return false
		}
		seen[beat.ID] = struct{}{}
		joined.WriteString(beat.Text)
	}
	normalize := func(value string) string { return strings.Join(strings.Fields(value), "") }
	return normalize(joined.String()) == normalize(plot)
}

func (s *StoryboardSplitter) storyboardConcurrencyLimit() int {
	if s.workerConcurrency > 0 {
		return s.workerConcurrency
	}
	return storyboardWorkerConcurrency
}

func (s *StoryboardSplitter) generateStoryboardBatch(
	ctx context.Context,
	taskRunID string,
	model applicationmodel.Selection,
	plan storyboardPlan,
	batch []storyboardPlanItem,
	beats []storyboardSourceBeat,
	constraints applicationcanvasnode.StoryboardConstraints,
	modelCalls applicationcanvasnode.StoryboardModelCallLedger,
	ordinals *storyboardCallOrdinalAllocator,
) storyboardPlannedBatchResult {
	accepted := make(map[int]struct{}, len(batch))
	drafts := make([]applicationcanvasnode.StoryboardDraft, 0, len(batch))
	noProgressRounds := 0
	var previousRejections []storyboardRepairRejection
	diagnostics := make([]applicationcanvasnode.StoryboardRoundDiagnostic, 0, storyboardMaxNoProgressRounds)
	for {
		if err := ctx.Err(); err != nil {
			return storyboardPlannedBatchResult{drafts: drafts, err: err}
		}
		missing := missingStoryboardPlanItems(batch, accepted)
		if len(missing) == 0 {
			return storyboardPlannedBatchResult{drafts: drafts}
		}
		requestBatch := missing
		if noProgressRounds > 0 && len(requestBatch) > 1 {
			requestBatch = requestBatch[:1]
		}
		feedback := ""
		if len(previousRejections) > 0 {
			feedback = storyboardPlannedRepairFeedback(
				plan.PlannedCanvasNodeCount, accepted, missing,
				storyboardPlanItemNumbers(requestBatch), previousRejections,
			)
		}
		ordinal, err := ordinals.take()
		if err != nil {
			drafts = append(drafts, fallbackStoryboardDrafts(missing, beats, constraints)...)
			return storyboardPlannedBatchResult{drafts: drafts}
		}
		request, err := storyboardDetailRequest(model, plan, requestBatch, beats, constraints, feedback)
		if err != nil {
			return storyboardPlannedBatchResult{drafts: drafts, diagnostics: diagnostics, err: err}
		}
		acceptedBefore := len(accepted)
		outcome, requestErr := s.executeStoryboardRequest(
			ctx, taskRunID, model.ModelID, ordinal, request, modelCalls,
			func(callID string, _ int, raw string) (storyboardCanvasNodeProcessResult, error) {
				return processFrozenStoryboardCanvasNode(
					raw, callID, requestBatch, beats, accepted, constraints,
					func(draft applicationcanvasnode.StoryboardDraft) error {
						drafts = append(drafts, draft)
						return nil
					},
				)
			},
		)
		remaining := missingStoryboardPlanItems(batch, accepted)
		rejections := plannedStoryboardRoundRejections(outcome, plan.PlannedCanvasNodeCount, requestErr)
		diagnostics = append(diagnostics, storyboardRoundDiagnostic(
			ordinal, outcome.ResponseID, storyboardAcceptedNumbers(accepted),
			storyboardPlanItemNumbers(remaining), rejections,
		))
		previousRejections = rejections
		if len(accepted) > acceptedBefore {
			noProgressRounds = 0
		} else {
			noProgressRounds++
		}
		if requestErr == nil && validPlannedDetailOutcome(outcome, plan.PlannedCanvasNodeCount) && len(remaining) == 0 {
			return storyboardPlannedBatchResult{drafts: drafts}
		}
		s.logPlannedModelRound(
			ctx, model.ModelID, ordinal, outcome, storyboardAcceptedNumbers(accepted),
			storyboardPlanItemNumbers(remaining), rejections,
		)
		if noProgressRounds >= storyboardMaxNoProgressRounds {
			if s.log != nil {
				s.log.Warn("storyboard detail batch used deterministic fallback",
					zap.Ints("canvasnode_no", storyboardPlanItemNumbers(remaining)),
					zap.Int("no_progress_rounds", storyboardMaxNoProgressRounds))
			}
			drafts = append(drafts, fallbackStoryboardDrafts(remaining, beats, constraints)...)
			return storyboardPlannedBatchResult{drafts: drafts}
		}
	}
}

func pendingStoryboardBatches(
	items []storyboardPlanItem,
	completed map[int]struct{},
) [][]storyboardPlanItem {
	pending := make([]storyboardPlanItem, 0, len(items))
	for _, item := range items {
		if _, exists := completed[item.Number]; !exists {
			pending = append(pending, item)
		}
	}
	if len(pending) == 0 {
		return nil
	}
	// A one-node leading request minimizes time-to-first-content under provider's
	// params.done behavior. Remaining requests retain the 1-3 node throughput
	// trade-off and can run concurrently.
	batches := make([][]storyboardPlanItem, 0, (len(pending)+storyboardPlannedBatchSize-1)/storyboardPlannedBatchSize+1)
	batches = append(batches, append([]storyboardPlanItem(nil), pending[:1]...))
	for start := 1; start < len(pending); start += storyboardPlannedBatchSize {
		end := min(start+storyboardPlannedBatchSize, len(pending))
		batches = append(batches, append([]storyboardPlanItem(nil), pending[start:end]...))
	}
	return batches
}

func withStoryboardTraceContext(
	ctx context.Context,
	constraints applicationcanvasnode.StoryboardConstraints,
) context.Context {
	ctx = providerclient.WithTraceIdentity(ctx, constraints.TenantID, constraints.CallerID)
	return providerclient.WithProjectID(ctx, constraints.ProjectID)
}
