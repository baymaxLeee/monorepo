package projectusage

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	app "github.com/example/monorepo/canvas/internal/application/projectusage"
	domain "github.com/example/monorepo/canvas/internal/domain/projectusage"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

const (
	callReviewReason     = "a provider call requires billing review"
	currencyReviewReason = "project usage calls have inconsistent currencies"
)

type Repository struct{ db *persistencetransaction.Store }

func NewRepository(db *persistencetransaction.Store) *Repository { return &Repository{db: db} }

func (repository *Repository) CreateCall(ctx context.Context, call domain.ProviderCall) error {
	if err := call.Validate(); err != nil || call.BillingStatus != domain.CallBillingPending ||
		call.RequestStartedAt != nil || call.CaptureResult != nil || call.StateVersion != 1 {
		return domain.ErrInvalidCall
	}
	row, err := callToRow(call)
	if err != nil {
		return err
	}
	return repository.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := repository.db.Queries(ctx)
		state, lockErr := q.LockTaskRun(ctx, row.TaskRunID)
		if lockErr != nil {
			return lockErr
		}
		if terminalTaskStatus(state.Status) {
			return app.ErrTaskRunTerminal
		}
		if createErr := q.InsertUsageCall(ctx, row); createErr != nil {
			return translateCallWriteError(createErr)
		}
		current, loadErr := q.ReadUsageCall(ctx, sqlc.ReadUsageCallParams{ID: row.TaskRunID, Ordinal: row.CallOrdinal})
		if loadErr != nil {
			return loadErr
		}
		if !sameImmutableCallRow(sqlc.InsertUsageCallParams(current), row) {
			return app.ErrCallConflict
		}
		return nil
	})
}

func (repository *Repository) GetCall(ctx context.Context, ref domain.CallRef) (domain.ProviderCall, error) {
	id, err := persistenceid.Parse(ref.TaskRunID)
	if err != nil || ref.CallOrdinal <= 0 {
		return domain.ProviderCall{}, app.ErrCallNotFound
	}
	row, err := repository.db.Queries(ctx).ReadUsageCall(ctx, sqlc.ReadUsageCallParams{ID: id.String(), Ordinal: ref.CallOrdinal})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ProviderCall{}, app.ErrCallNotFound
		}
		return domain.ProviderCall{}, err
	}
	return callFromRow(sqlc.InsertUsageCallParams(row))
}

func (repository *Repository) UpdateCall(ctx context.Context, expected, updated domain.ProviderCall) (bool, error) {
	if err := expected.ValidateTransition(updated); err != nil {
		return false, err
	}

	if expected.RequestStartedAt == nil && updated.RequestStartedAt != nil {
		var won bool
		err := repository.db.WithinTransaction(ctx, func(ctx context.Context) error {
			q := repository.db.Queries(ctx)
			id, parseErr := persistenceid.Parse(expected.TaskRunID)
			if parseErr != nil {
				return parseErr
			}
			state, lockErr := q.LockTaskRun(ctx, id.String())
			if lockErr != nil {
				return lockErr
			}
			if terminalTaskStatus(state.Status) {
				return app.ErrTaskRunTerminal
			}
			won, lockErr = repository.updateCall(ctx, expected, updated)
			return lockErr
		})
		return won, err
	}
	return repository.updateCall(ctx, expected, updated)
}

func (repository *Repository) updateCall(ctx context.Context, expected, updated domain.ProviderCall) (bool, error) {
	id, err := persistenceid.Parse(expected.TaskRunID)
	if err != nil {
		return false, err
	}
	row, err := callToRow(updated)
	if err != nil {
		return false, err
	}
	n, err := repository.db.Queries(ctx).UpdateUsageCall(ctx, sqlc.UpdateUsageCallParams{
		RequestStartedAt: row.RequestStartedAt,
		RequestID:        row.RequestID,
		CaptureResult:    row.CaptureResult,
		BillingStatus:    row.BillingStatus,
		SettlementReason: row.SettlementReason,
		Amount:           row.Amount,
		Currency:         row.Currency,
		ReviewReason:     row.ReviewReason,
		StateVersion:     row.StateVersion,
		UpdatedAt:        row.UpdatedAt,
		FinalizedAt:      row.FinalizedAt,
		ID:               id.String(),
		Ordinal:          expected.CallOrdinal,
		ExpectedVersion:  expected.StateVersion,
	})
	return n == 1, translateCallWriteError(err)
}

func (repository *Repository) CloseTaskRun(ctx context.Context, input app.CloseInput, now time.Time) error {
	taskRunID, err := persistenceid.Parse(input.TaskRunID)
	if err != nil {
		return domain.ErrInvalidRecord
	}
	if now.IsZero() {
		return domain.ErrInvalidRecord
	}
	return repository.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := repository.db.Queries(ctx)
		state, lockErr := q.LockTaskRun(ctx, taskRunID.String())
		if lockErr != nil {
			return lockErr
		}
		if !terminalTaskStatus(state.Status) {
			return app.ErrTaskRunNotTerminal
		}
		callRows, loadErr := q.ListUsageCalls(ctx, taskRunID.String())
		if loadErr != nil {
			return loadErr
		}
		calls := make([]domain.ProviderCall, 0, len(callRows))
		for index := range callRows {
			call, convertErr := callFromRow(sqlc.InsertUsageCallParams(callRows[index]))
			if convertErr != nil {
				return convertErr
			}
			if call.BillingStatus == domain.CallBillingPending && call.RequestStartedAt == nil {
				updated := call
				if finalizeErr := updated.FinalizeNotSent(now); finalizeErr != nil {
					return finalizeErr
				}
				won, updateErr := repository.updateCall(ctx, call, updated)
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
		if createErr := q.InsertUsageRecord(ctx, row); createErr != nil {
			return createErr
		}
		current, loadErr := q.LockUsageRecord(ctx, taskRunID.String())
		if loadErr != nil {
			return loadErr
		}
		if !sameFrozenRecord(sqlc.InsertUsageRecordParams(current), row) {
			return app.ErrRecordConflict
		}
		return repository.promoteReadyRecord(ctx, sqlc.InsertUsageRecordParams(current), row, now)
	})
}

func (repository *Repository) promoteReadyRecord(ctx context.Context, current, derived sqlc.InsertUsageRecordParams, now time.Time) error {
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
	refreshed.TotalAmount = derived.TotalAmount
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
	n, err := repository.db.Queries(ctx).PromoteUsageRecord(ctx, sqlc.PromoteUsageRecordParams{
		FinalCallCount:     refreshed.FinalCallCount,
		BillingStatus:      refreshed.BillingStatus,
		TotalAmount:        refreshed.TotalAmount,
		Currency:           refreshed.Currency,
		NoProgressAttempts: refreshed.NoProgressAttempts,
		NextAttemptAt:      refreshed.NextAttemptAt,
		LeaseOwner:         refreshed.LeaseOwner,
		LeaseUntil:         refreshed.LeaseUntil,
		ReviewReason:       refreshed.ReviewReason,
		BillingFinalizedAt: refreshed.BillingFinalizedAt,
		StateVersion:       refreshed.StateVersion,
		UpdatedAt:          refreshed.UpdatedAt,
		ID:                 current.TaskRunID,
		ExpectedVersion:    current.StateVersion,
		ExpectedStatus:     current.BillingStatus,
	})
	if err != nil {
		return err
	}
	if n != 1 {
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

	rows, err := repository.db.Queries(ctx).ClaimUsageBatch(ctx, sqlc.ClaimUsageBatchParams{
		Now:      now,
		Lease:    leaseUntil,
		Owner:    owner,
		PageSize: int64(limit),
	})
	if err != nil {
		return nil, err
	}
	claimed := make([]domain.UsageRecord, 0, len(rows))
	for _, row := range rows {
		record, err := recordFromRow(sqlc.InsertUsageRecordParams(row))
		if err != nil {
			return nil, err
		}
		claimed = append(claimed, record)
	}
	return claimed, nil
}

func (repository *Repository) ClaimTask(ctx context.Context, taskRunID string, now, leaseUntil time.Time, owner string) (domain.UsageRecord, bool, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil || strings.TrimSpace(owner) == "" || !leaseUntil.After(now) {
		return domain.UsageRecord{}, false, domain.ErrInvalidRecord
	}
	row, err := repository.db.Queries(ctx).ClaimOneUsageRecord(ctx, sqlc.ClaimOneUsageRecordParams{
		ID:    id.String(),
		Now:   now,
		Lease: leaseUntil,
		Owner: owner,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.UsageRecord{}, false, nil
	}
	if err != nil {
		return domain.UsageRecord{}, false, err
	}
	record, err := recordFromRow(sqlc.InsertUsageRecordParams(row))
	return record, err == nil, err
}

// BeginReconciliation durably accounts for a round before any QueryMoney call.
// An expired lease can therefore be recovered without forgetting a round that
// reached provider but crashed before the parent state was finished.
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
	n, err := repository.db.Queries(ctx).BeginUsageReconciliation(ctx, sqlc.BeginUsageReconciliationParams{
		BillingAttempts:    updated.BillingAttempts,
		NoProgressAttempts: updated.NoProgressAttempts,
		StateVersion:       updated.StateVersion,
		UpdatedAt:          updated.UpdatedAt,
		ID:                 id.String(),
		ExpectedVersion:    expected.StateVersion,
		ExpectedOwner:      expected.LeaseOwner,
	})
	if n != 1 || err != nil {
		return domain.UsageRecord{}, false, err
	}
	return updated, true, nil
}

func (repository *Repository) ListCalls(ctx context.Context, taskRunID string) ([]domain.ProviderCall, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return nil, err
	}
	rows, err := repository.db.Queries(ctx).ListUsageCalls(ctx, id.String())
	if err != nil {
		return nil, err
	}
	calls := make([]domain.ProviderCall, 0, len(rows))
	for index := range rows {
		call, convertErr := callFromRow(sqlc.InsertUsageCallParams(rows[index]))
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
	row, err := repository.db.Queries(ctx).ReadUsageNameTarget(ctx, id.String())
	if errors.Is(err, pgx.ErrNoRows) {
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
	rows, err := repository.db.Queries(ctx).ListUsageNameTargets(ctx, int64(limit))
	if err != nil {
		return nil, err
	}
	targets := make([]app.UserNameTarget, 0, len(rows))
	for index := range rows {
		targets = append(targets, userNameTarget(sqlc.ReadUsageNameTargetRow(rows[index])))
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
	return repository.db.Queries(ctx).ResolveUsageUserName(ctx, sqlc.ResolveUsageUserNameParams{
		ID:       id.String(),
		TenantID: target.TenantID,
		UserID:   target.UserID,
		Name:     name,
		Now:      now,
	})
}

func userNameTarget(row sqlc.ReadUsageNameTargetRow) app.UserNameTarget {
	return app.UserNameTarget{TaskRunID: row.TaskRunID, TenantID: row.TenantID, UserID: row.CreatedBy}
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
	n, err := repository.db.Queries(ctx).FinishUsageReconciliation(ctx, sqlc.FinishUsageReconciliationParams{
		FinalCallCount:     updated.FinalCallCount,
		BillingStatus:      string(updated.BillingStatus),
		TotalAmount:        amountText(updated.TotalAmount),
		Currency:           updated.Currency,
		NoProgressAttempts: updated.NoProgressAttempts,
		NextAttemptAt:      updated.NextAttemptAt,
		LeaseOwner:         updated.LeaseOwner,
		LeaseUntil:         updated.LeaseUntil,
		ReviewReason:       updated.ReviewReason,
		BillingFinalizedAt: updated.BillingFinalizedAt,
		StateVersion:       updated.StateVersion,
		UpdatedAt:          updated.UpdatedAt,
		BillingAttempts:    updated.BillingAttempts,
		ID:                 id.String(),
		ExpectedVersion:    expected.StateVersion,
		ExpectedOwner:      expected.LeaseOwner,
	})
	return n == 1, err
}

func (repository *Repository) WithReadOnlySnapshot(ctx context.Context, run func(context.Context) error) error {
	if run == nil {
		return errors.New("project usage snapshot callback is required")
	}
	return repository.db.WithTxOptions(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, run)
}

func (repository *Repository) GetProjectName(ctx context.Context, input app.GetProjectNameInput) (string, error) {
	projectID, err := persistenceid.Parse(input.ProjectID)
	if err != nil {
		return "", applicationproject.ErrNotFound
	}
	name, err := repository.db.Queries(ctx).ReadUsageProjectName(ctx, sqlc.ReadUsageProjectNameParams{
		ProjectID:   projectID.String(),
		TenantID:    input.TenantID,
		WorkspaceID: input.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", applicationproject.ErrNotFound
	}
	return name, err
}

func (repository *Repository) ListExportPage(ctx context.Context, query app.ExportPageQuery) ([]app.ExportRow, error) {
	projectID, err := persistenceid.Parse(query.ProjectID)
	if err != nil || query.Limit <= 0 {
		return nil, domain.ErrInvalidRecord
	}
	args := sqlc.ListUsageExportPageParams{
		TenantID:    query.TenantID,
		WorkspaceID: query.WorkspaceID,
		ProjectID:   projectID.String(),
		AfterTime:   query.AfterConsumedAt,
		PageSize:    int64(query.Limit),
	}
	if query.AfterConsumedAt != nil {
		afterID, err := persistenceid.Parse(query.AfterTaskRunID)
		if err != nil {
			return nil, domain.ErrInvalidRecord
		}
		args.AfterID = afterID.String()
	}
	rows, err := repository.db.Queries(ctx).ListUsageExportPage(ctx, args)
	if err != nil {
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
			TaskRunID: row.TaskRunID, ConsumedAt: row.ConsumedAt, TaskType: row.RunType, ResourceType: row.ResourceType,
			ModelID: row.ModelID, ModelSource: row.ModelSource, ModelName: row.ModelName, CreatedBy: row.CreatedBy,
			CreatedByName: createdByName, BillingStatus: app.BillingStatus(row.BillingStatus),
			TotalAmount: normalizedAmount(amountPointer(row.TotalAmount)), Currency: cloneString(row.Currency),
		})
	}
	return result, nil
}

func terminalTaskStatus(status string) bool {
	switch domaintask.Status(status) {
	case domaintask.StatusSucceeded, domaintask.StatusFailed, domaintask.StatusCancelled:
		return true
	default:
		return false
	}
}

func taskRunConsumedAt(row sqlc.TaskRun) time.Time {
	consumedAt := row.CreatedAt
	if row.StartedAt != nil {
		consumedAt = *row.StartedAt
	}
	return consumedAt
}

func newUsageRecordRow(task sqlc.TaskRun, calls []domain.ProviderCall, now time.Time) (sqlc.InsertUsageRecordParams, error) {
	if len(calls) == 0 {
		return sqlc.InsertUsageRecordParams{}, domain.ErrInvalidRecord
	}
	projectID, err := persistenceid.Parse(calls[0].ProjectID)
	if err != nil {
		return sqlc.InsertUsageRecordParams{}, domain.ErrInvalidRecord
	}
	_, resourceType, _, _, ok := app.ExpectedUsageShape(task.RunType)
	if !ok {
		return sqlc.InsertUsageRecordParams{}, domain.ErrInvalidRecord
	}
	row := sqlc.InsertUsageRecordParams{
		TaskRunID: task.ID, TenantID: task.TenantID, WorkspaceID: cloneString(task.WorkspaceID), ProjectID: projectID.String(),
		RunType: task.RunType, ResourceType: resourceType, ModelID: calls[0].ModelID, ModelName: calls[0].ModelName,
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
		TaskRunID:   task.ID,
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
	row.TotalAmount, row.Currency, row.BillingFinalizedAt = total, currency, &now
	return row, nil
}

func aggregateFinalCalls(calls []domain.ProviderCall) (string, *string, error) {
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

func callToRow(call domain.ProviderCall) (sqlc.InsertUsageCallParams, error) {
	id, err := persistenceid.Parse(call.TaskRunID)
	if err != nil {
		return sqlc.InsertUsageCallParams{}, err
	}
	projectID, err := persistenceid.Parse(call.ProjectID)
	if err != nil {
		return sqlc.InsertUsageCallParams{}, err
	}
	return sqlc.InsertUsageCallParams{
		TaskRunID: id.String(), CallOrdinal: call.CallOrdinal, CallType: call.CallType, ProjectID: projectID.String(),
		ModelID: call.ModelID, ModelName: call.ModelName, ModelSource: call.ModelSource,
		RequestStartedAt: cloneTime(call.RequestStartedAt), RequestID: cloneString(call.RequestID),
		CaptureResult: captureString(call.CaptureResult), BillingStatus: string(call.BillingStatus),
		SettlementReason: settlementString(call.SettlementReason), Amount: amountText(call.Amount), Currency: cloneString(call.Currency),
		ReviewReason: call.ReviewReason, StateVersion: call.StateVersion, CreatedAt: call.CreatedAt, UpdatedAt: call.UpdatedAt,
		FinalizedAt: cloneTime(call.FinalizedAt),
	}, nil
}

func callFromRow(row sqlc.InsertUsageCallParams) (domain.ProviderCall, error) {
	call := domain.ProviderCall{
		TaskRunID: row.TaskRunID, CallOrdinal: row.CallOrdinal, CallType: row.CallType,
		ProjectID: row.ProjectID, ModelID: row.ModelID, ModelName: row.ModelName, ModelSource: row.ModelSource,
		RequestStartedAt: cloneTime(row.RequestStartedAt), RequestID: cloneString(row.RequestID),
		CaptureResult: parseCapture(row.CaptureResult), BillingStatus: domain.CallBillingStatus(row.BillingStatus),
		SettlementReason: parseSettlement(row.SettlementReason), Amount: normalizedAmount(amountPointer(row.Amount)), Currency: cloneString(row.Currency),
		ReviewReason: row.ReviewReason, StateVersion: row.StateVersion, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		FinalizedAt: cloneTime(row.FinalizedAt),
	}
	return call, call.Validate()
}

func sameImmutableCallRow(left, right sqlc.InsertUsageCallParams) bool {
	return left.CallType == right.CallType && left.ProjectID == right.ProjectID &&
		left.ModelID == right.ModelID && left.ModelName == right.ModelName && left.ModelSource == right.ModelSource
}

func recordFromRow(row sqlc.InsertUsageRecordParams) (domain.UsageRecord, error) {
	record := domain.UsageRecord{
		TaskRunID: row.TaskRunID, TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID), ProjectID: row.ProjectID,
		TaskType: row.RunType, ResourceType: row.ResourceType, ModelID: row.ModelID, ModelName: row.ModelName, ModelSource: row.ModelSource,
		CreatedBy: row.CreatedBy, CreatedByName: row.CreatedByName, ConsumedAt: row.ConsumedAt, CallCount: row.CallCount,
		FinalCallCount: row.FinalCallCount, BillingStatus: domain.RecordBillingStatus(row.BillingStatus), TotalAmount: normalizedAmount(amountPointer(row.TotalAmount)),
		Currency: cloneString(row.Currency), BillingAttempts: row.BillingAttempts, NoProgressAttempts: row.NoProgressAttempts,
		NextAttemptAt: cloneTime(row.NextAttemptAt), LeaseOwner: row.LeaseOwner, LeaseUntil: cloneTime(row.LeaseUntil), StateVersion: row.StateVersion,
		ReviewReason: row.ReviewReason, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, BillingFinalizedAt: cloneTime(row.BillingFinalizedAt),
	}
	return record, record.Validate()
}

func sameFrozenRecord(left, right sqlc.InsertUsageRecordParams) bool {
	return left.TaskRunID == right.TaskRunID && left.TenantID == right.TenantID && equalStrings(left.WorkspaceID, right.WorkspaceID) &&
		left.ProjectID == right.ProjectID && left.RunType == right.RunType && left.ResourceType == right.ResourceType &&
		left.ModelID == right.ModelID && left.ModelName == right.ModelName && left.ModelSource == right.ModelSource &&
		left.CreatedBy == right.CreatedBy && left.ConsumedAt.Equal(right.ConsumedAt) &&
		left.CallCount == right.CallCount
}

func sameBillingProjection(left, right sqlc.InsertUsageRecordParams) bool {
	return left.FinalCallCount == right.FinalCallCount && left.BillingStatus == right.BillingStatus &&
		equalAmounts(amountPointer(left.TotalAmount), amountPointer(right.TotalAmount)) && equalStrings(left.Currency, right.Currency) &&
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
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
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

func amountText(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
func amountPointer(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
