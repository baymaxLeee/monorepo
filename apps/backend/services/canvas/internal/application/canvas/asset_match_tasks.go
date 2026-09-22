package canvas

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type AssetMatchNodeSlots interface {
	ClaimTaskRun(context.Context, domain.CanvasNode) (bool, error)
	ReleaseTaskRun(context.Context, domain.CanvasNode, string) (bool, error)
}
type assetMatchTasks struct {
	slots     AssetMatchNodeSlots
	runs      applicationtask.TaskRunStore
	schedules applicationtask.PollScheduleStore
	reader    applicationtask.ScopedTaskRunBatchReader
}

func WithAssetMatchTasks(slots AssetMatchNodeSlots, runs applicationtask.TaskRunStore, schedules applicationtask.PollScheduleStore, reader applicationtask.ScopedTaskRunBatchReader) CanvasNodeOption {
	return func(s *CanvasNodeService) {
		s.assetMatchTasks = &assetMatchTasks{slots: slots, runs: runs, schedules: schedules, reader: reader}
	}
}

type StartAssetsMatchInput struct {
	Scope
	ProjectID, CanvasID, NodeID string
	Revision                    int64
}

func (s *CanvasNodeService) StartAssetsMatch(ctx context.Context, input StartAssetsMatchInput) (domaintask.TaskRun, error) {
	if !validGraphMutation(input.Scope, input.ProjectID, input.CanvasID) || strings.TrimSpace(input.NodeID) == "" || input.Revision < 1 {
		return domaintask.TaskRun{}, errno.New(errno.ErrInvalidArgument)
	}
	if s.assetMatchTasks == nil || s.assetMatcher == nil {
		return domaintask.TaskRun{}, errno.New(errno.ErrConfigurationError)
	}
	node, err := s.repository.Get(ctx, input.Scope, input.ProjectID, input.CanvasID, input.NodeID)
	if err != nil {
		return domaintask.TaskRun{}, classify(err)
	}
	if node.Revision != input.Revision {
		return domaintask.TaskRun{}, errno.NewWithMessage(errno.ErrConflict, "节点已变化，请刷新并保存后重新匹配")
	}
	if node.ActiveTaskRunID != "" || strings.TrimSpace(node.Prompt) == "" || utf8.RuneCountInString(node.Prompt) > storyboardPromptMaxRunes ||
		(node.Type != domain.NodeTypeImageGeneration && node.Type != domain.NodeTypeVideoGeneration) || (node.Type == domain.NodeTypeVideoGeneration && node.VideoInputMode != domain.VideoInputModeReference) {
		return domaintask.TaskRun{}, errno.New(errno.ErrInvalidArgument)
	}
	id, err := s.ids.NewID()
	if err != nil {
		return domaintask.TaskRun{}, classify(err)
	}
	now := s.clock.Now()
	run := domaintask.TaskRun{ID: id, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CreatedBy: input.CallerID, RunType: s.RunType(), SubjectType: domaintask.SubjectTypeCanvasNode, SubjectID: node.ID, Status: domaintask.StatusQueued, StateVersion: 1, CreatedAt: now, UpdatedAt: now}
	node.ActiveTaskRunID = id
	err = s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		claimed, e := s.assetMatchTasks.slots.ClaimTaskRun(tx, node)
		if e != nil {
			return e
		}
		if !claimed {
			return ErrRevisionConflict
		}
		if e = s.assetMatchTasks.runs.Create(tx, run); e != nil {
			return e
		}
		return s.assetMatchTasks.schedules.CreatePollSchedule(tx, domaintask.PollSchedule{TaskRunID: id, NextPollAt: now, StateVersion: 1, DeadlineAt: now.Add(2 * time.Minute), CreatedAt: now, UpdatedAt: now})
	})
	return run, classify(err)
}

// CancelAssetsMatch fences result submission durably; model execution on another
// replica may finish, but its stale run version can no longer mutate the graph.
func (s *CanvasNodeService) CancelAssetsMatch(ctx context.Context, scope Scope, projectID, canvasID, nodeID, taskRunID string) error {
	if !validGraphMutation(scope, projectID, canvasID) || strings.TrimSpace(nodeID) == "" || strings.TrimSpace(taskRunID) == "" {
		return errno.New(errno.ErrInvalidArgument)
	}
	if s.assetMatchTasks == nil {
		return errno.New(errno.ErrConfigurationError)
	}
	node, err := s.repository.Get(ctx, scope, projectID, canvasID, nodeID)
	if err != nil {
		return classify(err)
	}
	err = s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		run, e := s.assetMatchTasks.runs.Get(tx, applicationtask.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}, s.RunType(), domaintask.SubjectTypeCanvasNode, node.ID, taskRunID)
		if e != nil {
			return e
		}
		// Completion wins if it has already committed. Polling returns that result.
		if run.Terminal() {
			return nil
		}
		now := s.clock.Now()
		ok, e := s.assetMatchTasks.runs.UpdateTaskRun(tx, run, applicationtask.TaskRunUpdate{Status: domaintask.StatusCancelled, FinishedAt: &now}, now)
		if e != nil {
			return e
		}
		if !ok {
			return ErrRevisionConflict
		}
		if _, e = s.graphRepository.LockCanvas(tx, scope, projectID, canvasID); e != nil {
			return e
		}
		if _, e = s.assetMatchTasks.slots.ReleaseTaskRun(tx, node, taskRunID); e != nil {
			return e
		}
		return s.assetMatchTasks.schedules.DeletePollSchedule(tx, taskRunID)
	})
	if errors.Is(err, applicationtask.ErrNotFound) {
		return errno.New(errno.ErrNotFound)
	}
	return classify(err)
}

func (*CanvasNodeService) RunType() domaintask.RunType {
	return domaintask.RunTypeCanvasNodeAssetsMatch
}

// The active slot freezes the saved authoring definition until completion. No
// browser session, draft, or process-local goroutine owns the durable operation.
func (s *CanvasNodeService) ProcessPollClaim(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule) error {
	if s.assetMatchTasks == nil || run.RunType != s.RunType() || schedule.TaskRunID != run.ID {
		return errors.New("invalid asset matching claim")
	}
	scope := Scope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy}
	node, err := s.repository.GetByID(ctx, scope, run.SubjectID)
	if err != nil {
		return s.finishAssetsMatch(ctx, scope, run, schedule, node, MatchAssetsResult{}, err)
	}
	if node.ActiveTaskRunID != run.ID {
		return s.finishAssetsMatch(ctx, scope, run, schedule, node, MatchAssetsResult{}, ErrRevisionConflict)
	}
	if !s.clock.Now().Before(schedule.DeadlineAt) {
		return s.finishAssetsMatch(ctx, scope, run, schedule, node, MatchAssetsResult{}, context.DeadlineExceeded)
	}
	now := s.clock.Now()
	// Every lease takeover advances the run fence, rejecting the previous owner's late result.
	claimed, err := s.assetMatchTasks.runs.UpdateTaskRun(ctx, run, applicationtask.TaskRunUpdate{Status: domaintask.StatusRunning, StartedAt: &now}, now)
	if err != nil {
		return err
	}
	if !claimed {
		return nil
	}
	run.Status = domaintask.StatusRunning
	run.StateVersion++
	work, cancel := context.WithDeadline(ctx, schedule.DeadlineAt)
	defer cancel()
	result, matchErr := s.matchAssetsForNode(work, scope, node)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	err = s.finishAssetsMatch(ctx, scope, run, schedule, node, result, matchErr)
	if err != nil && matchErr == nil {
		// A failed graph transaction rolls back both the result and the terminal CAS.
		return s.finishAssetsMatch(ctx, scope, run, schedule, node, MatchAssetsResult{}, err)
	}
	return err
}

func (s *CanvasNodeService) finishAssetsMatch(ctx context.Context, scope Scope, run domaintask.TaskRun, schedule domaintask.PollSchedule, node domain.CanvasNode, result MatchAssetsResult, failure error) error {
	now := s.clock.Now()
	update := applicationtask.TaskRunUpdate{Status: domaintask.StatusSucceeded, FinishedAt: &now}
	if failure != nil {
		update.Status = domaintask.StatusFailed
		update.ErrorCode = string(errno.CodeOf(classify(failure)))
		update.ErrorMessage = "素材匹配失败，请重试"
		if errors.Is(failure, context.DeadlineExceeded) {
			update.ErrorCode = string(errno.ErrRequestTimeout)
			update.ErrorMessage = "素材匹配执行超时，请重试"
			if run.Status == domaintask.StatusQueued {
				update.ErrorMessage = "素材匹配排队超时，请重试"
			}
		}
	}
	return s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		ok, err := s.assetMatchTasks.runs.UpdateTaskRun(tx, run, update, now)
		if err != nil {
			return err
		}
		if !ok {
			return nil
		}
		// Acquire the graph lock before releasing the slot. Other graph writers cannot
		// observe the release until prompt, edges, and task completion commit together.
		if node.ID != "" {
			if _, err = s.graphRepository.LockCanvas(tx, scope, node.ProjectID, node.CanvasID); err != nil {
				return err
			}
			released, e := s.assetMatchTasks.slots.ReleaseTaskRun(tx, node, run.ID)
			if e != nil {
				return e
			}
			if failure == nil {
				if !released {
					return ErrRevisionConflict
				}
				if e = s.applyMatchedAssets(tx, scope, node, result); e != nil {
					return e
				}
			}
		}
		ok, err = s.assetMatchTasks.schedules.CompletePollSchedule(tx, schedule)
		if err != nil {
			return err
		}
		if !ok {
			return ErrRevisionConflict
		}
		return nil
	})
}

func (s *CanvasNodeService) applyMatchedAssets(ctx context.Context, scope Scope, node domain.CanvasNode, result MatchAssetsResult) error {
	replacements := make(map[string]string, len(result.Matches))
	for index, match := range result.Matches {
		input := MaterializeResourceAssetReferenceInput{Scope: scope, ProjectID: node.ProjectID, CanvasID: node.CanvasID, TargetNodeID: node.ID, ReferenceType: MentionReferenceTypeResourceAsset, ResourceAssetID: match.ResourceAssetID, TargetPort: domain.PortReferenceImage, ResourceAssetNodePosition: &domain.Position{PositionX: node.Position.PositionX - 360, PositionY: node.Position.PositionY + float64(index)*180}}
		switch match.MediaType {
		case domainasset.MediaVideo:
			input.TargetPort = domain.PortReferenceVideo
		case domainasset.MediaAudio:
			input.TargetPort = domain.PortReferenceAudio
			input.ResourceID = match.ResourceID
			input.ResourceAssetID = ""
		}
		materialized, err := s.MaterializeResourceAssetReference(ctx, input)
		if err != nil {
			return err
		}
		replacements[match.ResourceAssetID] = materialized.ResourceAssetNode.ID
	}
	prompt, err := domain.ReplaceAssetMentionIDs(result.Prompt, replacements)
	if err != nil {
		return err
	}
	current, err := s.repository.GetForUpdate(ctx, scope, node.ProjectID, node.CanvasID, node.ID)
	if err != nil {
		return err
	}
	if current.Prompt != node.Prompt {
		return ErrRevisionConflict
	}
	if prompt == current.Prompt {
		return nil
	}
	patch := domain.UpdatePatch{ExpectedRevision: current.Revision, Prompt: &prompt}
	if err = current.Update(patch, scope.CallerID, s.clock.Now()); err != nil {
		return err
	}
	_, _, _, err = s.repository.Update(ctx, current, patch)
	return err
}

func (s *CanvasNodeService) projectAssetsMatching(ctx context.Context, scope Scope, views []CanvasNodeView) error {
	if s.assetMatchTasks == nil || s.assetMatchTasks.reader == nil {
		return nil
	}
	ids := make([]string, 0, len(views))
	for _, view := range views {
		if view.ActiveTaskRunID != "" {
			ids = append(ids, view.ActiveTaskRunID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	runs, err := s.assetMatchTasks.reader.BatchGetScopedTaskRuns(ctx, applicationtask.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}, ids)
	if err != nil {
		return err
	}
	matches := make(map[string]string)
	for _, run := range runs {
		if run.RunType == s.RunType() && run.SubjectType == domaintask.SubjectTypeCanvasNode {
			matches[run.ID] = run.SubjectID
		}
	}
	for i := range views {
		views[i].AssetsMatching = matches[views[i].ActiveTaskRunID] == views[i].ID
	}
	return nil
}

func (s *CanvasNodeService) BatchGetViews(ctx context.Context, scope Scope, projectID, canvasID string, ids []string) ([]CanvasNodeView, error) {
	nodes, err := s.repository.BatchGet(ctx, scope, projectID, canvasID, ids)
	if err != nil {
		return nil, classify(err)
	}
	if err = s.resolveCurrentResourceAssets(ctx, scope, projectID, nodes); err != nil {
		return nil, err
	}
	return s.ProjectViews(ctx, scope, nodes)
}
