package task

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	app "github.com/example/monorepo/canvas/internal/application/task"
	asynccontract "github.com/example/monorepo/canvas/internal/contract/asyncexecution"
	domain "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

const (
	asyncDeliveryClaimWindow          = 2 * time.Minute
	executionLeaseExpiredErrorCode    = "EXECUTION_LEASE_EXPIRED"
	executionLeaseExpiredErrorMessage = "asynchronous execution lease expired after maximum attempts"
)

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) dbFor(ctx context.Context) *gorm.DB {
	return persistencetransaction.DB(ctx, r.db)
}

func (r *Repository) Create(ctx context.Context, run domain.TaskRun) error {
	return r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		if run.ParentTaskID == nil {
			if run.RootTaskID == "" {
				run.RootTaskID = run.ID
			}
		} else {
			parentID, err := persistenceid.Parse(*run.ParentTaskID)
			if err != nil {
				return app.ErrInvalidTaskHierarchy
			}
			var parent taskRunRow
			if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", parentID).Take(&parent).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
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
		return tx.Create(&row).Error
	})
}

func (r *Repository) CreatePollSchedule(ctx context.Context, schedule domain.PollSchedule) error {
	row, err := pollScheduleToRow(schedule)
	if err != nil {
		return err
	}
	db := r.dbFor(ctx)
	var run taskRunRow
	if err = db.Select("run_type").Where("id = ?", row.TaskRunID).Take(&run).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return app.ErrNotFound
		}
		return err
	}
	backend, ok := app.ExecutionBackendForRunType(domain.RunType(run.RunType))
	if !ok || backend != app.ExecutionBackendLocalScheduled {
		return app.ErrExecutionBackendMismatch
	}
	return db.Create(&row).Error
}

func (r *Repository) ClaimDuePollSchedules(ctx context.Context, runType domain.RunType, now, leaseUntil time.Time, limit int) ([]domain.PollSchedule, error) {
	if limit <= 0 {
		return nil, nil
	}
	db := r.dbFor(ctx)
	var candidates []pollScheduleRow
	query := db.Where(
		"next_poll_at <= ? AND (lease_until IS NULL OR lease_until <= ?)", now, now,
	).Where("EXISTS (SELECT 1 FROM task_runs WHERE task_runs.id = poll_schedules.task_run_id AND task_runs.run_type = ? AND task_runs.hidden_at IS NULL)", runType)
	if err := query.Order("next_poll_at ASC").Order("task_run_id ASC").Limit(limit).Find(&candidates).Error; err != nil {
		return nil, err
	}
	claimed := make([]domain.PollSchedule, 0, len(candidates))
	for index := range candidates {
		row := candidates[index]
		result := db.Model(&pollScheduleRow{}).Where(
			"task_run_id = ? AND state_version = ? AND next_poll_at <= ? AND (lease_until IS NULL OR lease_until <= ?)",
			row.TaskRunID, row.StateVersion, now, now,
		).Where("EXISTS (SELECT 1 FROM task_runs WHERE task_runs.id = poll_schedules.task_run_id AND task_runs.run_type = ? AND task_runs.hidden_at IS NULL)", runType).Updates(map[string]any{
			"lease_until":   leaseUntil,
			"state_version": row.StateVersion + 1,
			"updated_at":    now,
		})
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected != 1 {
			continue
		}
		row.LeaseUntil = &leaseUntil
		row.StateVersion++
		row.UpdatedAt = now
		claimed = append(claimed, pollScheduleFromRow(row))
	}
	return claimed, nil
}

func (r *Repository) RenewPollSchedule(ctx context.Context, schedule domain.PollSchedule, now, leaseUntil time.Time) (bool, error) {
	id, err := persistenceid.Parse(schedule.TaskRunID)
	if err != nil {
		return false, err
	}
	result := r.dbFor(ctx).Model(&pollScheduleRow{}).Where(
		"task_run_id = ? AND state_version = ? AND lease_until > ?", id, schedule.StateVersion, now,
	).Updates(map[string]any{"lease_until": leaseUntil, "updated_at": now})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) ReschedulePoll(ctx context.Context, schedule domain.PollSchedule, update domain.PollScheduleUpdate, now time.Time) (bool, error) {
	id, err := persistenceid.Parse(schedule.TaskRunID)
	if err != nil {
		return false, err
	}
	result := r.dbFor(ctx).Model(&pollScheduleRow{}).Where(
		"task_run_id = ? AND state_version = ?", id, schedule.StateVersion,
	)
	updates := map[string]any{
		"next_poll_at":       update.NextPollAt,
		"lease_until":        nil,
		"poll_attempts":      update.PollAttempts,
		"consecutive_errors": update.ConsecutiveErrors,
		"state_version":      schedule.StateVersion + 1,
		"updated_at":         now,
	}
	if update.DeadlineAt != nil {
		updates["deadline_at"] = *update.DeadlineAt
	}
	result = result.Updates(updates)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *Repository) CompletePollSchedule(ctx context.Context, schedule domain.PollSchedule) (bool, error) {
	id, err := persistenceid.Parse(schedule.TaskRunID)
	if err != nil {
		return false, err
	}
	result := r.dbFor(ctx).Where(
		"task_run_id = ? AND state_version = ?", id, schedule.StateVersion,
	).Delete(&pollScheduleRow{})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *Repository) DeletePollSchedule(ctx context.Context, taskRunID string) error {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return err
	}
	return r.dbFor(ctx).Where("task_run_id = ?", id).Delete(&pollScheduleRow{}).Error
}

func (r *Repository) CreateAsyncDispatch(ctx context.Context, dispatch domain.AsyncDispatch) error {
	row, err := asyncDispatchToRow(dispatch)
	if err != nil {
		return err
	}
	return r.dbFor(ctx).Create(&row).Error
}

func (r *Repository) DeleteAsyncDispatch(ctx context.Context, taskRunID string) error {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	return r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		if err = tx.Model(&asyncExecutionEventRow{}).Where(
			"task_run_id = ? AND consume_status IN ?",
			id,
			[]asynccontract.ConsumeStatus{
				asynccontract.ConsumeStatusPending,
				asynccontract.ConsumeStatusConsuming,
			},
		).Updates(map[string]any{
			"consume_status":      asynccontract.ConsumeStatusDiscarded,
			"consume_lease_until": nil,
			"consumed_at":         now,
			"updated_at":          now,
			"state_version":       gorm.Expr("state_version + 1"),
		}).Error; err != nil {
			return err
		}
		return tx.Where("task_run_id = ?", id).Delete(&asyncDispatchRow{}).Error
	})
}

func (r *Repository) CreateAsyncExecutionEvent(ctx context.Context, event asynccontract.Event) error {
	row, err := asyncExecutionEventToRow(event)
	if err != nil {
		return err
	}
	return r.dbFor(ctx).Create(&row).Error
}

func (r *Repository) GetAsyncExecutionEvent(ctx context.Context, eventID string) (asynccontract.Event, error) {
	id, err := persistenceid.Parse(eventID)
	if err != nil {
		return asynccontract.Event{}, err
	}
	var row asyncExecutionEventRow
	if err = r.dbFor(ctx).Where("id = ?", id).First(&row).Error; err != nil {
		return asynccontract.Event{}, err
	}
	return asyncExecutionEventFromRow(row), nil
}

func (r *Repository) HasUnfinishedAsyncExecutionEventBefore(
	ctx context.Context,
	executionToken string,
	sequence int32,
) (bool, error) {
	var count int64
	err := r.dbFor(ctx).Model(&asyncExecutionEventRow{}).Where(
		"execution_token = ? AND sequence < ? AND consume_status NOT IN ?",
		executionToken,
		sequence,
		[]asynccontract.ConsumeStatus{
			asynccontract.ConsumeStatusConsumed,
			asynccontract.ConsumeStatusDiscarded,
		},
	).Limit(1).Count(&count).Error
	return count > 0, err
}

func (r *Repository) GetAsyncDispatch(ctx context.Context, taskRunID string) (domain.AsyncDispatch, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return domain.AsyncDispatch{}, err
	}
	var row asyncDispatchRow
	if err = r.dbFor(ctx).Where("task_run_id = ?", id).First(&row).Error; err != nil {
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
	db := r.dbFor(ctx)
	var candidates []asyncExecutionEventRow
	if err := db.Where(
		"(consume_status = ? AND next_consume_at <= ?) OR "+
			"(consume_status = ? AND consume_lease_until <= ?)",
		asynccontract.ConsumeStatusPending,
		now,
		asynccontract.ConsumeStatusConsuming,
		now,
	).Order("next_consume_at ASC").Order("id ASC").Limit(limit).Find(&candidates).Error; err != nil {
		return nil, err
	}
	claimed := make([]asynccontract.Event, 0, len(candidates))
	for index := range candidates {
		row := candidates[index]
		where := db.Model(&asyncExecutionEventRow{}).Where(
			"id = ? AND state_version = ? AND consume_status = ?",
			row.ID,
			row.StateVersion,
			row.ConsumeStatus,
		)
		if asynccontract.ConsumeStatus(row.ConsumeStatus) == asynccontract.ConsumeStatusPending {
			where = where.Where("next_consume_at <= ?", now)
		} else {
			where = where.Where("consume_lease_until <= ?", now)
		}
		result := where.Updates(map[string]any{
			"consume_status":      asynccontract.ConsumeStatusConsuming,
			"consume_lease_until": leaseUntil,
			"consume_attempts":    row.ConsumeAttempts + 1,
			"state_version":       row.StateVersion + 1,
			"updated_at":          now,
		})
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected != 1 {
			continue
		}
		row.ConsumeStatus = string(asynccontract.ConsumeStatusConsuming)
		row.ConsumeLeaseUntil = &leaseUntil
		row.ConsumeAttempts++
		row.StateVersion++
		row.UpdatedAt = now
		claimed = append(claimed, asyncExecutionEventFromRow(row))
	}
	return claimed, nil
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
	result := r.dbFor(ctx).Model(&asyncExecutionEventRow{}).Where(
		"id = ? AND state_version = ? AND consume_status = ?",
		id,
		event.StateVersion,
		asynccontract.ConsumeStatusConsuming,
	).Updates(map[string]any{
		"consume_status":      status,
		"consume_lease_until": nil,
		"state_version":       event.StateVersion + 1,
		"updated_at":          now,
		"consumed_at":         now,
	})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
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
	result := r.dbFor(ctx).Model(&asyncExecutionEventRow{}).Where(
		"id = ? AND state_version = ? AND consume_status = ?",
		id,
		event.StateVersion,
		asynccontract.ConsumeStatusConsuming,
	).Updates(map[string]any{
		"consume_status":      asynccontract.ConsumeStatusPending,
		"next_consume_at":     nextConsumeAt,
		"consume_lease_until": nil,
		"state_version":       event.StateVersion + 1,
		"last_error_code":     errorCode,
		"last_error_message":  errorMessage,
		"updated_at":          now,
		"consumed_at":         nil,
	})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
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
	db := r.dbFor(ctx)
	var candidates []asyncDispatchRow
	if err := db.Where(
		"(execution_state = ? AND next_dispatch_at <= ? AND (publish_lease_until IS NULL OR publish_lease_until <= ?)) OR "+
			"(execution_state = ? AND next_dispatch_at <= ? AND (execution_lease_until IS NULL OR execution_lease_until <= ?)) OR "+
			"(execution_state = ? AND execution_lease_until <= ?)",
		domain.AsyncExecutionWaiting,
		now,
		now,
		domain.AsyncExecutionFailurePending,
		now,
		now,
		domain.AsyncExecutionExecuting,
		now,
	).Order("next_dispatch_at ASC").Order("task_run_id ASC").Limit(limit).Find(&candidates).Error; err != nil {
		return nil, err
	}
	claimed := make([]domain.AsyncDispatch, 0, len(candidates))
	for index := range candidates {
		row := candidates[index]
		if domain.AsyncExecutionState(row.ExecutionState) == domain.AsyncExecutionExecuting {
			recovered, ok, recoverErr := r.recoverExpiredAsyncExecution(db, row, now, leaseUntil)
			if recoverErr != nil {
				return nil, recoverErr
			}
			if ok {
				claimed = append(claimed, recovered)
			}
			continue
		}
		failurePending := domain.AsyncExecutionState(row.ExecutionState) == domain.AsyncExecutionFailurePending
		where := db.Model(&asyncDispatchRow{}).Where("task_run_id = ?", row.TaskRunID)
		updates := map[string]any{"updated_at": now}
		if failurePending {
			where = where.Where(
				"execution_version = ? AND execution_state = ? AND next_dispatch_at <= ? "+
					"AND (execution_lease_until IS NULL OR execution_lease_until <= ?)",
				row.ExecutionVersion, row.ExecutionState, now, now,
			)
			updates["execution_lease_until"] = leaseUntil
			updates["execution_version"] = row.ExecutionVersion + 1
		} else {
			where = where.Where(
				"delivery_version = ? AND execution_state = ? AND next_dispatch_at <= ? "+
					"AND (publish_lease_until IS NULL OR publish_lease_until <= ?)",
				row.DeliveryVersion, domain.AsyncExecutionWaiting, now, now,
			)
			updates["publish_lease_until"] = leaseUntil
			updates["delivery_version"] = row.DeliveryVersion + 1
		}
		result := where.Updates(updates)
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected != 1 {
			continue
		}
		if failurePending {
			row.ExecutionLeaseUntil = &leaseUntil
			row.ExecutionVersion++
		} else {
			row.PublishLeaseUntil = &leaseUntil
			row.DeliveryVersion++
		}
		row.UpdatedAt = now
		claimed = append(claimed, asyncDispatchFromRow(row))
	}
	return claimed, nil
}

func (r *Repository) recoverExpiredAsyncExecution(
	db *gorm.DB,
	candidate asyncDispatchRow,
	now time.Time,
	publishLeaseUntil time.Time,
) (domain.AsyncDispatch, bool, error) {
	var recovered domain.AsyncDispatch
	var claimed bool
	err := db.Transaction(func(tx *gorm.DB) error {
		var row asyncDispatchRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"task_run_id = ? AND execution_version = ? AND execution_state = ? AND execution_lease_until <= ?",
			candidate.TaskRunID,
			candidate.ExecutionVersion,
			domain.AsyncExecutionExecuting,
			now,
		).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		var terminal asyncExecutionEventRow
		terminalErr := tx.Where(
			"execution_token = ? AND terminal_slot = ?",
			row.ExecutionToken,
			1,
		).First(&terminal).Error
		switch {
		case terminalErr == nil &&
			(asynccontract.ConsumeStatus(terminal.ConsumeStatus) == asynccontract.ConsumeStatusConsumed ||
				asynccontract.ConsumeStatus(terminal.ConsumeStatus) == asynccontract.ConsumeStatusDiscarded):
			return tx.Where(
				"task_run_id = ? AND execution_version = ? AND execution_state = ?",
				row.TaskRunID,
				row.ExecutionVersion,
				domain.AsyncExecutionExecuting,
			).Delete(&asyncDispatchRow{}).Error
		case terminalErr == nil:
			return tx.Model(&asyncExecutionEventRow{}).Where(
				"id = ? AND consume_status = ?",
				terminal.ID,
				asynccontract.ConsumeStatusPending,
			).Updates(map[string]any{
				"next_consume_at": now,
				"updated_at":      now,
			}).Error
		case !errors.Is(terminalErr, gorm.ErrRecordNotFound):
			return terminalErr
		}
		var unfinishedEvents int64
		if err := tx.Model(&asyncExecutionEventRow{}).Where(
			"execution_token = ? AND consume_status IN ?",
			row.ExecutionToken,
			[]asynccontract.ConsumeStatus{
				asynccontract.ConsumeStatusPending,
				asynccontract.ConsumeStatusConsuming,
			},
		).Count(&unfinishedEvents).Error; err != nil {
			return err
		}
		if unfinishedEvents > 0 {
			return tx.Model(&asyncExecutionEventRow{}).Where(
				"execution_token = ? AND consume_status = ?",
				row.ExecutionToken,
				asynccontract.ConsumeStatusPending,
			).Updates(map[string]any{
				"next_consume_at": now,
				"updated_at":      now,
			}).Error
		}
		recoveries := row.LeaseRecoveries + 1
		recoveryExpired := recoveries >= 10 ||
			asyncDispatchFromRow(row).RecoveryExpired(now)
		updates := map[string]any{
			"delivery_state":        domain.AsyncDeliveryPending,
			"publish_lease_until":   publishLeaseUntil,
			"delivery_version":      row.DeliveryVersion + 1,
			"execution_state":       domain.AsyncExecutionWaiting,
			"execution_lease_until": nil,
			"execution_token":       "",
			"lease_recoveries":      recoveries,
			"execution_version":     row.ExecutionVersion + 1,
			"updated_at":            now,
		}
		if recoveryExpired {
			updates["execution_state"] = domain.AsyncExecutionFailurePending
			updates["execution_lease_until"] = publishLeaseUntil
			updates["publish_lease_until"] = nil
			updates["last_error_code"] = executionLeaseExpiredErrorCode
			updates["last_error_message"] = executionLeaseExpiredErrorMessage
		}
		result := tx.Model(&asyncDispatchRow{}).Where(
			"task_run_id = ? AND execution_version = ? AND execution_state = ?",
			row.TaskRunID,
			row.ExecutionVersion,
			domain.AsyncExecutionExecuting,
		).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return nil
		}
		row.DeliveryState = string(domain.AsyncDeliveryPending)
		row.ExecutionState = string(domain.AsyncExecutionWaiting)
		row.PublishLeaseUntil = &publishLeaseUntil
		row.ExecutionLeaseUntil = nil
		row.ExecutionToken = ""
		row.LeaseRecoveries = recoveries
		row.DeliveryVersion++
		row.ExecutionVersion++
		row.UpdatedAt = now
		if recoveryExpired {
			row.ExecutionState = string(domain.AsyncExecutionFailurePending)
			row.ExecutionLeaseUntil = &publishLeaseUntil
			row.PublishLeaseUntil = nil
			row.LastErrorCode = executionLeaseExpiredErrorCode
			row.LastErrorMessage = executionLeaseExpiredErrorMessage
		}
		recovered = asyncDispatchFromRow(row)
		claimed = true
		return nil
	})
	return recovered, claimed, err
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
	result := r.dbFor(ctx).Model(&asyncDispatchRow{}).Where(
		"task_run_id = ? AND delivery_version = ?",
		id, dispatch.DeliveryVersion,
	).Updates(map[string]any{
		"next_dispatch_at":    nextDispatchAt,
		"publish_lease_until": nil,
		"publish_attempts":    dispatch.PublishAttempts + 1,
		"last_error_code":     errorCode,
		"last_error_message":  errorMessage,
		"delivery_version":    dispatch.DeliveryVersion + 1,
		"updated_at":          now,
	})
	if result.Error != nil {
		return domain.AsyncDispatch{}, false, result.Error
	}
	if result.RowsAffected != 1 {
		return domain.AsyncDispatch{}, false, nil
	}
	dispatch.NextDispatchAt = nextDispatchAt
	dispatch.PublishLeaseUntil = nil
	dispatch.PublishAttempts++
	dispatch.LastErrorCode = errorCode
	dispatch.LastErrorMessage = errorMessage
	dispatch.DeliveryVersion++
	dispatch.UpdatedAt = now
	return dispatch, true, nil
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
	result := r.dbFor(ctx).Model(&asyncDispatchRow{}).Where(
		"task_run_id = ? AND delivery_version = ?", id, dispatch.DeliveryVersion,
	)
	result = result.Updates(map[string]any{
		"delivery_state":      domain.AsyncDeliveryDelivered,
		"next_dispatch_at":    now.Add(asyncDeliveryClaimWindow),
		"publish_lease_until": nil,
		"publish_attempts":    dispatch.PublishAttempts + 1,
		"delivery_version":    dispatch.DeliveryVersion + 1,
		"updated_at":          now,
	})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
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
	result := r.dbFor(ctx).Model(&asyncDispatchRow{}).Where(
		"task_run_id = ? AND delivery_version = ? AND execution_version = ? AND execution_state = ?",
		id, dispatch.DeliveryVersion, dispatch.ExecutionVersion, domain.AsyncExecutionWaiting,
	).Updates(map[string]any{
		"execution_state":       domain.AsyncExecutionFailurePending,
		"execution_lease_until": dispatch.PublishLeaseUntil,
		"publish_lease_until":   nil,
		"last_error_code":       errorCode,
		"last_error_message":    errorMessage,
		"delivery_version":      gorm.Expr("delivery_version + 1"),
		"execution_version":     dispatch.ExecutionVersion + 1,
		"updated_at":            now,
	})
	if result.Error != nil {
		return domain.AsyncDispatch{}, false, result.Error
	}
	if result.RowsAffected != 1 {
		return domain.AsyncDispatch{}, false, nil
	}
	dispatch.ExecutionState = domain.AsyncExecutionFailurePending
	dispatch.ExecutionLeaseUntil = dispatch.PublishLeaseUntil
	dispatch.PublishLeaseUntil = nil
	dispatch.LastErrorCode = errorCode
	dispatch.LastErrorMessage = errorMessage
	dispatch.DeliveryVersion++
	dispatch.ExecutionVersion++
	dispatch.UpdatedAt = now
	return dispatch, true, nil
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
	db := r.dbFor(ctx)
	updates := map[string]any{
		"execution_state":       domain.AsyncExecutionExecuting,
		"execution_lease_until": leaseUntil,
		"execution_attempts":    gorm.Expr("execution_attempts + 1"),
		"execution_token":       executionToken,
		"execution_version":     gorm.Expr("execution_version + 1"),
		"first_started_at":      gorm.Expr("COALESCE(first_started_at, ?)", now),
		"updated_at":            now,
	}
	result := db.Model(&asyncDispatchRow{}).Where(
		"task_run_id = ? AND execution_state = ? AND "+
			"(delivery_state = ? OR publish_lease_until > ?)",
		id, domain.AsyncExecutionWaiting, domain.AsyncDeliveryDelivered, now,
	).Updates(updates)
	if result.Error != nil {
		return domain.AsyncDispatch{}, false, result.Error
	}
	if result.RowsAffected != 1 {
		return domain.AsyncDispatch{}, false, nil
	}
	var row asyncDispatchRow
	if err = db.Where("task_run_id = ?", id).First(&row).Error; err != nil {
		return domain.AsyncDispatch{}, false, readErr(err)
	}
	return asyncDispatchFromRow(row), true, nil
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
	result := r.dbFor(ctx).Model(&asyncDispatchRow{}).Where(
		"task_run_id = ? AND execution_version = ? AND execution_state = ? AND execution_token = ?",
		id, dispatch.ExecutionVersion, domain.AsyncExecutionExecuting, dispatch.ExecutionToken,
	).Updates(map[string]any{
		"execution_lease_until": leaseUntil,
		"execution_version":     dispatch.ExecutionVersion + 1,
		"updated_at":            now,
	})
	if result.Error != nil {
		return domain.AsyncDispatch{}, false, result.Error
	}
	if result.RowsAffected != 1 {
		return domain.AsyncDispatch{}, false, nil
	}
	dispatch.ExecutionLeaseUntil = &leaseUntil
	dispatch.ExecutionVersion++
	dispatch.UpdatedAt = now
	return dispatch, true, nil
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
	result := r.dbFor(ctx).Model(&asyncDispatchRow{}).Where(
		"task_run_id = ? AND execution_version = ? AND execution_state = ? AND execution_token = ?",
		id, dispatch.ExecutionVersion, domain.AsyncExecutionExecuting, dispatch.ExecutionToken,
	).Updates(map[string]any{
		"delivery_state":        domain.AsyncDeliveryPending,
		"next_dispatch_at":      nextDispatchAt,
		"publish_lease_until":   nil,
		"delivery_version":      gorm.Expr("delivery_version + 1"),
		"execution_state":       domain.AsyncExecutionWaiting,
		"execution_lease_until": nil,
		"execution_token":       "",
		"last_error_code":       errorCode,
		"last_error_message":    errorMessage,
		"execution_version":     dispatch.ExecutionVersion + 1,
		"updated_at":            now,
	})
	if result.Error != nil {
		return domain.AsyncDispatch{}, false, result.Error
	}
	if result.RowsAffected != 1 {
		return domain.AsyncDispatch{}, false, nil
	}
	var row asyncDispatchRow
	if err = r.dbFor(ctx).Where("task_run_id = ?", id).First(&row).Error; err != nil {
		return domain.AsyncDispatch{}, false, readErr(err)
	}
	return asyncDispatchFromRow(row), true, nil
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
	result := r.dbFor(ctx).Model(&asyncDispatchRow{}).Where(
		"task_run_id = ? AND execution_version = ? AND execution_state = ? AND execution_token = ?",
		id, dispatch.ExecutionVersion, domain.AsyncExecutionExecuting, dispatch.ExecutionToken,
	).Updates(map[string]any{
		"execution_version": dispatch.ExecutionVersion + 1,
		"updated_at":        now,
	})
	if result.Error != nil {
		return domain.AsyncDispatch{}, false, result.Error
	}
	if result.RowsAffected != 1 {
		return domain.AsyncDispatch{}, false, nil
	}
	dispatch.ExecutionVersion++
	dispatch.UpdatedAt = now
	return dispatch, true, nil
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
	result := r.dbFor(ctx).Model(&asyncDispatchRow{}).Where(
		"task_run_id = ? AND execution_version = ? AND execution_state = ? AND execution_token = ?",
		id, dispatch.ExecutionVersion, domain.AsyncExecutionExecuting, dispatch.ExecutionToken,
	).Updates(map[string]any{
		"delivery_state":        domain.AsyncDeliveryPending,
		"next_dispatch_at":      nextDispatchAt,
		"publish_lease_until":   nil,
		"delivery_version":      gorm.Expr("delivery_version + 1"),
		"execution_state":       domain.AsyncExecutionWaiting,
		"execution_lease_until": nil,
		"execution_token":       "",
		"execution_failures":    dispatch.ExecutionFailures + 1,
		"last_error_code":       errorCode,
		"last_error_message":    errorMessage,
		"execution_version":     dispatch.ExecutionVersion + 1,
		"updated_at":            now,
	})
	if result.Error != nil {
		return domain.AsyncDispatch{}, false, result.Error
	}
	if result.RowsAffected != 1 {
		return domain.AsyncDispatch{}, false, nil
	}
	var row asyncDispatchRow
	if err = r.dbFor(ctx).Where("task_run_id = ?", id).First(&row).Error; err != nil {
		return domain.AsyncDispatch{}, false, readErr(err)
	}
	return asyncDispatchFromRow(row), true, nil
}

func (r *Repository) CompleteAsyncExecution(ctx context.Context, dispatch domain.AsyncDispatch) (bool, error) {
	id, err := persistenceid.Parse(dispatch.TaskRunID)
	if err != nil {
		return false, err
	}
	result := r.dbFor(ctx).Where(
		"task_run_id = ? AND execution_version = ? AND execution_state IN ?",
		id,
		dispatch.ExecutionVersion,
		[]string{string(domain.AsyncExecutionExecuting), string(domain.AsyncExecutionFailurePending)},
	).Delete(&asyncDispatchRow{})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *Repository) Get(ctx context.Context, scope app.Scope, runType domain.RunType, subjectType domain.SubjectType, subjectID, taskRunID string) (domain.TaskRun, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil || runType == "" || subjectType == "" || subjectID == "" {
		return domain.TaskRun{}, app.ErrNotFound
	}
	var row taskRunRow
	if err := visibleScopeQuery(r.dbFor(ctx), scope).Where(
		"id = ? AND run_type = ? AND subject_type = ? AND subject_id = ?",
		id, runType, subjectType, subjectID,
	).First(&row).Error; err != nil {
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
	return batchGetTaskRuns(visibleScopeQuery(r.dbFor(ctx), scope), taskRunIDs)
}

func (r *Repository) ListTaskRunsByRoot(ctx context.Context, scope app.Scope, rootTaskRunID string) ([]domain.TaskRun, error) {
	id, err := persistenceid.Parse(rootTaskRunID)
	if err != nil {
		return nil, app.ErrInvalidTaskHierarchy
	}
	return listTaskRuns(scopeQuery(r.dbFor(ctx), scope).Where(
		"root_task_id = ? OR (root_task_id IS NULL AND id = ?)", id, id,
	))
}

func (r *Repository) ListTaskRunsByParent(ctx context.Context, scope app.Scope, parentTaskRunID string) ([]domain.TaskRun, error) {
	id, err := persistenceid.Parse(parentTaskRunID)
	if err != nil {
		return nil, app.ErrInvalidTaskHierarchy
	}
	return listTaskRuns(scopeQuery(r.dbFor(ctx), scope).Where("parent_task_id = ?", id))
}

func listTaskRuns(query *gorm.DB) ([]domain.TaskRun, error) {
	var rows []taskRunRow
	if err := query.Order("created_at ASC").Order("id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	items := make([]domain.TaskRun, 0, len(rows))
	for _, row := range rows {
		items = append(items, fromRow(row))
	}
	return items, nil
}

func (r *Repository) BatchGetScopedTaskRuns(ctx context.Context, scope app.Scope, taskRunIDs []string) ([]domain.TaskRun, error) {
	return batchGetTaskRuns(scopeQuery(r.dbFor(ctx), scope), taskRunIDs)
}

func (r *Repository) BatchGetLatestTaskRunsBySubjects(ctx context.Context, scope app.Scope, subjects []app.TaskRunSubject) ([]domain.TaskRun, error) {
	unique := make([]app.TaskRunSubject, 0, len(subjects))
	tuples := make([][]any, 0, len(subjects))
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
		tuples = append(tuples, []any{subject.RunType, subject.SubjectType, subject.SubjectID})
	}
	if len(unique) == 0 {
		return []domain.TaskRun{}, nil
	}
	latestTimes := visibleScopeQuery(r.dbFor(ctx), scope).
		Select("tenant_id, workspace_id, run_type, subject_type, subject_id, MAX(created_at) AS latest_created_at").
		Where("(run_type, subject_type, subject_id) IN ?", tuples).
		Group("tenant_id, workspace_id, run_type, subject_type, subject_id")
	latestIDs := r.dbFor(ctx).Table("task_runs AS latest_candidate").
		Select("MAX(latest_candidate.id)").
		Joins(`JOIN (?) AS latest_time
  ON latest_time.tenant_id = latest_candidate.tenant_id
 AND (latest_time.workspace_id = latest_candidate.workspace_id OR (latest_time.workspace_id IS NULL AND latest_candidate.workspace_id IS NULL))
 AND latest_time.run_type = latest_candidate.run_type
 AND latest_time.subject_type = latest_candidate.subject_type
 AND latest_time.subject_id = latest_candidate.subject_id
 AND latest_time.latest_created_at = latest_candidate.created_at`, latestTimes).
		Where("latest_candidate.is_internal = ? AND latest_candidate.hidden_at IS NULL", false).
		Group("latest_candidate.tenant_id, latest_candidate.workspace_id, latest_candidate.run_type, latest_candidate.subject_type, latest_candidate.subject_id, latest_candidate.created_at")
	var rows []taskRunRow
	if err := visibleScopeQuery(r.dbFor(ctx), scope).
		Where("id IN (?)", latestIDs).
		Find(&rows).Error; err != nil {
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

func batchGetTaskRuns(query *gorm.DB, taskRunIDs []string) ([]domain.TaskRun, error) {
	ids := persistenceid.ParseValid(taskRunIDs)
	if len(ids) == 0 {
		return []domain.TaskRun{}, nil
	}
	var rows []taskRunRow
	if err := query.Where("id IN ?", ids).Find(&rows).Error; err != nil {
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
	var row taskRunRow
	query := r.dbFor(ctx).Where("id = ?", id)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err = query.First(&row).Error; err != nil {
		return domain.TaskRun{}, readErr(err)
	}
	return fromRow(row), nil
}

func (r *Repository) UpdateTaskRun(ctx context.Context, run domain.TaskRun, update app.TaskRunUpdate, now time.Time) (bool, error) {
	if !run.Status.CanTransitionTo(update.Status) {
		return false, domain.ErrInvalidTaskTransition
	}
	if update.Status == domain.StatusWaitingSubtasks || update.Status == domain.StatusPartialSuccess {
		id, err := persistenceid.Parse(run.ID)
		if err != nil {
			return false, err
		}
		var childCount int64
		if err = r.dbFor(ctx).Model(&taskRunRow{}).Where("parent_task_id = ?", id).Limit(1).Count(&childCount).Error; err != nil {
			return false, err
		}
		if childCount == 0 {
			return false, domain.ErrInvalidTaskTransition
		}
	}
	updates := map[string]any{
		"status": update.Status, "error_message": update.ErrorMessage,
		"state_version": run.StateVersion + 1, "updated_at": now,
	}
	if update.StartedAt != nil {
		updates["started_at"] = *update.StartedAt
	}
	if update.FinishedAt != nil {
		updates["finished_at"] = *update.FinishedAt
	}
	if update.ErrorCode != "" {
		updates["error_code"] = update.ErrorCode
	}
	return r.update(ctx, run.ID, run.StateVersion, updates)
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
	return scopeQuery(r.dbFor(ctx).Model(&taskRunRow{}), scope).
		Where("run_type = ? AND subject_type = ? AND subject_id IN ? AND hidden_at IS NULL", runType, subjectType, ids).
		Updates(map[string]any{"hidden_at": hiddenAt, "state_version": gorm.Expr("state_version + 1"), "updated_at": hiddenAt}).Error
}

func (r *Repository) update(ctx context.Context, taskRunID string, expectedVersion int64, updates map[string]any) (bool, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return false, err
	}
	result := r.dbFor(ctx).Model(&taskRunRow{}).Where(
		"id = ? AND state_version = ? AND status IN ?", id, expectedVersion,
		[]string{domain.StatusQueued, domain.StatusRunning, domain.StatusWaitingSubtasks},
	).Updates(updates)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func scopeQuery(db *gorm.DB, scope app.Scope) *gorm.DB {
	query := db.Model(&taskRunRow{}).Where("tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return query.Where("workspace_id IS NULL")
	}
	return query.Where("workspace_id = ?", *scope.WorkspaceID)
}

func visibleScopeQuery(db *gorm.DB, scope app.Scope) *gorm.DB {
	return scopeQuery(db, scope).Where("is_internal = ? AND hidden_at IS NULL", false)
}

func readErr(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return app.ErrNotFound
	}
	return err
}

func toRow(run domain.TaskRun) (taskRunRow, error) {
	id, err := persistenceid.Parse(run.ID)
	if err != nil || run.Validate() != nil {
		return taskRunRow{}, errors.New("invalid task run")
	}
	rootTaskID, err := parseOptionalTaskRunID(run.RootTaskID)
	if err != nil {
		return taskRunRow{}, errors.New("invalid task run")
	}
	parentTaskID, err := parseOptionalTaskRunIDPointer(run.ParentTaskID)
	if err != nil {
		return taskRunRow{}, errors.New("invalid task run")
	}
	return taskRunRow{
		ID: id, TenantID: run.TenantID, WorkspaceID: run.WorkspaceID,
		RootTaskID: rootTaskID, ParentTaskID: parentTaskID,
		CreatedBy: run.CreatedBy, RunType: string(run.RunType),
		SubjectType: string(run.SubjectType), SubjectID: run.SubjectID,
		IsInternal: run.IsInternal, HiddenAt: run.HiddenAt,
		Status: string(run.Status), ErrorCode: run.ErrorCode, ErrorMessage: run.ErrorMessage,
		StateVersion: run.StateVersion, StartedAt: run.StartedAt, FinishedAt: run.FinishedAt,
		CreatedAt: run.CreatedAt, UpdatedAt: run.UpdatedAt,
	}, nil
}

func fromRow(row taskRunRow) domain.TaskRun {
	run := domain.TaskRun{
		ID: row.ID.String(), TenantID: row.TenantID, WorkspaceID: row.WorkspaceID,
		RootTaskID: optionalTaskRunID(row.RootTaskID), ParentTaskID: optionalTaskRunIDPointer(row.ParentTaskID),
		CreatedBy: row.CreatedBy, RunType: domain.RunType(row.RunType),
		SubjectType: domain.SubjectType(row.SubjectType), SubjectID: row.SubjectID,
		IsInternal: row.IsInternal, HiddenAt: row.HiddenAt,
		Status: domain.Status(row.Status), ErrorCode: row.ErrorCode, ErrorMessage: row.ErrorMessage,
		StateVersion: row.StateVersion, StartedAt: row.StartedAt, FinishedAt: row.FinishedAt,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
	return run
}

func parseOptionalTaskRunID(value string) (*persistenceid.UUID, error) {
	if value == "" {
		return nil, nil
	}
	id, err := persistenceid.Parse(value)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func parseOptionalTaskRunIDPointer(value *string) (*persistenceid.UUID, error) {
	if value == nil {
		return nil, nil
	}
	return parseOptionalTaskRunID(*value)
}

func optionalTaskRunID(value *persistenceid.UUID) string {
	if value == nil {
		return ""
	}
	return value.String()
}

func optionalTaskRunIDPointer(value *persistenceid.UUID) *string {
	if value == nil {
		return nil
	}
	id := value.String()
	return &id
}

func sameWorkspace(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func pollScheduleToRow(schedule domain.PollSchedule) (pollScheduleRow, error) {
	id, err := persistenceid.Parse(schedule.TaskRunID)
	if err != nil || schedule.NextPollAt.IsZero() || schedule.DeadlineAt.IsZero() {
		return pollScheduleRow{}, errors.New("invalid poll schedule")
	}
	return pollScheduleRow{
		TaskRunID: id, NextPollAt: schedule.NextPollAt,
		LeaseUntil: schedule.LeaseUntil, StateVersion: schedule.StateVersion,
		PollAttempts: schedule.PollAttempts, ConsecutiveErrors: schedule.ConsecutiveErrors,
		DeadlineAt: schedule.DeadlineAt, CreatedAt: schedule.CreatedAt, UpdatedAt: schedule.UpdatedAt,
	}, nil
}

func pollScheduleFromRow(row pollScheduleRow) domain.PollSchedule {
	return domain.PollSchedule{
		TaskRunID:  row.TaskRunID.String(),
		NextPollAt: row.NextPollAt, LeaseUntil: row.LeaseUntil, StateVersion: row.StateVersion,
		PollAttempts: row.PollAttempts, ConsecutiveErrors: row.ConsecutiveErrors,
		DeadlineAt: row.DeadlineAt, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func asyncDispatchToRow(dispatch domain.AsyncDispatch) (asyncDispatchRow, error) {
	id, err := persistenceid.Parse(dispatch.TaskRunID)
	if err != nil || dispatch.Validate() != nil {
		return asyncDispatchRow{}, errors.New("invalid async dispatch")
	}
	return asyncDispatchRow{
		TaskRunID:           id,
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

func asyncDispatchFromRow(row asyncDispatchRow) domain.AsyncDispatch {
	return domain.AsyncDispatch{
		TaskRunID:           row.TaskRunID.String(),
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

func asyncExecutionEventToRow(event asynccontract.Event) (asyncExecutionEventRow, error) {
	if err := event.Validate(); err != nil {
		return asyncExecutionEventRow{}, err
	}
	id, err := persistenceid.Parse(event.ID)
	if err != nil {
		return asyncExecutionEventRow{}, err
	}
	taskRunID, err := persistenceid.Parse(event.TaskRunID)
	if err != nil {
		return asyncExecutionEventRow{}, err
	}
	return asyncExecutionEventRow{
		ID: id, TaskRunID: taskRunID, RunType: event.RunType,
		ExecutionToken: event.ExecutionToken, Sequence: event.Sequence,
		EventType: string(event.EventType), PayloadVersion: event.PayloadVersion,
		Payload: append([]byte(nil), event.Payload...), PayloadSHA256: event.PayloadSHA256,
		TerminalSlot: event.TerminalSlot, ConsumeStatus: string(event.ConsumeStatus),
		NextConsumeAt: event.NextConsumeAt, ConsumeLeaseUntil: event.ConsumeLeaseUntil,
		ConsumeAttempts: event.ConsumeAttempts, StateVersion: event.StateVersion,
		LastErrorCode: event.LastErrorCode, LastErrorMessage: event.LastErrorMessage,
		CreatedAt: event.CreatedAt, UpdatedAt: event.UpdatedAt, ConsumedAt: event.ConsumedAt,
	}, nil
}

func asyncExecutionEventFromRow(row asyncExecutionEventRow) asynccontract.Event {
	return asynccontract.Event{
		ID: row.ID.String(), TaskRunID: row.TaskRunID.String(), RunType: row.RunType,
		ExecutionToken: row.ExecutionToken, Sequence: row.Sequence,
		EventType: asynccontract.EventType(row.EventType), PayloadVersion: row.PayloadVersion,
		Payload: append([]byte(nil), row.Payload...), PayloadSHA256: row.PayloadSHA256,
		TerminalSlot: row.TerminalSlot, ConsumeStatus: asynccontract.ConsumeStatus(row.ConsumeStatus),
		NextConsumeAt: row.NextConsumeAt, ConsumeLeaseUntil: row.ConsumeLeaseUntil,
		ConsumeAttempts: row.ConsumeAttempts, StateVersion: row.StateVersion,
		LastErrorCode: row.LastErrorCode, LastErrorMessage: row.LastErrorMessage,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, ConsumedAt: row.ConsumedAt,
	}
}
