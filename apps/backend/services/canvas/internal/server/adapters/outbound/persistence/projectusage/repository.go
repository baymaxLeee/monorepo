package projectusage

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	applicationproject "github.com/example/monorepo/canvas/internal/server/application/project"
	app "github.com/example/monorepo/canvas/internal/server/application/projectusage"
	domain "github.com/example/monorepo/canvas/internal/server/domain/projectusage"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
)

const (
	callReviewReason     = "an AIGW call requires billing review"
	currencyReviewReason = "project usage calls have inconsistent currencies"
	claimScanPageSize    = 32
)

type snapshotContextKey struct{}

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (repository *Repository) dbFor(ctx context.Context) *gorm.DB {
	if tx, ok := ctx.Value(snapshotContextKey{}).(*gorm.DB); ok && tx != nil {
		return tx.WithContext(ctx)
	}
	return persistencetransaction.DB(ctx, repository.db)
}

func (repository *Repository) CreateCall(ctx context.Context, call domain.AIGWCall) error {
	if err := call.Validate(); err != nil || call.BillingStatus != domain.CallBillingPending ||
		call.RequestStartedAt != nil || call.CaptureResult != nil || call.StateVersion != 1 {
		return domain.ErrInvalidCall
	}
	row, err := callToRow(call)
	if err != nil {
		return err
	}
	return repository.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		state, lockErr := lockTaskRun(tx, row.TaskRunID)
		if lockErr != nil {
			return lockErr
		}
		if terminalTaskStatus(state.Status) {
			return app.ErrTaskRunTerminal
		}
		if createErr := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "task_run_id"}, {Name: "call_ordinal"}},
			DoNothing: true,
		}).Create(&row).Error; createErr != nil {
			return translateCallWriteError(createErr)
		}
		var current aigwCallRow
		if loadErr := tx.Where("task_run_id = ? AND call_ordinal = ?", row.TaskRunID, row.CallOrdinal).First(&current).Error; loadErr != nil {
			return loadErr
		}
		if !sameImmutableCallRow(current, row) {
			return app.ErrCallConflict
		}
		return nil
	})
}

func (repository *Repository) GetCall(ctx context.Context, ref domain.CallRef) (domain.AIGWCall, error) {
	id, err := persistenceid.Parse(ref.TaskRunID)
	if err != nil || ref.CallOrdinal <= 0 {
		return domain.AIGWCall{}, app.ErrCallNotFound
	}
	var row aigwCallRow
	if err = repository.dbFor(ctx).Where("task_run_id = ? AND call_ordinal = ?", id, ref.CallOrdinal).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domain.AIGWCall{}, app.ErrCallNotFound
		}
		return domain.AIGWCall{}, err
	}
	return callFromRow(row)
}

func (repository *Repository) UpdateCall(ctx context.Context, expected, updated domain.AIGWCall) (bool, error) {
	if err := expected.ValidateTransition(updated); err != nil {
		return false, err
	}
	db := repository.dbFor(ctx)
	if expected.RequestStartedAt == nil && updated.RequestStartedAt != nil {
		var won bool
		err := db.Transaction(func(tx *gorm.DB) error {
			id, parseErr := persistenceid.Parse(expected.TaskRunID)
			if parseErr != nil {
				return parseErr
			}
			state, lockErr := lockTaskRun(tx, id)
			if lockErr != nil {
				return lockErr
			}
			if terminalTaskStatus(state.Status) {
				return app.ErrTaskRunTerminal
			}
			won, lockErr = repository.updateCall(tx, expected, updated)
			return lockErr
		})
		return won, err
	}
	return repository.updateCall(db, expected, updated)
}

func (repository *Repository) updateCall(db *gorm.DB, expected, updated domain.AIGWCall) (bool, error) {
	id, err := persistenceid.Parse(expected.TaskRunID)
	if err != nil {
		return false, err
	}
	row, err := callToRow(updated)
	if err != nil {
		return false, err
	}
	result := db.Model(&aigwCallRow{}).Where(
		"task_run_id = ? AND call_ordinal = ? AND state_version = ?", id, expected.CallOrdinal, expected.StateVersion,
	).Updates(map[string]any{
		"request_started_at": row.RequestStartedAt, "request_id": row.RequestID,
		"capture_result": row.CaptureResult, "billing_status": row.BillingStatus,
		"settlement_reason": row.SettlementReason, "amount": row.Amount, "currency": row.Currency,
		"review_reason": row.ReviewReason, "state_version": row.StateVersion, "updated_at": row.UpdatedAt,
		"finalized_at": row.FinalizedAt,
	})
	if result.Error != nil {
		return false, translateCallWriteError(result.Error)
	}
	return result.RowsAffected == 1, nil
}

func (repository *Repository) CloseTaskRun(ctx context.Context, input app.CloseInput, now time.Time) error {
	taskRunID, err := persistenceid.Parse(input.TaskRunID)
	if err != nil {
		return domain.ErrInvalidRecord
	}
	if now.IsZero() {
		return domain.ErrInvalidRecord
	}
	return repository.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		state, lockErr := lockTaskRun(tx, taskRunID)
		if lockErr != nil {
			return lockErr
		}
		if !terminalTaskStatus(state.Status) {
			return app.ErrTaskRunNotTerminal
		}
		var callRows []aigwCallRow
		if loadErr := tx.Where("task_run_id = ?", taskRunID).Order("call_ordinal ASC").Find(&callRows).Error; loadErr != nil {
			return loadErr
		}
		calls := make([]domain.AIGWCall, 0, len(callRows))
		for index := range callRows {
			call, convertErr := callFromRow(callRows[index])
			if convertErr != nil {
				return convertErr
			}
			if call.BillingStatus == domain.CallBillingPending && call.RequestStartedAt == nil {
				updated := call
				if finalizeErr := updated.FinalizeNotSent(now); finalizeErr != nil {
					return finalizeErr
				}
				won, updateErr := repository.updateCall(tx, call, updated)
				if updateErr != nil {
					return updateErr
				}
				if !won {
					return app.ErrConcurrentCallUpdate
				}
				call = updated
			}
			calls = append(calls, call)
		}
		if len(calls) == 0 {
			return app.ErrCallSetIncomplete
		}
		row, deriveErr := newUsageRecordRow(state, calls, now)
		if deriveErr != nil {
			return deriveErr
		}
		if createErr := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "task_run_id"}}, DoNothing: true}).Create(&row).Error; createErr != nil {
			return createErr
		}
		var current usageRecordRow
		if loadErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("task_run_id = ?", taskRunID).First(&current).Error; loadErr != nil {
			return loadErr
		}
		if !sameFrozenRecord(current, row) {
			return app.ErrRecordConflict
		}
		return repository.promoteReadyRecord(tx, current, row, now)
	})
}

func (repository *Repository) promoteReadyRecord(db *gorm.DB, current, derived usageRecordRow, now time.Time) error {
	if _, err := recordFromRow(current); err != nil {
		return err
	}
	if sameBillingProjection(current, derived) {
		return nil
	}
	if domain.RecordBillingStatus(derived.BillingStatus) != domain.RecordBillingReady {
		return nil
	}
	currentStatus := domain.RecordBillingStatus(current.BillingStatus)
	if currentStatus != domain.RecordBillingPending && currentStatus != domain.RecordBillingNeedsReview {
		return app.ErrRecordConflict
	}
	// All contributing calls are now immutable FINAL facts. Promotion revokes
	// any stale reconciliation lease and advances the parent version so an
	// in-flight worker cannot overwrite READY with an older pending result.
	refreshed := current
	refreshed.FinalCallCount = derived.FinalCallCount
	refreshed.BillingStatus = derived.BillingStatus
	refreshed.TotalAmount = cloneString(derived.TotalAmount)
	refreshed.Currency = cloneString(derived.Currency)
	refreshed.NoProgressAttempts = 0
	refreshed.NextAttemptAt = cloneTime(derived.NextAttemptAt)
	refreshed.LeaseOwner = ""
	refreshed.LeaseUntil = nil
	refreshed.ReviewReason = derived.ReviewReason
	refreshed.BillingFinalizedAt = cloneTime(derived.BillingFinalizedAt)
	refreshed.StateVersion++
	refreshed.UpdatedAt = now
	if _, err := recordFromRow(refreshed); err != nil {
		return err
	}
	result := db.Model(&usageRecordRow{}).Where(
		"task_run_id = ? AND state_version = ? AND billing_status = ?",
		current.TaskRunID, current.StateVersion, current.BillingStatus,
	).Updates(map[string]any{
		"final_call_count": refreshed.FinalCallCount, "billing_status": refreshed.BillingStatus,
		"total_amount": refreshed.TotalAmount, "currency": refreshed.Currency,
		"no_progress_attempts": refreshed.NoProgressAttempts, "next_attempt_at": refreshed.NextAttemptAt,
		"lease_owner": refreshed.LeaseOwner, "lease_until": refreshed.LeaseUntil,
		"review_reason": refreshed.ReviewReason, "billing_finalized_at": refreshed.BillingFinalizedAt,
		"state_version": refreshed.StateVersion, "updated_at": refreshed.UpdatedAt,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return app.ErrRecordConflict
	}
	return nil
}

func (repository *Repository) ClaimDue(ctx context.Context, now, leaseUntil time.Time, owner string, limit int) ([]domain.UsageRecord, error) {
	if limit <= 0 {
		return nil, nil
	}
	if strings.TrimSpace(owner) == "" || !leaseUntil.After(now) {
		return nil, domain.ErrInvalidRecord
	}
	db := repository.dbFor(ctx)
	claimed := make([]domain.UsageRecord, 0, limit)
	var cursorTime time.Time
	var cursorTaskRunID persistenceid.UUID
	hasCursor := false
	for len(claimed) < limit {
		query := db.Where(
			"billing_status = ? AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)",
			domain.RecordBillingPending, now, now,
		)
		if hasCursor {
			query = query.Where(
				"next_attempt_at > ? OR (next_attempt_at = ? AND task_run_id > ?)",
				cursorTime, cursorTime, cursorTaskRunID,
			)
		}
		pageSize := claimScanPageSize
		if remaining := limit - len(claimed); remaining > pageSize {
			pageSize = remaining
		}
		var candidates []usageRecordRow
		if err := query.Order("next_attempt_at ASC").Order("task_run_id ASC").Limit(pageSize).Find(&candidates).Error; err != nil {
			return nil, err
		}
		if len(candidates) == 0 {
			break
		}
		pageClaims, err := repository.claimCandidates(ctx, candidates, now, leaseUntil, owner, limit-len(claimed))
		if err != nil {
			return nil, err
		}
		claimed = append(claimed, pageClaims...)
		if len(claimed) == limit || len(candidates) < pageSize {
			break
		}
		last := candidates[len(candidates)-1]
		if last.NextAttemptAt == nil {
			return nil, domain.ErrInvalidRecord
		}
		cursorTime, cursorTaskRunID, hasCursor = *last.NextAttemptAt, last.TaskRunID, true
	}
	return claimed, nil
}

func (repository *Repository) claimCandidates(
	ctx context.Context,
	candidates []usageRecordRow,
	now, leaseUntil time.Time,
	owner string,
	limit int,
) ([]domain.UsageRecord, error) {
	claimed := make([]domain.UsageRecord, 0, limit)
	for index := range candidates {
		if len(claimed) == limit {
			break
		}
		record, ok, err := repository.claimRecord(ctx, candidates[index], now, leaseUntil, owner)
		if err != nil {
			return nil, err
		}
		if ok {
			claimed = append(claimed, record)
		}
	}
	return claimed, nil
}

func (repository *Repository) ClaimTask(ctx context.Context, taskRunID string, now, leaseUntil time.Time, owner string) (domain.UsageRecord, bool, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil || strings.TrimSpace(owner) == "" || !leaseUntil.After(now) {
		return domain.UsageRecord{}, false, domain.ErrInvalidRecord
	}
	var candidate usageRecordRow
	err = repository.dbFor(ctx).Where(
		"task_run_id = ? AND billing_status = ? AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)",
		id, domain.RecordBillingPending, now, now,
	).First(&candidate).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.UsageRecord{}, false, nil
	}
	if err != nil {
		return domain.UsageRecord{}, false, err
	}
	return repository.claimRecord(ctx, candidate, now, leaseUntil, owner)
}

func (repository *Repository) claimRecord(ctx context.Context, candidate usageRecordRow, now, leaseUntil time.Time, owner string) (domain.UsageRecord, bool, error) {
	result := repository.dbFor(ctx).Model(&usageRecordRow{}).Where(
		"task_run_id = ? AND billing_status = ? AND state_version = ? AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)",
		candidate.TaskRunID, domain.RecordBillingPending, candidate.StateVersion, now, now,
	).Updates(map[string]any{
		"lease_owner": owner, "lease_until": leaseUntil, "state_version": candidate.StateVersion + 1, "updated_at": now,
	})
	if result.Error != nil || result.RowsAffected != 1 {
		return domain.UsageRecord{}, false, result.Error
	}
	candidate.LeaseOwner, candidate.LeaseUntil = owner, &leaseUntil
	candidate.StateVersion++
	candidate.UpdatedAt = now
	record, err := recordFromRow(candidate)
	return record, err == nil, err
}

// BeginReconciliation durably accounts for a round before any QueryMoney call.
// An expired lease can therefore be recovered without forgetting a round that
// reached AIGW but crashed before the parent state was finished.
func (repository *Repository) BeginReconciliation(
	ctx context.Context,
	expected domain.UsageRecord,
	now time.Time,
) (domain.UsageRecord, bool, error) {
	if err := expected.Validate(); err != nil || expected.BillingStatus != domain.RecordBillingPending ||
		strings.TrimSpace(expected.LeaseOwner) == "" {
		return domain.UsageRecord{}, false, domain.ErrInvalidRecord
	}
	updated := expected
	updated.BillingAttempts++
	updated.NoProgressAttempts++
	updated.StateVersion++
	updated.UpdatedAt = now
	if err := updated.Validate(); err != nil {
		return domain.UsageRecord{}, false, err
	}
	id, err := persistenceid.Parse(expected.TaskRunID)
	if err != nil {
		return domain.UsageRecord{}, false, err
	}
	result := repository.dbFor(ctx).Model(&usageRecordRow{}).Where(
		"task_run_id = ? AND billing_status = ? AND state_version = ? AND lease_owner = ? AND lease_until > ?",
		id, domain.RecordBillingPending, expected.StateVersion, expected.LeaseOwner, now,
	).Updates(map[string]any{
		"billing_attempts": updated.BillingAttempts, "no_progress_attempts": updated.NoProgressAttempts,
		"state_version": updated.StateVersion, "updated_at": now,
	})
	if result.Error != nil || result.RowsAffected != 1 {
		return domain.UsageRecord{}, false, result.Error
	}
	return updated, true, nil
}

func (repository *Repository) ListCalls(ctx context.Context, taskRunID string) ([]domain.AIGWCall, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return nil, err
	}
	var rows []aigwCallRow
	if err = repository.dbFor(ctx).Where("task_run_id = ?", id).Order("call_ordinal ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	calls := make([]domain.AIGWCall, 0, len(rows))
	for index := range rows {
		call, convertErr := callFromRow(rows[index])
		if convertErr != nil {
			return nil, convertErr
		}
		calls = append(calls, call)
	}
	return calls, nil
}

func (repository *Repository) GetUnresolvedUserName(
	ctx context.Context,
	taskRunID string,
) (app.UserNameTarget, bool, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return app.UserNameTarget{}, false, domain.ErrInvalidRecord
	}
	var row usageRecordRow
	err = repository.dbFor(ctx).Select("task_run_id", "tenant_id", "created_by").Where(
		"task_run_id = ? AND created_by_name_resolved_at IS NULL", id,
	).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return app.UserNameTarget{}, false, nil
	}
	if err != nil {
		return app.UserNameTarget{}, false, err
	}
	return userNameTarget(row), true, nil
}

func (repository *Repository) ListUnresolvedUserNames(ctx context.Context, limit int) ([]app.UserNameTarget, error) {
	if limit <= 0 {
		return nil, domain.ErrInvalidRecord
	}
	var rows []usageRecordRow
	if err := repository.dbFor(ctx).Select("task_run_id", "tenant_id", "created_by").Where(
		"created_by_name_resolved_at IS NULL",
	).Order("created_at ASC").Order("task_run_id ASC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	targets := make([]app.UserNameTarget, 0, len(rows))
	for index := range rows {
		targets = append(targets, userNameTarget(rows[index]))
	}
	return targets, nil
}

func (repository *Repository) MarkUserNameResolved(
	ctx context.Context,
	target app.UserNameTarget,
	name string,
	now time.Time,
) error {
	id, err := persistenceid.Parse(target.TaskRunID)
	name = strings.TrimSpace(name)
	if err != nil || strings.TrimSpace(target.TenantID) == "" || strings.TrimSpace(target.UserID) == "" ||
		name == "" || now.IsZero() {
		return domain.ErrInvalidRecord
	}
	return repository.dbFor(ctx).Model(&usageRecordRow{}).Where(
		"task_run_id = ? AND tenant_id = ? AND created_by = ? AND created_by_name_resolved_at IS NULL",
		id, target.TenantID, target.UserID,
	).Updates(map[string]any{
		"created_by_name": name, "created_by_name_resolved_at": now, "updated_at": now,
	}).Error
}

func userNameTarget(row usageRecordRow) app.UserNameTarget {
	return app.UserNameTarget{TaskRunID: row.TaskRunID.String(), TenantID: row.TenantID, UserID: row.CreatedBy}
}

func (repository *Repository) FinishReconciliation(ctx context.Context, expected domain.UsageRecord, update domain.ReconciliationUpdate, now time.Time) (bool, error) {
	if err := expected.Validate(); err != nil || expected.BillingStatus != domain.RecordBillingPending || strings.TrimSpace(expected.LeaseOwner) == "" {
		return false, domain.ErrInvalidRecord
	}
	if update.BillingAttempts != expected.BillingAttempts || update.FinalCallCount < expected.FinalCallCount ||
		(update.NoProgressAttempts != 0 && update.NoProgressAttempts != expected.NoProgressAttempts) {
		return false, domain.ErrInvalidRecord
	}
	updated := expected
	updated.BillingStatus, updated.FinalCallCount = update.BillingStatus, update.FinalCallCount
	updated.TotalAmount, updated.Currency = cloneString(update.TotalAmount), cloneString(update.Currency)
	updated.BillingAttempts, updated.NoProgressAttempts = update.BillingAttempts, update.NoProgressAttempts
	updated.NextAttemptAt, updated.ReviewReason = cloneTime(update.NextAttemptAt), update.ReviewReason
	updated.BillingFinalizedAt = cloneTime(update.BillingFinalizedAt)
	updated.LeaseOwner, updated.LeaseUntil = "", nil
	updated.StateVersion++
	updated.UpdatedAt = now
	if err := updated.Validate(); err != nil {
		return false, err
	}
	id, err := persistenceid.Parse(expected.TaskRunID)
	if err != nil {
		return false, err
	}
	result := repository.dbFor(ctx).Model(&usageRecordRow{}).Where(
		"task_run_id = ? AND billing_status = ? AND state_version = ? AND lease_owner = ? AND lease_until > ?",
		id, domain.RecordBillingPending, expected.StateVersion, expected.LeaseOwner, now,
	).Updates(map[string]any{
		"billing_status": update.BillingStatus, "final_call_count": update.FinalCallCount,
		"total_amount": update.TotalAmount, "currency": update.Currency, "billing_attempts": update.BillingAttempts,
		"no_progress_attempts": update.NoProgressAttempts, "next_attempt_at": update.NextAttemptAt,
		"review_reason": update.ReviewReason, "billing_finalized_at": update.BillingFinalizedAt,
		"lease_owner": "", "lease_until": nil, "state_version": expected.StateVersion + 1, "updated_at": now,
	})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (repository *Repository) WithReadOnlySnapshot(ctx context.Context, run func(context.Context) error) error {
	if run == nil {
		return errors.New("project usage snapshot callback is required")
	}
	return repository.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return run(context.WithValue(ctx, snapshotContextKey{}, tx))
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
}

func (repository *Repository) GetProjectName(ctx context.Context, input app.GetProjectNameInput) (string, error) {
	projectID, err := persistenceid.Parse(input.ProjectID)
	if err != nil {
		return "", applicationproject.ErrNotFound
	}
	query := repository.dbFor(ctx).Model(&projectNameRow{}).Where("id = ? AND tenant_id = ?", projectID, input.TenantID)
	query = applyWorkspaceScope(query, input.WorkspaceID)
	var row projectNameRow
	if err = query.First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", applicationproject.ErrNotFound
		}
		return "", err
	}
	return row.Name, nil
}

func (repository *Repository) ListExportPage(ctx context.Context, query app.ExportPageQuery) ([]app.ExportRow, error) {
	projectID, err := persistenceid.Parse(query.ProjectID)
	if err != nil || query.Limit <= 0 {
		return nil, domain.ErrInvalidRecord
	}
	db := repository.dbFor(ctx).Model(&usageRecordRow{}).Where(
		"tenant_id = ? AND project_id = ?",
		query.TenantID, projectID,
	)
	db = applyWorkspaceScope(db, query.WorkspaceID)
	if query.AfterConsumedAt != nil {
		afterID, parseErr := persistenceid.Parse(query.AfterTaskRunID)
		if parseErr != nil {
			return nil, domain.ErrInvalidRecord
		}
		db = db.Where("(consumed_at > ?) OR (consumed_at = ? AND task_run_id > ?)", *query.AfterConsumedAt, *query.AfterConsumedAt, afterID)
	}
	var rows []usageRecordRow
	if err = db.Order("consumed_at ASC").Order("task_run_id ASC").Limit(query.Limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]app.ExportRow, 0, len(rows))
	for index := range rows {
		row := rows[index]
		var createdByName *string
		if row.CreatedByName != "" {
			createdByName = ptrString(row.CreatedByName)
		}
		result = append(result, app.ExportRow{
			TaskRunID: row.TaskRunID.String(), ConsumedAt: row.ConsumedAt, TaskType: row.TaskType, ResourceType: row.ResourceType,
			ModelID: row.ModelID, ModelSource: row.ModelSource, ModelName: row.ModelName, CreatedBy: row.CreatedBy,
			CreatedByName: createdByName, BillingStatus: app.BillingStatus(row.BillingStatus),
			TotalAmount: normalizedAmount(row.TotalAmount), Currency: cloneString(row.Currency),
		})
	}
	return result, nil
}

type taskRunStateRow struct {
	ID          persistenceid.UUID
	TenantID    string
	WorkspaceID *string
	CreatedBy   string
	RunType     string
	Status      string
	StartedAt   *time.Time
	CreatedAt   time.Time
}

func (taskRunStateRow) TableName() string { return "task_runs" }

func lockTaskRun(db *gorm.DB, taskRunID persistenceid.UUID) (taskRunStateRow, error) {
	var row taskRunStateRow
	err := db.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", taskRunID).First(&row).Error
	return row, err
}

func terminalTaskStatus(status string) bool {
	switch domaintask.Status(status) {
	case domaintask.StatusSucceeded, domaintask.StatusFailed, domaintask.StatusCancelled:
		return true
	default:
		return false
	}
}

func taskRunConsumedAt(row taskRunStateRow) time.Time {
	consumedAt := row.CreatedAt
	if row.StartedAt != nil {
		consumedAt = *row.StartedAt
	}
	return consumedAt
}

func newUsageRecordRow(task taskRunStateRow, calls []domain.AIGWCall, now time.Time) (usageRecordRow, error) {
	if len(calls) == 0 {
		return usageRecordRow{}, domain.ErrInvalidRecord
	}
	projectID, err := persistenceid.Parse(calls[0].ProjectID)
	if err != nil {
		return usageRecordRow{}, domain.ErrInvalidRecord
	}
	_, resourceType, _, _, ok := app.ExpectedUsageShape(task.RunType)
	if !ok {
		return usageRecordRow{}, domain.ErrInvalidRecord
	}
	row := usageRecordRow{
		TaskRunID: task.ID, TenantID: task.TenantID, WorkspaceID: cloneString(task.WorkspaceID), ProjectID: projectID,
		TaskType: task.RunType, ResourceType: resourceType, ModelID: calls[0].ModelID, ModelName: calls[0].ModelName,
		ModelSource: calls[0].ModelSource, CreatedBy: task.CreatedBy, CreatedByName: task.CreatedBy,
		ConsumedAt: taskRunConsumedAt(task),
		CallCount:  int32(len(calls)), StateVersion: 1, CreatedAt: now, UpdatedAt: now,
	}
	for index := range calls {
		if calls[index].BillingStatus == domain.CallBillingFinal {
			row.FinalCallCount++
		}
	}
	if reason := app.FrozenCallSetProblem(app.FrozenUsageSnapshot{
		TaskRunID:   task.ID.String(),
		TaskType:    task.RunType,
		ProjectID:   calls[0].ProjectID,
		ModelID:     calls[0].ModelID,
		ModelName:   calls[0].ModelName,
		ModelSource: calls[0].ModelSource,
		CallCount:   int32(len(calls)),
	}, calls); reason != "" {
		row.BillingStatus, row.ReviewReason = string(domain.RecordBillingNeedsReview), reason
		return row, nil
	}
	for index := range calls {
		if calls[index].BillingStatus == domain.CallBillingNeedsReview {
			row.BillingStatus, row.ReviewReason = string(domain.RecordBillingNeedsReview), calls[index].ReviewReason
			if row.ReviewReason == "" {
				row.ReviewReason = callReviewReason
			}
			return row, nil
		}
	}
	allFinal := true
	for index := range calls {
		if calls[index].BillingStatus != domain.CallBillingFinal {
			allFinal = false
			break
		}
	}
	if !allFinal {
		row.BillingStatus, row.NextAttemptAt = string(domain.RecordBillingPending), &now
		return row, nil
	}
	total, currency, aggregateErr := aggregateFinalCalls(calls)
	if aggregateErr != nil {
		row.BillingStatus, row.ReviewReason = string(domain.RecordBillingNeedsReview), aggregateErr.Error()
		return row, nil
	}
	row.BillingStatus, row.FinalCallCount = string(domain.RecordBillingReady), int32(len(calls))
	row.TotalAmount, row.Currency, row.BillingFinalizedAt = &total, currency, &now
	return row, nil
}

func aggregateFinalCalls(calls []domain.AIGWCall) (string, *string, error) {
	amounts := make([]string, 0, len(calls))
	currency := ""
	for index := range calls {
		if calls[index].BillingStatus != domain.CallBillingFinal || calls[index].Amount == nil {
			return "", nil, domain.ErrInvalidCall
		}
		amounts = append(amounts, *calls[index].Amount)
		if calls[index].Currency == nil {
			continue
		}
		if currency == "" {
			currency = *calls[index].Currency
		} else if currency != *calls[index].Currency {
			return "", nil, errors.New(currencyReviewReason)
		}
	}
	total, err := domain.AddAmounts(amounts...)
	if err != nil {
		return "", nil, err
	}
	if currency == "" {
		return total, nil, nil
	}
	return total, &currency, nil
}

func callToRow(call domain.AIGWCall) (aigwCallRow, error) {
	id, err := persistenceid.Parse(call.TaskRunID)
	if err != nil {
		return aigwCallRow{}, err
	}
	projectID, err := persistenceid.Parse(call.ProjectID)
	if err != nil {
		return aigwCallRow{}, err
	}
	return aigwCallRow{
		TaskRunID: id, CallOrdinal: call.CallOrdinal, CallType: call.CallType, ProjectID: projectID,
		ModelID: call.ModelID, ModelName: call.ModelName, ModelSource: call.ModelSource,
		RequestStartedAt: cloneTime(call.RequestStartedAt), RequestID: cloneString(call.RequestID),
		CaptureResult: captureString(call.CaptureResult), BillingStatus: string(call.BillingStatus),
		SettlementReason: settlementString(call.SettlementReason), Amount: cloneString(call.Amount), Currency: cloneString(call.Currency),
		ReviewReason: call.ReviewReason, StateVersion: call.StateVersion, CreatedAt: call.CreatedAt, UpdatedAt: call.UpdatedAt,
		FinalizedAt: cloneTime(call.FinalizedAt),
	}, nil
}

func callFromRow(row aigwCallRow) (domain.AIGWCall, error) {
	call := domain.AIGWCall{
		TaskRunID: row.TaskRunID.String(), CallOrdinal: row.CallOrdinal, CallType: row.CallType,
		ProjectID: row.ProjectID.String(), ModelID: row.ModelID, ModelName: row.ModelName, ModelSource: row.ModelSource,
		RequestStartedAt: cloneTime(row.RequestStartedAt), RequestID: cloneString(row.RequestID),
		CaptureResult: parseCapture(row.CaptureResult), BillingStatus: domain.CallBillingStatus(row.BillingStatus),
		SettlementReason: parseSettlement(row.SettlementReason), Amount: normalizedAmount(row.Amount), Currency: cloneString(row.Currency),
		ReviewReason: row.ReviewReason, StateVersion: row.StateVersion, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		FinalizedAt: cloneTime(row.FinalizedAt),
	}
	return call, call.Validate()
}

func sameImmutableCallRow(left, right aigwCallRow) bool {
	return left.CallType == right.CallType && left.ProjectID == right.ProjectID &&
		left.ModelID == right.ModelID && left.ModelName == right.ModelName && left.ModelSource == right.ModelSource
}

func recordFromRow(row usageRecordRow) (domain.UsageRecord, error) {
	record := domain.UsageRecord{
		TaskRunID: row.TaskRunID.String(), TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID), ProjectID: row.ProjectID.String(),
		TaskType: row.TaskType, ResourceType: row.ResourceType, ModelID: row.ModelID, ModelName: row.ModelName, ModelSource: row.ModelSource,
		CreatedBy: row.CreatedBy, CreatedByName: row.CreatedByName, ConsumedAt: row.ConsumedAt, CallCount: row.CallCount,
		FinalCallCount: row.FinalCallCount, BillingStatus: domain.RecordBillingStatus(row.BillingStatus), TotalAmount: normalizedAmount(row.TotalAmount),
		Currency: cloneString(row.Currency), BillingAttempts: row.BillingAttempts, NoProgressAttempts: row.NoProgressAttempts,
		NextAttemptAt: cloneTime(row.NextAttemptAt), LeaseOwner: row.LeaseOwner, LeaseUntil: cloneTime(row.LeaseUntil), StateVersion: row.StateVersion,
		ReviewReason: row.ReviewReason, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, BillingFinalizedAt: cloneTime(row.BillingFinalizedAt),
	}
	return record, record.Validate()
}

func sameFrozenRecord(left, right usageRecordRow) bool {
	return left.TaskRunID == right.TaskRunID && left.TenantID == right.TenantID && equalStrings(left.WorkspaceID, right.WorkspaceID) &&
		left.ProjectID == right.ProjectID && left.TaskType == right.TaskType && left.ResourceType == right.ResourceType &&
		left.ModelID == right.ModelID && left.ModelName == right.ModelName && left.ModelSource == right.ModelSource &&
		left.CreatedBy == right.CreatedBy && left.ConsumedAt.Equal(right.ConsumedAt) &&
		left.CallCount == right.CallCount
}

func sameBillingProjection(left, right usageRecordRow) bool {
	return left.FinalCallCount == right.FinalCallCount && left.BillingStatus == right.BillingStatus &&
		equalAmounts(left.TotalAmount, right.TotalAmount) && equalStrings(left.Currency, right.Currency) &&
		left.ReviewReason == right.ReviewReason
}

func equalAmounts(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	leftNormalized, leftErr := domain.NormalizeAmount(*left)
	rightNormalized, rightErr := domain.NormalizeAmount(*right)
	return leftErr == nil && rightErr == nil && leftNormalized == rightNormalized
}

func translateCallWriteError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return app.ErrCallConflict
	}
	return err
}

func captureString(value *domain.CaptureResult) *string {
	if value == nil {
		return nil
	}
	result := string(*value)
	return &result
}

func settlementString(value *domain.SettlementReason) *string {
	if value == nil {
		return nil
	}
	result := string(*value)
	return &result
}

func parseCapture(value *string) *domain.CaptureResult {
	if value == nil {
		return nil
	}
	result := domain.CaptureResult(*value)
	return &result
}

func parseSettlement(value *string) *domain.SettlementReason {
	if value == nil {
		return nil
	}
	result := domain.SettlementReason(*value)
	return &result
}

func normalizedAmount(value *string) *string {
	if value == nil {
		return nil
	}
	normalized, err := domain.NormalizeAmount(*value)
	if err != nil {
		return cloneString(value)
	}
	return &normalized
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	result := *value
	return &result
}

func ptrString(value string) *string { return &value }

func cloneTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	result := *value
	return &result
}

func equalStrings(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func applyWorkspaceScope(db *gorm.DB, workspaceID *string) *gorm.DB {
	if workspaceID == nil {
		return db.Where(clause.Eq{Column: clause.Column{Name: "workspace_id"}, Value: nil})
	}
	return db.Where("workspace_id = ?", *workspaceID)
}

type projectNameRow struct {
	ID          persistenceid.UUID
	TenantID    string
	WorkspaceID *string
	Name        string
	DeletedAt   soft_delete.DeletedAt `gorm:"softDelete:milli"`
}

func (projectNameRow) TableName() string { return "projects" }
