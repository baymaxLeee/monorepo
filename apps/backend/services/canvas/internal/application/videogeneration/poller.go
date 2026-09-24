package videogeneration

import (
	"context"
	"errors"
	"math/rand/v2"
	"strings"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	domainprojectusage "github.com/example/monorepo/canvas/internal/domain/projectusage"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
)

const (
	generationPollSuccessBackoffMax      = 5 * time.Minute
	generationPollAttemptsPerSuccessBand = 30
	generationPollErrorBackoffBase       = 10 * time.Second
	generationPollErrorBackoffMax        = 5 * time.Minute
	generationPollErrorsPerBackoffLevel  = 3
	generationPollMaxConsecutiveErrors   = 12
	generationFinalizationGrace          = time.Hour
	generationResultConfirmationTimeout  = 30 * time.Second
)

func generationPollSuccessDelay(pollAttempts int32) time.Duration {
	if pollAttempts < 1 {
		pollAttempts = 1
	}
	level := (pollAttempts - 1) / generationPollAttemptsPerSuccessBand
	delay := generationPollInterval
	for level > 0 && delay < generationPollSuccessBackoffMax {
		delay *= 2
		level--
	}
	if delay > generationPollSuccessBackoffMax {
		return generationPollSuccessBackoffMax
	}
	return delay
}

func generationPollErrorDelay(consecutiveErrors int32, jitterUnit float64) time.Duration {
	if consecutiveErrors < 1 {
		consecutiveErrors = 1
	}
	level := (consecutiveErrors - 1) / generationPollErrorsPerBackoffLevel
	nominal := generationPollErrorBackoffBase
	for level > 0 && nominal < generationPollErrorBackoffMax {
		if nominal > generationPollErrorBackoffMax/2 {
			nominal = generationPollErrorBackoffMax
			break
		}
		nominal *= 2
		level--
	}
	if jitterUnit < 0 {
		jitterUnit = 0
	} else if jitterUnit > 1 {
		jitterUnit = 1
	}
	delay := time.Duration(float64(nominal) * (0.8 + 0.4*jitterUnit))
	if delay > generationPollErrorBackoffMax {
		return generationPollErrorBackoffMax
	}
	return delay
}

func (s *Service) processPollClaim(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule) error {
	if s.videoGenerations == nil || s.canvasnodeVideoProvider == nil || s.clock == nil {
		return errors.New("generation polling dependencies are not configured")
	}
	detail, err := s.videoGenerations.GetGeneration(ctx, runScope(run), run.ID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return s.processCanvasNodeVideoPollEvent(ctx, run, schedule, CanvasNodeVideoPollEvent{Kind: CanvasNodeVideoPollEventTargetMissing, Error: err})
		}
		return err
	}
	now := s.clock.Now()
	if run.Status == domaintask.StatusQueued || strings.TrimSpace(detail.ProviderTaskID) == "" {
		if s.projectUsageCalls != nil {
			_, err = s.projectUsageCalls.MarkInterruptedIfPresent(ctx, domainprojectusage.CallRef{
				TaskRunID: run.ID, CallOrdinal: videoGenerationCallOrdinal,
			}, "video generation submission was interrupted after a provider call began")
			if err != nil {
				return err
			}
		}
		return s.processCanvasNodeVideoPollEvent(ctx, run, schedule, CanvasNodeVideoPollEvent{Kind: CanvasNodeVideoPollEventSubmissionInterrupted})
	}
	if !schedule.DeadlineAt.IsZero() && !now.Before(schedule.DeadlineAt) {
		return s.processCanvasNodeVideoPollEvent(ctx, run, schedule, CanvasNodeVideoPollEvent{Kind: CanvasNodeVideoPollEventDeadlineExceeded})
	}
	if strings.TrimSpace(detail.ProviderVideoURL) != "" {
		return s.processCanvasNodeVideoPollEvent(ctx, run, schedule, CanvasNodeVideoPollEvent{Kind: CanvasNodeVideoPollEventFinalize})
	}
	task, err := s.canvasnodeVideoProvider.Get(ctx, canvasnodeVideoProviderIdentity(run, detail), detail.ProviderTaskID)
	if err != nil {
		if errors.Is(err, ErrCanvasNodeVideoProviderTaskNotFound) {
			return s.processCanvasNodeVideoPollEvent(ctx, run, schedule, CanvasNodeVideoPollEvent{Kind: CanvasNodeVideoPollEventProviderTaskNotFound, Error: err})
		}
		return s.processCanvasNodeVideoPollEvent(ctx, run, schedule, CanvasNodeVideoPollEvent{Kind: CanvasNodeVideoPollEventProviderError, Error: err})
	}
	return s.processCanvasNodeVideoPollEvent(ctx, run, schedule, CanvasNodeVideoPollEvent{Kind: CanvasNodeVideoPollEventProviderResult, Task: CanvasNodeVideoPollObservation{
		Status: task.Status, ResultRef: task.VideoURL, ErrorCode: task.ErrorCode, ErrorMessage: task.ErrorMessage,
		SeedanceTaskID:        task.SeedanceTaskID,
		OutputDurationSeconds: task.OutputDurationSeconds,
	}, PreviousProviderStatus: detail.ProviderStatus})
}

func (*Service) RunType() domaintask.RunType {
	return domaintask.RunTypeCanvasNodeVideoGeneration
}

// ProcessPollClaim owns provider interaction for canvasnode video runs. The
// schedule is fenced independently so stale workers cannot mutate later work.
func (s *Service) ProcessPollClaim(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule) error {
	return s.processPollClaim(ctx, run, schedule)
}

func (s *Service) processCanvasNodeVideoPollEvent(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule, event CanvasNodeVideoPollEvent) error {
	if s.runs == nil || s.videoGenerations == nil || s.canvasnodeVideoResults == nil {
		return errors.New("generation polling dependencies are not configured")
	}
	now := s.clock.Now()
	switch event.Kind {
	case CanvasNodeVideoPollEventSubmissionInterrupted:
		_, err := s.markFailedWithSchedule(ctx, run, &schedule, "视频生成任务提交中断", now)
		return err
	case CanvasNodeVideoPollEventDeadlineExceeded:
		_, err := s.markFailedWithSchedule(ctx, run, &schedule, "视频生成任务超时", now)
		return err
	case CanvasNodeVideoPollEventProviderTaskNotFound:
		_, err := s.markFailedWithSchedule(ctx, run, &schedule, "视频生成任务已不存在", now)
		return err
	case CanvasNodeVideoPollEventTargetMissing:
		_, err := s.markFailedWithSchedule(ctx, run, &schedule, "视频生成目标已不存在", now)
		return err
	case CanvasNodeVideoPollEventProviderError:
		if schedule.ConsecutiveErrors+1 >= generationPollMaxConsecutiveErrors {
			_, err := s.markFailedWithSchedule(ctx, run, &schedule, "视频生成状态查询持续失败", now)
			return errors.Join(event.Error, err)
		}
		next := now.Add(generationPollErrorDelay(schedule.ConsecutiveErrors+1, rand.Float64()))
		err := s.applyPoll(ctx, run, schedule, CanvasNodeVideoPollResult{NextPollingAt: &next, ProviderError: true}, now)
		return err
	case CanvasNodeVideoPollEventFinalize:
		detail, err := s.videoGenerations.GetGeneration(ctx, runScope(run), run.ID)
		if err != nil {
			return err
		}
		return s.persistResult(ctx, run, schedule, detail.ProjectID, detail.ProviderVideoURL, now)
	case CanvasNodeVideoPollEventProviderResult:
		return s.applyCanvasNodeVideoProviderTask(ctx, run, schedule, event.PreviousProviderStatus, CanvasNodeVideoProviderTask{
			Status: event.Task.Status, VideoURL: event.Task.ResultRef,
			ErrorCode: event.Task.ErrorCode, ErrorMessage: event.Task.ErrorMessage,
			SeedanceTaskID:        event.Task.SeedanceTaskID,
			OutputDurationSeconds: event.Task.OutputDurationSeconds,
		}, now)
	default:
		return errors.New("unsupported generation poll event")
	}
}

func (s *Service) HasPendingGenerationFinalization(ctx context.Context, run domaintask.TaskRun) (bool, error) {
	detail, err := s.videoGenerations.GetGeneration(ctx, runScope(run), run.ID)
	if err != nil {
		return false, err
	}
	return detail.ProviderVideoURL != "", nil
}

func (s *Service) applyCanvasNodeVideoProviderTask(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule, previousProviderStatus domainvideo.ProviderStatus, task CanvasNodeVideoProviderTask, now time.Time) error {
	result := CanvasNodeVideoPollResult{SeedanceTaskID: strings.TrimSpace(task.SeedanceTaskID)}
	switch task.Status {
	case domainvideo.ProviderStatusQueued, domainvideo.ProviderStatusRunning:
		result.ProviderStatus = task.Status
		next := now.Add(generationPollSuccessDelay(schedule.PollAttempts + 1))
		result.NextPollingAt = &next
	case domainvideo.ProviderStatusSucceeded:
		result.ProviderStatus = domainvideo.ProviderStatusSucceeded
		next := now.Add(generationPollInterval)
		result.NextPollingAt = &next
		if strings.TrimSpace(task.VideoURL) == "" {
			result.TerminalStatus = domaintask.StatusFailed
			result.ErrorMessage = "视频生成服务返回空地址"
			result.NextPollingAt = nil
			result.FinishedAt = &now
		} else {
			result.OutputDurationSeconds = task.OutputDurationSeconds
			deadline := now.Add(generationFinalizationGrace)
			if schedule.DeadlineAt.After(deadline) {
				deadline = schedule.DeadlineAt
			}
			result.DeadlineAt = &deadline
		}
	case domainvideo.ProviderStatusFailed:
		result.TerminalStatus = domaintask.StatusFailed
		result.ProviderStatus = domainvideo.ProviderStatusFailed
		result.ErrorMessage = task.ErrorMessage
		result.ProviderErrorCode = strings.TrimSpace(task.ErrorCode)
		result.ProviderErrorMessage = task.ErrorMessage
		result.FinishedAt = &now
	case domainvideo.ProviderStatusCancelled:
		result.TerminalStatus = domaintask.StatusCancelled
		result.ProviderStatus = domainvideo.ProviderStatusCancelled
		result.FinishedAt = &now
	default:
		result.ProviderStatus = domainvideo.ProviderStatusUnknown
		if schedule.ConsecutiveErrors+1 >= generationPollMaxConsecutiveErrors {
			result.TerminalStatus = domaintask.StatusFailed
			result.ErrorMessage = "视频生成状态查询持续失败"
			result.FinishedAt = &now
			break
		}
		result.ProviderError = true
		next := now.Add(generationPollErrorDelay(schedule.ConsecutiveErrors+1, rand.Float64()))
		result.NextPollingAt = &next
	}
	if task.Status == domainvideo.ProviderStatusSucceeded && strings.TrimSpace(task.VideoURL) != "" {
		_, err := s.applyPollWithHistory(ctx, run, schedule, result, previousProviderStatus, task.VideoURL, PersistedCanvasNodeVideo{}, now)
		return err
	}
	_, err := s.applyPollWithHistory(ctx, run, schedule, result, previousProviderStatus, "", PersistedCanvasNodeVideo{}, now)
	return err
}

func (s *Service) persistResult(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule, projectID, sourceURL string, now time.Time) error {
	persisted, err := s.canvasnodeVideoResults.Persist(ctx, CanvasNodeVideoResultInput{
		TaskRunID: run.ID, TenantID: run.TenantID, WorkspaceID: run.WorkspaceID,
		ProjectID: projectID, CallerID: run.CreatedBy, SourceURL: sourceURL,
	})
	if err != nil {
		next := now.Add(generationPollErrorDelay(schedule.ConsecutiveErrors+1, rand.Float64()))
		applyErr := s.applyPoll(ctx, run, schedule, CanvasNodeVideoPollResult{NextPollingAt: &next, ProviderError: true}, now)
		return errors.Join(err, applyErr)
	}
	sourceAssetID := persisted.SourceAssetID
	finishedAt := now
	applied, applyErr := s.applyPollWithHistory(ctx, run, schedule, CanvasNodeVideoPollResult{TerminalStatus: domaintask.StatusSucceeded, FinishedAt: &finishedAt}, "", "", persisted, now)
	if applyErr != nil {
		committed, confirmationErr := s.confirmResultCommit(ctx, run.ID, sourceAssetID)
		if committed {
			s.applyCanvasNodeVideoPostCommit(ctx, run, applied)
			return nil
		}
		if confirmationErr != nil {
			// A failed COMMIT can mean either rollback or a committed transaction
			// whose response was lost. When persistence cannot disambiguate it,
			// retaining an orphan is safer than deleting an Artifact that a
			// successful Run may already reference.
			return errors.Join(applyErr, confirmationErr)
		}
		// Persist already checkpointed an owned Artifact. An ambiguous commit may
		// have bound it successfully, so retaining it is safer than deleting live data.
		return applyErr
	}
	return nil
}

func (s *Service) confirmResultCommit(ctx context.Context, taskRunID, sourceAssetID string) (bool, error) {
	confirmationCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), generationResultConfirmationTimeout)
	defer cancel()
	run, err := s.runs.GetTaskRun(confirmationCtx, taskRunID)
	if err != nil {
		return false, err
	}
	detail, err := s.videoGenerations.GetGeneration(confirmationCtx, runScope(run), taskRunID)
	if err != nil {
		return false, err
	}
	runHasSuccessfulVideo := run.Status == domaintask.StatusWaitingSubtasks ||
		run.Status == domaintask.StatusSucceeded || run.Status == domaintask.StatusPartialSuccess
	detailSucceeded := detail.Status == string(domaintask.StatusSucceeded)
	if runHasSuccessfulVideo && detailSucceeded && detail.AssetID != "" && s.assetManager != nil {
		asset, assetErr := s.assetManager.Get(confirmationCtx, applicationasset.GetInput{
			Scope:   applicationasset.Scope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy},
			Owner:   applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationOutput, Key: run.ID},
			AssetID: detail.AssetID,
		})
		if assetErr != nil {
			return false, assetErr
		}
		if asset.SourceAssetID == sourceAssetID {
			return true, nil
		}
	}
	if !runHasSuccessfulVideo && !detailSucceeded && detail.AssetID == "" {
		return false, nil
	}
	return false, errors.New("generation result commit state is inconsistent")
}
