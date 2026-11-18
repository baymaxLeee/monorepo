package task

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	app "github.com/example/monorepo/canvas/internal/application/task"
	asynccontract "github.com/example/monorepo/canvas/internal/contract/asyncexecution"
	domain "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

const (
	asyncDeliveryClaimWindow          = 2 * time.Minute
	executionLeaseExpiredErrorCode    = "EXECUTION_LEASE_EXPIRED"
	executionLeaseExpiredErrorMessage = "asynchronous execution lease expired after maximum attempts"
)

type Repository struct{ db *persistencetransaction.Store }

func NewRepository(db *persistencetransaction.Store) *Repository { return &Repository{db: db} }

func (r *Repository) Create(ctx context.Context, run domain.TaskRun) error {
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if run.ParentTaskID == nil {
			if run.RootTaskID == "" {
				run.RootTaskID = run.ID
			}
		} else {
			parentID, err := persistenceid.Parse(*run.ParentTaskID)
			if err != nil {
				return app.ErrInvalidTaskHierarchy
			}
			parent, err := r.db.Queries(ctx).LockTaskRun(ctx, parentID.String())
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return app.ErrInvalidTaskHierarchy
				}
				return err
			}
			parentRun := fromRow(parent)
			if parentRun.TenantID != run.TenantID || !sameWorkspace(parentRun.WorkspaceID, run.WorkspaceID) {
				return app.ErrInvalidTaskHierarchy
			}
			if parentRun.Terminal() {
				return app.ErrInvalidTaskHierarchy
			}
			rootTaskID := parentRun.EffectiveRootTaskID()
			if run.RootTaskID != "" && run.RootTaskID != rootTaskID {
				return app.ErrInvalidTaskHierarchy
			}
			run.RootTaskID = rootTaskID
		}
		row, err := toRow(run)
		if err != nil {
			return err
		}
		return r.db.Queries(ctx).InsertTaskRun(ctx, sqlc.InsertTaskRunParams(row))
	})
}

func (r *Repository) CreatePollSchedule(ctx context.Context, schedule domain.PollSchedule) error {
	row, err := pollScheduleToRow(schedule)
	if err != nil {
		return err
	}
	q := r.db.Queries(ctx)
	runType, err := q.ReadTaskRunType(ctx, row.TaskRunID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return app.ErrNotFound
		}
		return err
	}
	backend, ok := app.ExecutionBackendForRunType(domain.RunType(runType))
	if !ok || backend != app.ExecutionBackendLocalScheduled {
		return app.ErrExecutionBackendMismatch
	}
	return q.InsertPollSchedule(ctx, row)
}

func (r *Repository) ClaimDuePollSchedules(ctx context.Context, runType domain.RunType, now, leaseUntil time.Time, limit int) ([]domain.PollSchedule, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := r.db.Queries(ctx).ClaimPollSchedules(ctx, sqlc.ClaimPollSchedulesParams{
		RunType:  string(runType),
		Now:      now,
		Lease:    leaseUntil,
		PageSize: int64(limit),
	})
	if err != nil {
		return nil, err
	}
	items := make([]domain.PollSchedule, 0, len(rows))
	for _, row := range rows {
		items = append(items, pollScheduleFromRow(row))
	}
	return items, nil
}

func (r *Repository) RenewPollSchedule(ctx context.Context, schedule domain.PollSchedule, now, leaseUntil time.Time) (bool, error) {
	id, err := persistenceid.Parse(schedule.TaskRunID)
	if err != nil {
		return false, err
	}
	return changed(r.db.Queries(ctx).RenewPollLease(ctx, sqlc.RenewPollLeaseParams{
		ID:      id.String(),
		Version: schedule.StateVersion,
		Now:     now,
		Lease:   leaseUntil,
	}))
}

func (r *Repository) ReschedulePoll(ctx context.Context, schedule domain.PollSchedule, update domain.PollScheduleUpdate, now time.Time) (bool, error) {
	id, err := persistenceid.Parse(schedule.TaskRunID)
	if err != nil {
		return false, err
	}
	return changed(r.db.Queries(ctx).ReschedulePoll(ctx, sqlc.ReschedulePollParams{
		ID:                id.String(),
		Version:           schedule.StateVersion,
		Now:               now,
		DeadlineAt:        update.DeadlineAt,
		NextPollAt:        update.NextPollAt,
		PollAttempts:      update.PollAttempts,
		ConsecutiveErrors: update.ConsecutiveErrors,
	}))
}

func (r *Repository) CompletePollSchedule(ctx context.Context, schedule domain.PollSchedule) (bool, error) {
	id, err := persistenceid.Parse(schedule.TaskRunID)
	if err != nil {
		return false, err
	}
	return changed(r.db.Queries(ctx).CompletePoll(ctx, sqlc.CompletePollParams{ID: id.String(), Version: schedule.StateVersion}))
}

func (r *Repository) DeletePollSchedule(ctx context.Context, taskRunID string) error {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return err
	}
	return r.db.Queries(ctx).DeletePoll(ctx, id.String())
}

func (r *Repository) CreateAsyncDispatch(ctx context.Context, dispatch domain.AsyncDispatch) error {
	row, err := asyncDispatchToRow(dispatch)
	if err != nil {
		return err
	}
	return r.db.Queries(ctx).InsertAsyncDispatch(ctx, sqlc.InsertAsyncDispatchParams(row))
}

func (r *Repository) DeleteAsyncDispatch(ctx context.Context, taskRunID string) error {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return err
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		if err := q.DiscardTaskEvents(ctx, sqlc.DiscardTaskEventsParams{ID: id.String(), Now: time.Now().UTC()}); err != nil {
			return err
		}
		return q.DeleteTaskDispatch(ctx, id.String())
	})
}

func (r *Repository) CreateAsyncExecutionEvent(ctx context.Context, event asynccontract.Event) error {
	row, err := asyncExecutionEventToRow(event)
	if err != nil {
		return err
	}
	return r.db.Queries(ctx).InsertAsyncExecutionEvent(ctx, sqlc.InsertAsyncExecutionEventParams(row))
}

func (r *Repository) GetAsyncExecutionEvent(ctx context.Context, eventID string) (asynccontract.Event, error) {
	id, err := persistenceid.Parse(eventID)
	if err != nil {
		return asynccontract.Event{}, err
	}
	row, err := r.db.Queries(ctx).ReadTaskEvent(ctx, id.String())
	if err != nil {
		return asynccontract.Event{}, err
	}
	return asyncExecutionEventFromRow(row), nil
}

func (r *Repository) HasUnfinishedAsyncExecutionEventBefore(
	ctx context.Context,
	executionToken string,
	sequence int32,
) (bool, error) {
	return r.db.Queries(ctx).HasEarlierTaskEvent(ctx, sqlc.HasEarlierTaskEventParams{Token: executionToken, Sequence: sequence})
}

func (r *Repository) GetAsyncDispatch(ctx context.Context, taskRunID string) (domain.AsyncDispatch, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return domain.AsyncDispatch{}, err
	}
	row, err := r.db.Queries(ctx).ReadTaskDispatch(ctx, id.String())
	if err != nil {
		return domain.AsyncDispatch{}, readErr(err)
	}
	return asyncDispatchFromRow(row), nil
}

func (r *Repository) ClaimDueAsyncExecutionEvents(
	ctx context.Context,
	now time.Time,
	leaseUntil time.Time,
	limit int,
) ([]asynccontract.Event, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := r.db.Queries(ctx).ClaimDueTaskEvents(ctx, sqlc.ClaimDueTaskEventsParams{Now: now, Lease: leaseUntil, PageSize: int64(limit)})
	if err != nil {
		return nil, err
	}
	items := make([]asynccontract.Event, 0, len(rows))
	for _, row := range rows {
		items = append(items, asyncExecutionEventFromRow(sqlc.AsyncExecutionEvent(row)))
	}
	return items, nil
}

func (r *Repository) MarkAsyncExecutionEventConsumed(
	ctx context.Context,
	event asynccontract.Event,
	now time.Time,
) (bool, error) {
	return r.finishAsyncExecutionEvent(ctx, event, asynccontract.ConsumeStatusConsumed, now)
}

func (r *Repository) DiscardAsyncExecutionEvent(
	ctx context.Context,
	event asynccontract.Event,
	now time.Time,
) (bool, error) {
	return r.finishAsyncExecutionEvent(ctx, event, asynccontract.ConsumeStatusDiscarded, now)
}

func (r *Repository) finishAsyncExecutionEvent(
	ctx context.Context,
	event asynccontract.Event,
	status asynccontract.ConsumeStatus,
	now time.Time,
) (bool, error) {
	id, err := persistenceid.Parse(event.ID)
	if err != nil {
		return false, err
	}
	return changed(r.db.Queries(ctx).FinishTaskEvent(ctx, sqlc.FinishTaskEventParams{
		ID:      id.String(),
		Version: event.StateVersion,
		Status:  string(status),
		Now:     &now,
	}))
}

func (r *Repository) RescheduleAsyncExecutionEvent(
	ctx context.Context,
	event asynccontract.Event,
	nextConsumeAt time.Time,
	errorCode string,
	errorMessage string,
	now time.Time,
) (bool, error) {
	id, err := persistenceid.Parse(event.ID)
	if err != nil {
		return false, err
	}
	return changed(r.db.Queries(ctx).RetryTaskEvent(ctx, sqlc.RetryTaskEventParams{
		ID:      id.String(),
		Version: event.StateVersion,
		Due:     nextConsumeAt,
		Code:    errorCode,
		Message: errorMessage,
		Now:     now,
	}))
}

func (r *Repository) ClaimDueAsyncDispatches(
	ctx context.Context,
	now time.Time,
	leaseUntil time.Time,
	limit int,
) ([]domain.AsyncDispatch, error) {
	if limit <= 0 {
		return nil, nil
	}
	q := r.db.Queries(ctx)
	rows, err := q.DueTaskDispatches(ctx, sqlc.DueTaskDispatchesParams{Now: now, PageSize: int64(limit)})
	if err != nil {
		return nil, err
	}
	items := make([]domain.AsyncDispatch, 0, len(rows))
	for _, row := range rows {
		var item domain.AsyncDispatch
		var ok bool
		switch domain.AsyncExecutionState(row.ExecutionState) {
		case domain.AsyncExecutionExecuting:
			item, ok, err = r.recoverExpiredAsyncExecution(ctx, row, now, leaseUntil)
		case domain.AsyncExecutionFailurePending:
			item, ok, err = claimedDispatch(q.ClaimFailureDispatch(ctx, sqlc.ClaimFailureDispatchParams{
				ID:      row.TaskRunID,
				Version: row.ExecutionVersion,
				Now:     now,
				Lease:   leaseUntil,
			}))
		default:
			item, ok, err = claimedDispatch(q.ClaimWaitingDispatch(ctx, sqlc.ClaimWaitingDispatchParams{
				ID:      row.TaskRunID,
				Version: row.DeliveryVersion,
				Now:     now,
				Lease:   leaseUntil,
			}))
		}
		if err != nil {
			return nil, err
		}
		if ok {
			items = append(items, item)
		}
	}
	return items, nil
}

func (r *Repository) recoverExpiredAsyncExecution(
	ctx context.Context,
	candidate sqlc.AsyncDispatch,
	now time.Time,
	publishLeaseUntil time.Time,
) (domain.AsyncDispatch, bool, error) {
	var result domain.AsyncDispatch
	var ok bool
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		row, err := q.LockExpiredDispatch(ctx, sqlc.LockExpiredDispatchParams{
			ID:      candidate.TaskRunID,
			Version: candidate.ExecutionVersion,
			Now:     now,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		terminal, err := q.ReadTerminalEvent(ctx, row.ExecutionToken)
		switch {
		case err == nil:
			if terminal.ConsumeStatus == string(asynccontract.ConsumeStatusConsumed) || terminal.ConsumeStatus == string(asynccontract.ConsumeStatusDiscarded) {
				return q.CompleteExpiredDispatch(ctx, sqlc.CompleteExpiredDispatchParams{ID: row.TaskRunID, Version: row.ExecutionVersion})
			}
			return q.ExpediteTerminalEvent(ctx, sqlc.ExpediteTerminalEventParams{ID: terminal.ID, Now: now})
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		unfinished, err := q.HasUnfinishedTaskEvents(ctx, row.ExecutionToken)
		if err != nil {
			return err
		}
		if unfinished {
			return q.ExpeditePendingEvents(ctx, sqlc.ExpeditePendingEventsParams{Token: row.ExecutionToken, Now: now})
		}
		args := sqlc.RecoverExpiredDispatchParams{
			ID:                row.TaskRunID,
			Version:           row.ExecutionVersion,
			State:             string(domain.AsyncExecutionWaiting),
			PublishLeaseUntil: &publishLeaseUntil,
			Now:               now,
			Code:              row.LastErrorCode,
			Message:           row.LastErrorMessage,
		}
		if row.LeaseRecoveries+1 >= 10 || asyncDispatchFromRow(row).RecoveryExpired(now) {
			args.State = string(domain.AsyncExecutionFailurePending)
			args.PublishLeaseUntil = nil
			args.ExecutionLeaseUntil = &publishLeaseUntil
			args.Code = executionLeaseExpiredErrorCode
			args.Message = executionLeaseExpiredErrorMessage
		}
		result, ok, err = claimedDispatch(q.RecoverExpiredDispatch(ctx, args))
		return err
	})
	return result, ok, err
}

func (r *Repository) RescheduleAsyncDispatch(
	ctx context.Context,
	dispatch domain.AsyncDispatch,
	nextDispatchAt time.Time,
	errorCode string,
	errorMessage string,
	now time.Time,
) (domain.AsyncDispatch, bool, error) {
	id, err := persistenceid.Parse(dispatch.TaskRunID)
	if err != nil {
		return domain.AsyncDispatch{}, false, err
	}
	return claimedDispatch(r.db.Queries(ctx).RescheduleTaskDispatch(ctx, sqlc.RescheduleTaskDispatchParams{
		ID:      id.String(),
		Now:     now,
		Due:     nextDispatchAt,
		Code:    errorCode,
		Message: errorMessage,
		Version: dispatch.DeliveryVersion,
	}))
}

func (r *Repository) MarkAsyncDispatchDelivered(
	ctx context.Context,
	dispatch domain.AsyncDispatch,
	now time.Time,
) (bool, error) {
	id, err := persistenceid.Parse(dispatch.TaskRunID)
	if err != nil {
		return false, err
	}
	_, ok, err := claimedDispatch(r.db.Queries(ctx).DeliverTaskDispatch(ctx, sqlc.DeliverTaskDispatchParams{
		ID:      id.String(),
		Now:     now,
		Due:     now.Add(asyncDeliveryClaimWindow),
		Version: dispatch.DeliveryVersion,
	}))
	return ok, err
}

func (r *Repository) MarkAsyncDispatchFailurePending(
	ctx context.Context,
	dispatch domain.AsyncDispatch,
	errorCode string,
	errorMessage string,
	now time.Time,
) (domain.AsyncDispatch, bool, error) {
	id, err := persistenceid.Parse(dispatch.TaskRunID)
	if err != nil {
		return domain.AsyncDispatch{}, false, err
	}
	return claimedDispatch(r.db.Queries(ctx).FailTaskDispatch(ctx, sqlc.FailTaskDispatchParams{
		ID:               id.String(),
		Now:              now,
		Code:             errorCode,
		Message:          errorMessage,
		Version:          dispatch.DeliveryVersion,
		ExecutionVersion: dispatch.ExecutionVersion,
	}))
}

func (r *Repository) ClaimAsyncExecution(
	ctx context.Context,
	taskRunID string,
	executionToken string,
	now time.Time,
	leaseUntil time.Time,
) (domain.AsyncDispatch, bool, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return domain.AsyncDispatch{}, false, err
	}
	return claimedDispatch(r.db.Queries(ctx).StartTaskExecution(ctx, sqlc.StartTaskExecutionParams{
		ID:    id.String(),
		Now:   now,
		Token: executionToken,
		Lease: leaseUntil,
	}))
}

func (r *Repository) HeartbeatAsyncExecution(
	ctx context.Context,
	dispatch domain.AsyncDispatch,
	now time.Time,
	leaseUntil time.Time,
) (domain.AsyncDispatch, bool, error) {
	id, err := persistenceid.Parse(dispatch.TaskRunID)
	if err != nil {
		return domain.AsyncDispatch{}, false, err
	}
	return claimedDispatch(r.db.Queries(ctx).RenewTaskExecution(ctx, sqlc.RenewTaskExecutionParams{
		ID:      id.String(),
		Now:     now,
		Version: dispatch.ExecutionVersion,
		Token:   dispatch.ExecutionToken,
		Lease:   leaseUntil,
	}))
}

func (r *Repository) ReleaseAsyncExecution(
	ctx context.Context,
	dispatch domain.AsyncDispatch,
	nextDispatchAt time.Time,
	errorCode string,
	errorMessage string,
	now time.Time,
) (domain.AsyncDispatch, bool, error) {
	id, err := persistenceid.Parse(dispatch.TaskRunID)
	if err != nil {
		return domain.AsyncDispatch{}, false, err
	}
	return claimedDispatch(r.db.Queries(ctx).ReleaseTaskExecution(ctx, sqlc.ReleaseTaskExecutionParams{
		ID:      id.String(),
		Now:     now,
		Version: dispatch.ExecutionVersion,
		Token:   dispatch.ExecutionToken,
		Due:     nextDispatchAt,
		Code:    errorCode,
		Message: errorMessage,
	}))
}

func (r *Repository) AdvanceAsyncExecution(
	ctx context.Context,
	dispatch domain.AsyncDispatch,
	now time.Time,
) (domain.AsyncDispatch, bool, error) {
	id, err := persistenceid.Parse(dispatch.TaskRunID)
	if err != nil {
		return domain.AsyncDispatch{}, false, err
	}
	return claimedDispatch(r.db.Queries(ctx).AdvanceTaskExecution(ctx, sqlc.AdvanceTaskExecutionParams{
		ID:      id.String(),
		Now:     now,
		Version: dispatch.ExecutionVersion,
		Token:   dispatch.ExecutionToken,
	}))
}

func (r *Repository) RetryAsyncExecution(
	ctx context.Context,
	dispatch domain.AsyncDispatch,
	nextDispatchAt time.Time,
	errorCode string,
	errorMessage string,
	now time.Time,
) (domain.AsyncDispatch, bool, error) {
	id, err := persistenceid.Parse(dispatch.TaskRunID)
	if err != nil {
		return domain.AsyncDispatch{}, false, err
	}
	return claimedDispatch(r.db.Queries(ctx).ReleaseTaskExecution(ctx, sqlc.ReleaseTaskExecutionParams{
		ID:       id.String(),
		Now:      now,
		Version:  dispatch.ExecutionVersion,
		Token:    dispatch.ExecutionToken,
		Due:      nextDispatchAt,
		Code:     errorCode,
		Message:  errorMessage,
		Failures: 1,
	}))
}

func (r *Repository) CompleteAsyncExecution(ctx context.Context, dispatch domain.AsyncDispatch) (bool, error) {
	id, err := persistenceid.Parse(dispatch.TaskRunID)
	if err != nil {
		return false, err
	}
	return changed(r.db.Queries(ctx).FinishTaskExecution(ctx, sqlc.FinishTaskExecutionParams{
		ID:      id.String(),
		Version: dispatch.ExecutionVersion,
	}))
}

func (r *Repository) Get(ctx context.Context, scope app.Scope, runType domain.RunType, subjectType domain.SubjectType, subjectID, taskRunID string) (domain.TaskRun, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil || runType == "" || subjectType == "" || subjectID == "" {
		return domain.TaskRun{}, app.ErrNotFound
	}
	row, err := r.db.Queries(ctx).ReadVisibleTaskRun(ctx, sqlc.ReadVisibleTaskRunParams{
		ID:          id.String(),
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		RunType:     string(runType),
		SubjectType: string(subjectType),
		SubjectID:   subjectID,
	})
	if err != nil {
		return domain.TaskRun{}, readErr(err)
	}
	return fromRow(row), nil
}

// GetTaskRun is used only after the scheduler has successfully claimed
// a schedule. Request-scope authorization belongs to HTTP-facing Get methods.
func (r *Repository) GetTaskRun(ctx context.Context, taskRunID string) (domain.TaskRun, error) {
	return r.getTaskRun(ctx, taskRunID, false)
}

func (r *Repository) BatchGetTaskRuns(ctx context.Context, scope app.Scope, taskRunIDs []string) ([]domain.TaskRun, error) {
	return r.batchGetTaskRuns(ctx, scope, taskRunIDs, true)
}

func (r *Repository) ListTaskRunsByRoot(ctx context.Context, scope app.Scope, rootTaskRunID string) ([]domain.TaskRun, error) {
	id, err := persistenceid.Parse(rootTaskRunID)
	if err != nil {
		return nil, app.ErrInvalidTaskHierarchy
	}
	return listTaskRuns(r.db.Queries(ctx).ListRootTaskRuns(ctx, sqlc.ListRootTaskRunsParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		RelatedID:   id.String(),
	}))
}

func (r *Repository) ListTaskRunsByParent(ctx context.Context, scope app.Scope, parentTaskRunID string) ([]domain.TaskRun, error) {
	id, err := persistenceid.Parse(parentTaskRunID)
	if err != nil {
		return nil, app.ErrInvalidTaskHierarchy
	}
	return listTaskRuns(r.db.Queries(ctx).ListChildTaskRuns(ctx, sqlc.ListChildTaskRunsParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		RelatedID:   id.String(),
	}))
}

func listTaskRuns(rows []sqlc.TaskRun, err error) ([]domain.TaskRun, error) {
	if err != nil {
		return nil, err
	}
	items := make([]domain.TaskRun, 0, len(rows))
	for _, row := range rows {
		items = append(items, fromRow(row))
	}
	return items, nil
}

func (r *Repository) BatchGetScopedTaskRuns(ctx context.Context, scope app.Scope, taskRunIDs []string) ([]domain.TaskRun, error) {
	return r.batchGetTaskRuns(ctx, scope, taskRunIDs, false)
}

func (r *Repository) BatchGetLatestTaskRunsBySubjects(ctx context.Context, scope app.Scope, subjects []app.TaskRunSubject) ([]domain.TaskRun, error) {
	unique := make([]app.TaskRunSubject, 0, len(subjects))
	args := sqlc.ReadLatestTaskSubjectsParams{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}
	seen := make(map[app.TaskRunSubject]struct{}, len(subjects))
	for _, subject := range subjects {
		if subject.RunType == "" || subject.SubjectType == "" || strings.TrimSpace(subject.SubjectID) == "" {
			continue
		}
		if _, duplicate := seen[subject]; duplicate {
			continue
		}
		seen[subject] = struct{}{}
		unique = append(unique, subject)
		args.RunTypes = append(args.RunTypes, string(subject.RunType))
		args.SubjectTypes = append(args.SubjectTypes, string(subject.SubjectType))
		args.SubjectIds = append(args.SubjectIds, subject.SubjectID)
	}
	if len(unique) == 0 {
		return []domain.TaskRun{}, nil
	}
	rows, err := r.db.Queries(ctx).ReadLatestTaskSubjects(ctx, args)
	if err != nil {
		return nil, err
	}
	bySubject := make(map[app.TaskRunSubject]domain.TaskRun, len(rows))
	for _, row := range rows {
		run := fromRow(row)
		bySubject[app.TaskRunSubject{RunType: run.RunType, SubjectType: run.SubjectType, SubjectID: run.SubjectID}] = run
	}
	items := make([]domain.TaskRun, 0, len(rows))
	for _, subject := range unique {
		if run, ok := bySubject[subject]; ok {
			items = append(items, run)
		}
	}
	return items, nil
}

func (r *Repository) batchGetTaskRuns(ctx context.Context, scope app.Scope, taskRunIDs []string, visibleOnly bool) ([]domain.TaskRun, error) {
	ids := persistenceid.ParseValid(taskRunIDs)
	if len(ids) == 0 {
		return []domain.TaskRun{}, nil
	}
	args := sqlc.ReadTaskRunsByIDsParams{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, VisibleOnly: visibleOnly}
	for _, id := range ids {
		args.Ids = append(args.Ids, id.String())
	}
	rows, err := r.db.Queries(ctx).ReadTaskRunsByIDs(ctx, args)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]domain.TaskRun, len(rows))
	for _, row := range rows {
		item := fromRow(row)
		byID[item.ID] = item
	}
	items := make([]domain.TaskRun, 0, len(rows))
	seen := make(map[string]struct{}, len(taskRunIDs))
	for _, id := range taskRunIDs {
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		if item, ok := byID[id]; ok {
			items = append(items, item)
		}
	}
	return items, nil
}

func (r *Repository) GetTaskRunForUpdate(ctx context.Context, taskRunID string) (domain.TaskRun, error) {
	return r.getTaskRun(ctx, taskRunID, true)
}

func (r *Repository) getTaskRun(ctx context.Context, taskRunID string, lock bool) (domain.TaskRun, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return domain.TaskRun{}, app.ErrNotFound
	}
	get := r.db.Queries(ctx).ReadTaskRun
	if lock {
		get = r.db.Queries(ctx).LockTaskRun
	}
	row, err := get(ctx, id.String())
	if err != nil {
		return domain.TaskRun{}, readErr(err)
	}
	return fromRow(row), nil
}

func (r *Repository) UpdateTaskRun(ctx context.Context, run domain.TaskRun, update app.TaskRunUpdate, now time.Time) (bool, error) {
	if !run.Status.CanTransitionTo(update.Status) {
		return false, domain.ErrInvalidTaskTransition
	}
	id, err := persistenceid.Parse(run.ID)
	if err != nil {
		return false, err
	}
	var updated bool
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		if update.Status == domain.StatusWaitingSubtasks || update.Status == domain.StatusPartialSuccess {
			children, err := q.HasTaskChildren(ctx, ptr(id.String()))
			if err != nil {
				return err
			}
			if !children {
				return domain.ErrInvalidTaskTransition
			}
		}
		var err error
		updated, err = changed(q.ChangeTaskRun(ctx, sqlc.ChangeTaskRunParams{
			ID:           id.String(),
			StateVersion: run.StateVersion,
			UpdatedAt:    now,
			Status:       string(update.Status),
			ErrorCode:    update.ErrorCode,
			ErrorMessage: update.ErrorMessage,
			StartedAt:    update.StartedAt,
			FinishedAt:   update.FinishedAt,
		}))
		return err
	})
	return updated, err
}

func (r *Repository) HideTaskRunsBySubjects(
	ctx context.Context,
	scope app.Scope,
	runType domain.RunType,
	subjectType domain.SubjectType,
	subjectIDs []string,
	hiddenAt time.Time,
) error {
	if strings.TrimSpace(scope.TenantID) == "" || runType == "" || subjectType == "" || hiddenAt.IsZero() {
		return errors.New("invalid task run visibility update")
	}
	ids := make([]string, 0, len(subjectIDs))
	seen := make(map[string]struct{}, len(subjectIDs))
	for _, raw := range subjectIDs {
		id := strings.TrimSpace(raw)
		if id == "" {
			return errors.New("invalid task run subject")
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		return r.db.Queries(ctx).HideTaskRuns(ctx, sqlc.HideTaskRunsParams{
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			RunType:     string(runType),
			SubjectType: string(subjectType),
			SubjectIds:  ids,
			Now:         hiddenAt,
		})
	})
}

func changed(n int64, err error) (bool, error) { return n == 1, err }
func claimedDispatch(row sqlc.AsyncDispatch, err error) (domain.AsyncDispatch, bool, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.AsyncDispatch{}, false, nil
	}
	if err != nil {
		return domain.AsyncDispatch{}, false, err
	}
	return asyncDispatchFromRow(row), true, nil
}
func ptr[T any](value T) *T { return &value }
func convertTerminalSlot[T, U ~int8 | ~int16](v *T) *U {
	if v == nil {
		return nil
	}
	return ptr(U(*v))
}
func readErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ErrNotFound
	}
	return err
}

func toRow(run domain.TaskRun) (sqlc.TaskRun, error) {
	id, err := persistenceid.Parse(run.ID)
	if err != nil || run.Validate() != nil {
		return sqlc.TaskRun{}, errors.New("invalid task run")
	}
	rootTaskID, err := parseOptionalTaskRunID(run.RootTaskID)
	if err != nil {
		return sqlc.TaskRun{}, errors.New("invalid task run")
	}
	parentTaskID, err := parseOptionalTaskRunIDPointer(run.ParentTaskID)
	if err != nil {
		return sqlc.TaskRun{}, errors.New("invalid task run")
	}
	return sqlc.TaskRun{
		ID: id.String(), TenantID: run.TenantID, WorkspaceID: run.WorkspaceID,
		RootTaskID: rootTaskID, ParentTaskID: parentTaskID,
		CreatedBy: run.CreatedBy, RunType: string(run.RunType),
		SubjectType: string(run.SubjectType), SubjectID: run.SubjectID,
		IsInternal: run.IsInternal, HiddenAt: run.HiddenAt,
		Status: string(run.Status), ErrorCode: run.ErrorCode, ErrorMessage: run.ErrorMessage,
		StateVersion: run.StateVersion, StartedAt: run.StartedAt, FinishedAt: run.FinishedAt,
		CreatedAt: run.CreatedAt, UpdatedAt: run.UpdatedAt,
	}, nil
}

func fromRow(row sqlc.TaskRun) domain.TaskRun {
	run := domain.TaskRun{
		ID: row.ID, TenantID: row.TenantID, WorkspaceID: row.WorkspaceID,
		RootTaskID: optionalTaskRunID(row.RootTaskID), ParentTaskID: row.ParentTaskID,
		CreatedBy: row.CreatedBy, RunType: domain.RunType(row.RunType),
		SubjectType: domain.SubjectType(row.SubjectType), SubjectID: row.SubjectID,
		IsInternal: row.IsInternal, HiddenAt: row.HiddenAt,
		Status: domain.Status(row.Status), ErrorCode: row.ErrorCode, ErrorMessage: row.ErrorMessage,
		StateVersion: row.StateVersion, StartedAt: row.StartedAt, FinishedAt: row.FinishedAt,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
	return run
}

func parseOptionalTaskRunID(value string) (*string, error) {
	if value == "" {
		return nil, nil
	}
	id, err := persistenceid.Parse(value)
	if err != nil {
		return nil, err
	}
	return ptr(id.String()), nil
}

func parseOptionalTaskRunIDPointer(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	return parseOptionalTaskRunID(*value)
}

func optionalTaskRunID(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func sameWorkspace(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func pollScheduleToRow(schedule domain.PollSchedule) (sqlc.InsertPollScheduleParams, error) {
	id, err := persistenceid.Parse(schedule.TaskRunID)
	if err != nil || schedule.NextPollAt.IsZero() || schedule.DeadlineAt.IsZero() {
		return sqlc.InsertPollScheduleParams{}, errors.New("invalid poll schedule")
	}
	return sqlc.InsertPollScheduleParams{
		TaskRunID: id.String(), NextPollAt: schedule.NextPollAt,
		LeaseUntil: schedule.LeaseUntil, StateVersion: schedule.StateVersion,
		PollAttempts: schedule.PollAttempts, ConsecutiveErrors: schedule.ConsecutiveErrors,
		DeadlineAt: schedule.DeadlineAt, CreatedAt: schedule.CreatedAt, UpdatedAt: schedule.UpdatedAt,
	}, nil
}

func pollScheduleFromRow(row sqlc.ClaimPollSchedulesRow) domain.PollSchedule {
	return domain.PollSchedule{
		TaskRunID:  row.TaskRunID,
		NextPollAt: row.NextPollAt, LeaseUntil: row.LeaseUntil, StateVersion: row.StateVersion,
		PollAttempts: row.PollAttempts, ConsecutiveErrors: row.ConsecutiveErrors,
		DeadlineAt: row.DeadlineAt, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func asyncDispatchToRow(dispatch domain.AsyncDispatch) (sqlc.AsyncDispatch, error) {
	id, err := persistenceid.Parse(dispatch.TaskRunID)
	if err != nil || dispatch.Validate() != nil {
		return sqlc.AsyncDispatch{}, errors.New("invalid async dispatch")
	}
	return sqlc.AsyncDispatch{
		TaskRunID:           id.String(),
		RunType:             string(dispatch.RunType),
		DeliveryState:       string(dispatch.DeliveryState),
		ExecutionState:      string(dispatch.ExecutionState),
		NextDispatchAt:      dispatch.NextDispatchAt,
		PublishLeaseUntil:   dispatch.PublishLeaseUntil,
		ExecutionLeaseUntil: dispatch.ExecutionLeaseUntil,
		ExecutionToken:      dispatch.ExecutionToken,
		DeliveryVersion:     dispatch.DeliveryVersion,
		ExecutionVersion:    dispatch.ExecutionVersion,
		PublishAttempts:     dispatch.PublishAttempts,
		ExecutionAttempts:   dispatch.ExecutionAttempts,
		ExecutionFailures:   dispatch.ExecutionFailures,
		LeaseRecoveries:     dispatch.LeaseRecoveries,
		FirstStartedAt:      dispatch.FirstStartedAt,
		LastErrorCode:       dispatch.LastErrorCode,
		LastErrorMessage:    dispatch.LastErrorMessage,
		CreatedAt:           dispatch.CreatedAt,
		UpdatedAt:           dispatch.UpdatedAt,
	}, nil
}

func asyncDispatchFromRow(row sqlc.AsyncDispatch) domain.AsyncDispatch {
	return domain.AsyncDispatch{
		TaskRunID:           row.TaskRunID,
		RunType:             domain.RunType(row.RunType),
		DeliveryState:       domain.AsyncDeliveryState(row.DeliveryState),
		ExecutionState:      domain.AsyncExecutionState(row.ExecutionState),
		NextDispatchAt:      row.NextDispatchAt,
		PublishLeaseUntil:   row.PublishLeaseUntil,
		ExecutionLeaseUntil: row.ExecutionLeaseUntil,
		ExecutionToken:      row.ExecutionToken,
		DeliveryVersion:     row.DeliveryVersion,
		ExecutionVersion:    row.ExecutionVersion,
		PublishAttempts:     row.PublishAttempts,
		ExecutionAttempts:   row.ExecutionAttempts,
		ExecutionFailures:   row.ExecutionFailures,
		LeaseRecoveries:     row.LeaseRecoveries,
		FirstStartedAt:      row.FirstStartedAt,
		LastErrorCode:       row.LastErrorCode,
		LastErrorMessage:    row.LastErrorMessage,
		CreatedAt:           row.CreatedAt,
		UpdatedAt:           row.UpdatedAt,
	}
}

func asyncExecutionEventToRow(event asynccontract.Event) (sqlc.AsyncExecutionEvent, error) {
	if err := event.Validate(); err != nil {
		return sqlc.AsyncExecutionEvent{}, err
	}
	id, err := persistenceid.Parse(event.ID)
	if err != nil {
		return sqlc.AsyncExecutionEvent{}, err
	}
	taskRunID, err := persistenceid.Parse(event.TaskRunID)
	if err != nil {
		return sqlc.AsyncExecutionEvent{}, err
	}
	return sqlc.AsyncExecutionEvent{
		ID: id.String(), TaskRunID: taskRunID.String(), RunType: event.RunType,
		ExecutionToken: event.ExecutionToken, Sequence: event.Sequence,
		EventType: string(event.EventType), PayloadVersion: event.PayloadVersion,
		Payload: append([]byte(nil), event.Payload...), PayloadSha256: event.PayloadSHA256,
		TerminalSlot: convertTerminalSlot[int8, int16](event.TerminalSlot), ConsumeStatus: string(event.ConsumeStatus),
		NextConsumeAt: event.NextConsumeAt, ConsumeLeaseUntil: event.ConsumeLeaseUntil,
		ConsumeAttempts: event.ConsumeAttempts, StateVersion: event.StateVersion,
		LastErrorCode: event.LastErrorCode, LastErrorMessage: event.LastErrorMessage,
		CreatedAt: event.CreatedAt, UpdatedAt: event.UpdatedAt, ConsumedAt: event.ConsumedAt,
	}, nil
}

func asyncExecutionEventFromRow(row sqlc.AsyncExecutionEvent) asynccontract.Event {
	return asynccontract.Event{
		ID: row.ID, TaskRunID: row.TaskRunID, RunType: row.RunType,
		ExecutionToken: row.ExecutionToken, Sequence: row.Sequence,
		EventType: asynccontract.EventType(row.EventType), PayloadVersion: row.PayloadVersion,
		Payload: append([]byte(nil), row.Payload...), PayloadSHA256: row.PayloadSha256,
		TerminalSlot: convertTerminalSlot[int16, int8](row.TerminalSlot), ConsumeStatus: asynccontract.ConsumeStatus(row.ConsumeStatus),
		NextConsumeAt: row.NextConsumeAt, ConsumeLeaseUntil: row.ConsumeLeaseUntil,
		ConsumeAttempts: row.ConsumeAttempts, StateVersion: row.StateVersion,
		LastErrorCode: row.LastErrorCode, LastErrorMessage: row.LastErrorMessage,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, ConsumedAt: row.ConsumedAt,
	}
}
