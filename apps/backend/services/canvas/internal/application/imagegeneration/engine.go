package imagegeneration

import (
	"context"
	"strings"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

const imageGenerationDeadline = 30 * time.Minute

type Engine struct {
	targets      *TargetRegistry
	runs         EngineRunStore
	tasks        TaskStore
	transactions TransactionManager
	ids          IDGenerator
	clock        Clock
	executions   *applicationtask.ActiveExecutions
	admission    StorageAdmission
	references   AssetReferenceTracker
	usage        usageIntegration
}

type StorageAdmission interface {
	CheckStorageAdmission(context.Context, string) error
}

func NewEngine(targets *TargetRegistry, runs EngineRunStore, tasks TaskStore, transactions TransactionManager, ids IDGenerator, clock Clock, executions *applicationtask.ActiveExecutions, admission StorageAdmission, references AssetReferenceTracker, options ...Option) *Engine {
	return &Engine{
		targets: targets, runs: runs, tasks: tasks, transactions: transactions,
		ids: ids, clock: clock, executions: executions, admission: admission, references: references, usage: projectUsageIntegration(options),
	}
}

type RunView struct {
	Detail  domainimagegeneration.Run
	TaskRun domaintask.TaskRun
}

func (engine *Engine) Start(ctx context.Context, input StartInput) (domainimagegeneration.Run, error) {
	if engine == nil || !validScope(input.Scope) || !input.TargetType.Valid() || strings.TrimSpace(input.TargetID) == "" || input.ExpectedRevision < 1 ||
		strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.ModelName) == "" || strings.TrimSpace(input.ModelSource) == "" ||
		engine.targets == nil || engine.runs == nil || engine.tasks == nil || engine.transactions == nil || engine.ids == nil || engine.clock == nil {
		return domainimagegeneration.Run{}, domainimagegeneration.ErrInvalidGeneration
	}
	handler, err := engine.targets.Handler(input.TargetType)
	if err != nil {
		return domainimagegeneration.Run{}, err
	}
	if engine.admission != nil {
		if err = engine.admission.CheckStorageAdmission(ctx, input.TenantID); err != nil {
			return domainimagegeneration.Run{}, err
		}
	}
	taskRunID, err := engine.ids.NewID()
	if err != nil {
		return domainimagegeneration.Run{}, err
	}
	var run domainimagegeneration.Run
	err = engine.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		spec, prepareErr := handler.PrepareStart(txCtx, StartTarget{
			Scope: input.Scope, TargetType: input.TargetType, TargetID: input.TargetID, ExpectedRevision: input.ExpectedRevision,
		}, taskRunID)
		if prepareErr != nil {
			return prepareErr
		}
		if spec.Target.Type != input.TargetType || spec.Target.ID != input.TargetID || spec.Target.Revision != input.ExpectedRevision {
			return ErrRunConflict
		}
		now := engine.clock.Now().UTC()
		run, prepareErr = domainimagegeneration.NewRun(domainimagegeneration.NewRunInput{
			TaskRunID: taskRunID, Spec: spec, TenantID: input.TenantID, ProjectID: input.ProjectID, WorkspaceID: input.WorkspaceID,
			CreatedBy: input.CallerID, Now: now,
		})
		if prepareErr != nil {
			return prepareErr
		}
		taskRun := domaintask.TaskRun{
			ID: taskRunID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID,
			RunType: domaintask.RunTypeImageGeneration, SubjectType: domaintask.SubjectTypeImageGeneration,
			SubjectID: input.TargetID, Status: domaintask.StatusQueued, StateVersion: 1,
			CreatedBy: input.CallerID, CreatedAt: now, UpdatedAt: now,
		}
		if validateErr := taskRun.Validate(); validateErr != nil {
			return validateErr
		}
		if createErr := engine.tasks.Create(txCtx, taskRun); createErr != nil {
			return createErr
		}
		if engine.usage.calls != nil {
			if _, createErr := engine.usage.calls.Plan(txCtx, imageUsagePlanInput(
				taskRunID, input.ProjectID, spec.Config.ModelID, input.ModelName, input.ModelSource,
			)); createErr != nil {
				return createErr
			}
		}
		if createErr := engine.runs.CreateRun(txCtx, run); createErr != nil {
			return createErr
		}
		schedule := domaintask.PollSchedule{
			TaskRunID: taskRunID, NextPollAt: now, StateVersion: 1,
			DeadlineAt: now.Add(imageGenerationDeadline), CreatedAt: now, UpdatedAt: now,
		}
		return engine.tasks.CreatePollSchedule(txCtx, schedule)
	})
	if err != nil {
		return domainimagegeneration.Run{}, err
	}
	return run, nil
}

func (engine *Engine) GetRun(ctx context.Context, input GetRunInput) (RunView, error) {
	if engine == nil || !validScope(input.Scope) || !input.TargetType.Valid() || strings.TrimSpace(input.TargetID) == "" || strings.TrimSpace(input.TaskRunID) == "" || engine.runs == nil || engine.tasks == nil {
		return RunView{}, domainimagegeneration.ErrInvalidGeneration
	}
	detail, err := engine.runs.GetRun(ctx, input.Scope, input.TaskRunID)
	if err != nil {
		return RunView{}, err
	}
	taskRun, err := engine.tasks.GetTaskRun(ctx, input.TaskRunID)
	if err != nil {
		return RunView{}, err
	}
	if detail.Target.Type != input.TargetType || detail.Target.ID != input.TargetID ||
		taskRun.RunType != domaintask.RunTypeImageGeneration || taskRun.SubjectType != domaintask.SubjectTypeImageGeneration ||
		taskRun.SubjectID != input.TargetID || taskRun.TenantID != input.TenantID || !sameWorkspace(taskRun.WorkspaceID, input.WorkspaceID) {
		return RunView{}, ErrRunConflict
	}
	return RunView{Detail: detail, TaskRun: taskRun}, nil
}

func (engine *Engine) ListRuns(ctx context.Context, scope Scope, targetType domainimagegeneration.TargetType, targetID string) ([]RunView, error) {
	if engine == nil || !validScope(scope) || !targetType.Valid() || strings.TrimSpace(targetID) == "" || engine.runs == nil || engine.tasks == nil {
		return nil, domainimagegeneration.ErrInvalidGeneration
	}
	runs, err := engine.runs.ListRuns(ctx, scope, targetType, targetID)
	if err != nil {
		return nil, err
	}
	taskIDs := make([]string, 0, len(runs))
	for _, run := range runs {
		taskIDs = append(taskIDs, run.TaskRunID)
	}
	taskRuns, err := engine.tasks.BatchGetTaskRuns(
		ctx,
		applicationtask.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID},
		taskIDs,
	)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]domaintask.TaskRun, len(taskRuns))
	for _, taskRun := range taskRuns {
		byID[taskRun.ID] = taskRun
	}
	views := make([]RunView, 0, len(runs))
	for _, run := range runs {
		if taskRun, ok := byID[run.TaskRunID]; ok {
			views = append(views, RunView{Detail: run, TaskRun: taskRun})
		}
	}
	return views, nil
}

func (engine *Engine) ReleaseOutputsByCanvasNodes(ctx context.Context, scope Scope, canvasNodeIDs []string, hiddenAt time.Time) error {
	return engine.ReleaseOutputsByTargets(ctx, scope, domainimagegeneration.TargetCanvasNode, canvasNodeIDs, hiddenAt)
}

func (engine *Engine) ReleaseOutputsByTargets(ctx context.Context, scope Scope, targetType domainimagegeneration.TargetType, targetIDs []string, hiddenAt time.Time) error {
	if engine == nil {
		return domainimagegeneration.ErrInvalidGeneration
	}
	visibility, ok := engine.tasks.(TaskVisibilityStore)
	if !validScope(scope) || !targetType.Valid() || len(targetIDs) == 0 || hiddenAt.IsZero() || engine.runs == nil || !ok || engine.transactions == nil {
		return domainimagegeneration.ErrInvalidGeneration
	}
	return engine.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		runIDs, err := engine.runs.ListRunIDsByTargets(txCtx, scope, targetType, targetIDs)
		if err != nil {
			return err
		}
		if err = visibility.HideTaskRunsBySubjects(
			txCtx, applicationtask.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID},
			domaintask.RunTypeImageGeneration, domaintask.SubjectTypeImageGeneration, targetIDs, hiddenAt,
		); err != nil {
			return err
		}
		if engine.references == nil {
			return nil
		}
		for _, runID := range runIDs {
			if err = engine.references.ReleaseAllAssets(txCtx, applicationasset.ReleaseAllAssetsInput{
				Scope: applicationasset.ReferenceScope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID},
				Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerImageGenerationOutput, Key: runID},
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

// BatchGetLatestRuns returns at most one latest run per target, preserving the
// first requested target order. Both generation rows and task rows are loaded
// in batches so polling does not degrade into N+1 queries.
func (engine *Engine) BatchGetLatestRuns(ctx context.Context, scope Scope, targetType domainimagegeneration.TargetType, targetIDs []string) ([]RunView, error) {
	if engine == nil || !validScope(scope) || !targetType.Valid() || len(targetIDs) == 0 || len(targetIDs) > 100 || engine.runs == nil || engine.tasks == nil {
		return nil, domainimagegeneration.ErrInvalidGeneration
	}
	runStore, ok := engine.runs.(interface {
		ListLatestRuns(context.Context, Scope, domainimagegeneration.TargetType, []string) ([]domainimagegeneration.Run, error)
	})
	taskStore, okTasks := engine.tasks.(interface {
		BatchGetTaskRuns(context.Context, applicationtask.Scope, []string) ([]domaintask.TaskRun, error)
	})
	if !ok || !okTasks {
		return nil, domainimagegeneration.ErrInvalidGeneration
	}
	runs, err := runStore.ListLatestRuns(ctx, scope, targetType, targetIDs)
	if err != nil {
		return nil, err
	}
	taskIDs := make([]string, 0, len(runs))
	for _, run := range runs {
		taskIDs = append(taskIDs, run.TaskRunID)
	}
	if len(taskIDs) == 0 {
		return []RunView{}, nil
	}
	tasks, err := taskStore.BatchGetTaskRuns(ctx, applicationtask.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}, taskIDs)
	if err != nil {
		return nil, err
	}
	tasksByID := make(map[string]domaintask.TaskRun, len(tasks))
	for _, task := range tasks {
		tasksByID[task.ID] = task
	}
	views := make([]RunView, 0, len(runs))
	for _, run := range runs {
		if task, found := tasksByID[run.TaskRunID]; found && task.SubjectID == run.Target.ID {
			views = append(views, RunView{Detail: run, TaskRun: task})
		}
	}
	return views, nil
}

func (engine *Engine) Cancel(ctx context.Context, input CancelInput) error {
	if engine == nil || !validScope(input.Scope) || !input.TargetType.Valid() || strings.TrimSpace(input.TargetID) == "" || strings.TrimSpace(input.TaskRunID) == "" ||
		engine.targets == nil || engine.runs == nil || engine.tasks == nil || engine.transactions == nil || engine.clock == nil {
		return domainimagegeneration.ErrInvalidGeneration
	}
	run, err := engine.runs.GetRun(ctx, input.Scope, input.TaskRunID)
	if err != nil {
		return err
	}
	if run.Target.Type != input.TargetType || run.Target.ID != input.TargetID {
		return ErrRunConflict
	}
	handler, err := engine.targets.Handler(run.Target.Type)
	if err != nil {
		return err
	}
	err = engine.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		taskRun, getErr := engine.tasks.GetTaskRunForUpdate(txCtx, input.TaskRunID)
		if getErr != nil {
			return getErr
		}
		if taskRun.RunType != domaintask.RunTypeImageGeneration || taskRun.SubjectType != domaintask.SubjectTypeImageGeneration ||
			taskRun.SubjectID != input.TargetID || taskRun.TenantID != input.TenantID || !sameWorkspace(taskRun.WorkspaceID, input.WorkspaceID) {
			return ErrRunConflict
		}
		if taskRun.Terminal() {
			return nil
		}
		if releaseErr := handler.ReleaseRun(txCtx, run); releaseErr != nil {
			return releaseErr
		}
		now := engine.clock.Now().UTC()
		finishedAt := now
		won, updateErr := engine.tasks.UpdateTaskRun(txCtx, taskRun, applicationtask.TaskRunUpdate{Status: domaintask.StatusCancelled, FinishedAt: &finishedAt}, now)
		if updateErr != nil {
			return updateErr
		}
		if !won {
			return ErrRunConflict
		}
		run.Stage, run.UpdatedAt = "CANCELLED", now
		if saveErr := engine.runs.SaveRun(txCtx, run); saveErr != nil {
			return saveErr
		}
		if deleteErr := engine.tasks.DeletePollSchedule(txCtx, input.TaskRunID); deleteErr != nil {
			return deleteErr
		}
		return closeImageUsage(txCtx, engine.usage.finalizer, taskRun.ID)
	})
	if err == nil {
		triggerImageUsageAfterCommit(engine.usage.finalizer, input.TaskRunID)
		if engine.executions != nil {
			engine.executions.Cancel(input.TaskRunID)
		}
	}
	return err
}

func validScope(scope Scope) bool {
	return strings.TrimSpace(scope.TenantID) != "" && strings.TrimSpace(scope.CallerID) != ""
}

func sameWorkspace(actual, expected *string) bool {
	if actual == nil || expected == nil {
		return actual == nil && expected == nil
	}
	return *actual == *expected
}
