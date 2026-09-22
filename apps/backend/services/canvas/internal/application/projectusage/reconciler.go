package projectusage

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"sort"
	"strings"
	"time"

	domain "github.com/example/monorepo/canvas/internal/domain/projectusage"
)

const (
	MaxNoProgressAttempts    int32 = 10
	MaxPendingAge                  = 7 * 24 * time.Hour
	reconciliationClaimLimit       = 20
	reconciliationLease            = 2 * time.Minute
	moneyQueryTimeout              = 10 * time.Second
)

type RetryJitter func(string, int32, time.Duration) time.Duration

type Reconciler struct {
	store  ReconciliationStore
	money  MoneyQuerier
	clock  Clock
	owner  string
	jitter RetryJitter
}

func NewReconciler(store ReconciliationStore, money MoneyQuerier, clock Clock, owner string, jitter ...RetryJitter) *Reconciler {
	selected := RetryJitter(defaultRetryJitter)
	if len(jitter) > 0 && jitter[0] != nil {
		selected = jitter[0]
	}
	return &Reconciler{store: store, money: money, clock: clock, owner: owner, jitter: selected}
}

func (reconciler *Reconciler) ReconcileDue(ctx context.Context) (int, error) {
	if reconciler == nil || reconciler.store == nil || reconciler.money == nil || reconciler.clock == nil || strings.TrimSpace(reconciler.owner) == "" {
		return 0, errors.New("project usage reconciler dependencies are invalid")
	}
	completed := 0
	var failures error
	for processed := 0; processed < reconciliationClaimLimit; processed++ {
		now := reconciler.clock.Now()
		records, err := reconciler.store.ClaimDue(ctx, now, now.Add(reconciliationLease), reconciler.owner, 1)
		if err != nil {
			return completed, errors.Join(failures, err)
		}
		if len(records) == 0 {
			break
		}
		ready, reconcileErr := reconciler.reconcileOne(ctx, records[0])
		if ready {
			completed++
		}
		failures = errors.Join(failures, reconcileErr)
	}
	return completed, failures
}

// ReconcileTask performs the first settlement round immediately after the
// terminal transaction commits. It still acquires the same versioned lease as
// the background scanner, so immediate and scheduled reconciliation cannot
// settle the same parent concurrently.
func (reconciler *Reconciler) ReconcileTask(ctx context.Context, taskRunID string) (bool, error) {
	if reconciler == nil || reconciler.store == nil || reconciler.money == nil || reconciler.clock == nil ||
		strings.TrimSpace(reconciler.owner) == "" || strings.TrimSpace(taskRunID) == "" {
		return false, errors.New("project usage reconciler dependencies are invalid")
	}
	now := reconciler.clock.Now()
	record, claimed, err := reconciler.store.ClaimTask(ctx, taskRunID, now, now.Add(reconciliationLease), reconciler.owner)
	if err != nil || !claimed {
		return false, err
	}
	return reconciler.reconcileOne(ctx, record)
}

func (reconciler *Reconciler) reconcileOne(ctx context.Context, record domain.UsageRecord) (bool, error) {
	calls, err := reconciler.store.ListCalls(ctx, record.TaskRunID)
	if err != nil {
		readErr := err
		now := reconciler.clock.Now()
		if reconciliationLimitReason(record, record.NoProgressAttempts, now) == "" {
			var started bool
			record, started, err = reconciler.store.BeginReconciliation(ctx, record, now)
			if err != nil {
				return false, errors.Join(readErr, err)
			}
			if !started {
				return false, errors.Join(readErr, errors.New("project usage reconciliation lease or state changed before round start"))
			}
		}
		finishErr := reconciler.finishReadFailure(ctx, record, readErr, now, record.FinalCallCount)
		return false, errors.Join(readErr, finishErr)
	}
	sortCalls(calls)
	now := reconciler.clock.Now()
	if reason := callSetProblem(record, calls); reason != "" {
		return reconciler.finishReview(ctx, record, int32(countFinal(calls)), reason, now)
	}
	if reason := reviewedCallProblem(calls); reason != "" {
		return reconciler.finishReview(ctx, record, int32(countFinal(calls)), reason, now)
	}
	finalBefore := int(record.FinalCallCount)
	observedFinalCount := int32(countFinal(calls))
	if observedFinalCount < record.FinalCallCount {
		observedFinalCount = record.FinalCallCount
	}
	if int(observedFinalCount) == len(calls) {
		update, aggregateErr := readyUpdate(record, calls, now)
		if aggregateErr != nil {
			return reconciler.finishReview(ctx, record, observedFinalCount, aggregateErr.Error(), now)
		}
		ok, finishErr := reconciler.store.FinishReconciliation(ctx, record, update, now)
		return ok, reconciliationFinishError(ok, finishErr)
	}
	if reason := reconciliationLimitReason(record, record.NoProgressAttempts, now); reason != "" {
		failures := reconciler.markPendingCallsForReview(ctx, calls, reason, now)
		ready, finishErr := reconciler.finishReviewWithNoProgress(
			ctx, record, observedFinalCount, record.NoProgressAttempts, reason, now,
		)
		return ready, errors.Join(failures, finishErr)
	}
	record, started, err := reconciler.store.BeginReconciliation(ctx, record, now)
	if err != nil {
		return false, err
	}
	if !started {
		return false, errors.New("project usage reconciliation lease or state changed before round start")
	}
	var failures error
	for index := range calls {
		call := calls[index]
		if call.BillingStatus != domain.CallBillingPending || call.CaptureResult == nil {
			continue
		}
		if *call.CaptureResult != domain.CaptureCaptured || call.RequestID == nil || strings.TrimSpace(*call.RequestID) == "" {
			failures = errors.Join(failures, fmt.Errorf("call %d has invalid pending capture state", call.CallOrdinal))
			continue
		}
		queryCtx, cancelQuery := context.WithTimeout(ctx, moneyQueryTimeout)
		result, queryErr := reconciler.money.QueryMoney(queryCtx, *call.RequestID)
		cancelQuery()
		if queryErr != nil {
			failures = errors.Join(failures, queryErr)
			continue
		}
		transitionNow := reconciler.clock.Now()
		updated := call
		switch result.Status {
		case MoneyPending:
			continue
		case MoneySettled:
			if settleErr := updated.Settle(result.Amount, result.Currency, domain.SettlementAIGWSettled, transitionNow); settleErr != nil {
				reason := "AIGW usage lookup returned an invalid amount or currency"
				if reviewErr := updated.MarkCapturedNeedsReview(reason, transitionNow); reviewErr != nil {
					failures = errors.Join(failures, settleErr, reviewErr)
					continue
				}
			}
		case MoneyNeedsReview:
			reason := strings.TrimSpace(result.Reason)
			if reason == "" {
				reason = "AIGW usage lookup returned a non-retryable result"
			}
			if reviewErr := updated.MarkCapturedNeedsReview(reason, transitionNow); reviewErr != nil {
				failures = errors.Join(failures, reviewErr)
				continue
			}
		default:
			if reviewErr := updated.MarkCapturedNeedsReview("AIGW usage lookup returned an unknown status", transitionNow); reviewErr != nil {
				failures = errors.Join(failures, reviewErr)
				continue
			}
		}
		if updated.StateVersion == call.StateVersion {
			continue
		}
		ok, updateErr := reconciler.store.UpdateCall(ctx, call, updated)
		if updateErr != nil {
			failures = errors.Join(failures, updateErr)
			continue
		}
		if !ok {
			// Another reconciler or a late capture won the call CAS. Reload below
			// before deriving the TaskRun-level state.
			continue
		}
		if updated.BillingStatus == domain.CallBillingFinal {
			observedFinalCount++
		}
	}
	calls, err = reconciler.store.ListCalls(ctx, record.TaskRunID)
	if err != nil {
		now = reconciler.clock.Now()
		finishErr := reconciler.finishReadFailure(ctx, record, err, now, observedFinalCount)
		return false, errors.Join(failures, err, finishErr)
	}
	sortCalls(calls)
	now = reconciler.clock.Now()
	if reason := callSetProblem(record, calls); reason != "" {
		ready, finishErr := reconciler.finishReview(ctx, record, int32(countFinal(calls)), reason, now)
		return ready, errors.Join(failures, finishErr)
	}
	if reason := reviewedCallProblem(calls); reason != "" {
		ready, finishErr := reconciler.finishReview(ctx, record, int32(countFinal(calls)), reason, now)
		return ready, errors.Join(failures, finishErr)
	}
	finalAfter := countFinal(calls)
	if finalAfter == len(calls) {
		update, aggregateErr := readyUpdate(record, calls, now)
		if aggregateErr != nil {
			ready, finishErr := reconciler.finishReview(ctx, record, int32(finalAfter), aggregateErr.Error(), now)
			return ready, errors.Join(failures, finishErr)
		}
		ok, finishErr := reconciler.store.FinishReconciliation(ctx, record, update, now)
		return ok, errors.Join(failures, reconciliationFinishError(ok, finishErr))
	}
	noProgress := record.NoProgressAttempts
	if finalAfter > finalBefore {
		noProgress = 0
	}
	if reason := reconciliationLimitReason(record, noProgress, now); reason != "" {
		failures = errors.Join(failures, reconciler.markPendingCallsForReview(ctx, calls, reason, now))
		ready, finishErr := reconciler.finishReviewWithNoProgress(ctx, record, int32(finalAfter), noProgress, reason, now)
		return ready, errors.Join(failures, finishErr)
	}
	delayAttempt := noProgress
	if delayAttempt < 1 {
		delayAttempt = 1
	}
	next := now.Add(reconciler.jitter(record.TaskRunID, delayAttempt, retryDelay(delayAttempt)))
	update := domain.ReconciliationUpdate{
		BillingStatus: domain.RecordBillingPending, FinalCallCount: int32(finalAfter), BillingAttempts: record.BillingAttempts,
		NoProgressAttempts: noProgress, NextAttemptAt: &next,
	}
	ok, finishErr := reconciler.store.FinishReconciliation(ctx, record, update, now)
	return false, errors.Join(failures, reconciliationFinishError(ok, finishErr))
}

func (reconciler *Reconciler) finishReadFailure(
	ctx context.Context,
	record domain.UsageRecord,
	readErr error,
	now time.Time,
	observedFinalCount int32,
) error {
	if observedFinalCount < record.FinalCallCount {
		observedFinalCount = record.FinalCallCount
	}
	noProgress := record.NoProgressAttempts
	if observedFinalCount > record.FinalCallCount {
		noProgress = 0
	}
	reason := "billing reconciliation could not read AIGW calls"
	if readErr != nil {
		reason += ": " + readErr.Error()
	}
	update := domain.ReconciliationUpdate{
		BillingStatus: domain.RecordBillingPending, FinalCallCount: observedFinalCount,
		BillingAttempts: record.BillingAttempts, NoProgressAttempts: noProgress,
	}
	if limitReason := reconciliationLimitReason(record, noProgress, now); limitReason != "" {
		update.BillingStatus = domain.RecordBillingNeedsReview
		update.ReviewReason = limitReason + ": " + reason
	} else {
		delayAttempt := noProgress
		if delayAttempt < 1 {
			delayAttempt = 1
		}
		next := now.Add(reconciler.jitter(record.TaskRunID, delayAttempt, retryDelay(delayAttempt)))
		update.NextAttemptAt = &next
	}
	ok, err := reconciler.store.FinishReconciliation(ctx, record, update, now)
	return reconciliationFinishError(ok, err)
}

func (reconciler *Reconciler) finishReview(ctx context.Context, record domain.UsageRecord, finalCount int32, reason string, now time.Time) (bool, error) {
	return reconciler.finishReviewWithNoProgress(ctx, record, finalCount, record.NoProgressAttempts, reason, now)
}

func (reconciler *Reconciler) finishReviewWithNoProgress(ctx context.Context, record domain.UsageRecord, finalCount, noProgress int32, reason string, now time.Time) (bool, error) {
	update := domain.ReconciliationUpdate{
		BillingStatus: domain.RecordBillingNeedsReview, FinalCallCount: finalCount,
		BillingAttempts: record.BillingAttempts, NoProgressAttempts: noProgress,
		ReviewReason: reason,
	}
	ok, err := reconciler.store.FinishReconciliation(ctx, record, update, now)
	return false, reconciliationFinishError(ok, err)
}

func reconciliationFinishError(ok bool, err error) error {
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("project usage reconciliation lease or state changed")
	}
	return nil
}

func reconciliationLimitReason(record domain.UsageRecord, noProgress int32, now time.Time) string {
	if !now.Before(record.CreatedAt.Add(MaxPendingAge)) {
		return "billing reconciliation exceeded the maximum pending age"
	}
	if noProgress >= MaxNoProgressAttempts {
		return "billing reconciliation reached the maximum no-progress attempts"
	}
	return ""
}

func (reconciler *Reconciler) markPendingCallsForReview(ctx context.Context, calls []domain.AIGWCall, reason string, now time.Time) error {
	var failures error
	for index := range calls {
		ref := calls[index].Ref()
		for attempt := 0; attempt < maxCallCASAttempts; attempt++ {
			current, err := reconciler.store.GetCall(ctx, ref)
			if err != nil {
				failures = errors.Join(failures, err)
				break
			}
			if current.BillingStatus != domain.CallBillingPending {
				break
			}
			updated := current
			if updated.CaptureResult == nil {
				err = updated.MarkRequestIDUnknown(reason, now)
			} else {
				err = updated.MarkCapturedNeedsReview(reason, now)
			}
			if err != nil {
				failures = errors.Join(failures, err)
				break
			}
			var ok bool
			ok, err = reconciler.store.UpdateCall(ctx, current, updated)
			if err != nil {
				failures = errors.Join(failures, err)
				break
			}
			if ok {
				break
			}
			if attempt == maxCallCASAttempts-1 {
				failures = errors.Join(failures, ErrConcurrentCallUpdate)
			}
		}
	}
	return failures
}

func readyUpdate(record domain.UsageRecord, calls []domain.AIGWCall, now time.Time) (domain.ReconciliationUpdate, error) {
	amounts := make([]string, 0, len(calls))
	currency := ""
	currencySet := false
	for index := range calls {
		call := calls[index]
		if call.BillingStatus != domain.CallBillingFinal || call.Amount == nil {
			return domain.ReconciliationUpdate{}, errors.New("a project usage call is not final")
		}
		normalizedAmount, err := domain.NormalizeAmount(*call.Amount)
		if err != nil {
			return domain.ReconciliationUpdate{}, err
		}
		amounts = append(amounts, normalizedAmount)
		// A zero charge does not constrain the monetary unit. This permits
		// confirmed non-billing/cancelled calls to coexist with charged calls.
		if normalizedAmount == "0" {
			continue
		}
		callCurrency := ""
		if call.Currency != nil {
			callCurrency = strings.TrimSpace(*call.Currency)
		}
		if !currencySet {
			currency, currencySet = callCurrency, true
		} else if currency != callCurrency {
			return domain.ReconciliationUpdate{}, errors.New("project usage calls have inconsistent currencies")
		}
	}
	total, err := domain.AddAmounts(amounts...)
	if err != nil {
		return domain.ReconciliationUpdate{}, err
	}
	var currencyPtr *string
	if currencySet && currency != "" {
		currencyPtr = &currency
	}
	return domain.ReconciliationUpdate{
		BillingStatus: domain.RecordBillingReady, FinalCallCount: int32(len(calls)), TotalAmount: &total, Currency: currencyPtr,
		BillingAttempts: record.BillingAttempts, NoProgressAttempts: 0, BillingFinalizedAt: &now,
	}, nil
}

func callSetProblem(record domain.UsageRecord, calls []domain.AIGWCall) string {
	return FrozenCallSetProblem(FrozenUsageSnapshot{
		TaskRunID:   record.TaskRunID,
		TaskType:    record.TaskType,
		ProjectID:   record.ProjectID,
		ModelID:     record.ModelID,
		ModelName:   record.ModelName,
		ModelSource: record.ModelSource,
		CallCount:   record.CallCount,
	}, calls)
}

func reviewedCallProblem(calls []domain.AIGWCall) string {
	for index := range calls {
		if calls[index].BillingStatus == domain.CallBillingNeedsReview {
			if calls[index].ReviewReason != "" {
				return calls[index].ReviewReason
			}
			return "an AIGW call requires billing review"
		}
	}
	return ""
}

func sortCalls(calls []domain.AIGWCall) {
	sort.Slice(calls, func(i, j int) bool { return calls[i].CallOrdinal < calls[j].CallOrdinal })
}

func countFinal(calls []domain.AIGWCall) int {
	count := 0
	for index := range calls {
		if calls[index].BillingStatus == domain.CallBillingFinal {
			count++
		}
	}
	return count
}

func retryDelay(noProgressAttempt int32) time.Duration {
	if noProgressAttempt < 1 {
		noProgressAttempt = 1
	}
	// AIGW persists usage records through MQ, so the first retry is intentionally
	// short. Longer gaps then absorb billing latency without sustained polling.
	delays := [...]time.Duration{
		5 * time.Minute,
		30 * time.Minute,
		time.Hour,
		2 * time.Hour,
		4 * time.Hour,
		8 * time.Hour,
		16 * time.Hour,
	}
	if noProgressAttempt > int32(len(delays)) {
		return 24 * time.Hour
	}
	return delays[noProgressAttempt-1]
}

func defaultRetryJitter(taskRunID string, attempt int32, delay time.Duration) time.Duration {
	hash := fnv.New32a()
	_, _ = fmt.Fprintf(hash, "%s:%d", taskRunID, attempt) //nolint:errcheck // hash.Hash writes never return an error.
	// Deterministic 0-10% jitter keeps retries stable across process restarts.
	partsPerTenThousand := int64(hash.Sum32() % 1001)
	return delay + time.Duration(int64(delay)*partsPerTenThousand/10_000)
}
