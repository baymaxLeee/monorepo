package quota

import (
	"context"
	"fmt"
	"time"
)

const (
	reportClaimLimit = 100
	reportLease      = time.Minute
)

type Reporter struct {
	store     ReportingStore
	publisher UsagePublisher
	clock     Clock
	owner     string
}

func NewReporter(store ReportingStore, publisher UsagePublisher, clock Clock, owner string) *Reporter {
	return &Reporter{store: store, publisher: publisher, clock: clock, owner: owner}
}

func (r *Reporter) RunOnce(ctx context.Context) error {
	now := r.clock.Now()
	claims, err := r.store.ClaimDirty(ctx, r.owner, now, now.Add(reportLease), reportClaimLimit)
	if err != nil {
		return fmt.Errorf("claim quota usage reports: %w", err)
	}
	var firstErr error
	for _, claim := range claims {
		if err = r.publisher.PublishTotal(ctx, claim.TenantID, claim.Resource, claim.Value); err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf(
					"publish %s usage for tenant %s: %w", claim.Resource, claim.TenantID, err,
				)
			}
			continue
		}
		if _, err = r.store.CompleteReport(ctx, claim, r.clock.Now()); err != nil && firstErr == nil {
			firstErr = fmt.Errorf(
				"complete %s usage report for tenant %s: %w", claim.Resource, claim.TenantID, err,
			)
		}
	}
	return firstErr
}

type Reconciler struct {
	store ReportingStore
	clock Clock
}

func NewReconciler(store ReportingStore, clock Clock) *Reconciler {
	return &Reconciler{store: store, clock: clock}
}

func (r *Reconciler) RunOnce(ctx context.Context, forceReport bool) error {
	if err := r.store.ReconcileAll(ctx, r.clock.Now(), forceReport); err != nil {
		return fmt.Errorf("reconcile quota usage: %w", err)
	}
	return nil
}
