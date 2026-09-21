package projectusage

import (
	"context"
	"errors"
	"sort"
	"strings"
)

const nameEnrichmentBatchSize = 100

type NameEnricher struct {
	store     UserNameStore
	directory UserDirectory
	clock     Clock
}

func NewNameEnricher(store UserNameStore, directory UserDirectory, clock Clock) *NameEnricher {
	return &NameEnricher{store: store, directory: directory, clock: clock}
}

func (enricher *NameEnricher) EnrichTask(ctx context.Context, taskRunID string) (bool, error) {
	if err := enricher.validate(); err != nil || strings.TrimSpace(taskRunID) == "" {
		return false, errors.Join(err, errors.New("project usage name enrichment TaskRunID is required"))
	}
	target, found, err := enricher.store.GetUnresolvedUserName(ctx, taskRunID)
	if err != nil || !found {
		return false, err
	}
	resolved, err := enricher.enrichTenant(ctx, []UserNameTarget{target})
	return resolved == 1, err
}

func (enricher *NameEnricher) EnrichDue(ctx context.Context) (int, error) {
	if err := enricher.validate(); err != nil {
		return 0, err
	}
	targets, err := enricher.store.ListUnresolvedUserNames(ctx, nameEnrichmentBatchSize)
	if err != nil {
		return 0, err
	}
	byTenant := make(map[string][]UserNameTarget)
	for _, target := range targets {
		if strings.TrimSpace(target.TaskRunID) == "" || strings.TrimSpace(target.TenantID) == "" || strings.TrimSpace(target.UserID) == "" {
			err = errors.Join(err, errors.New("project usage name target is invalid"))
			continue
		}
		byTenant[target.TenantID] = append(byTenant[target.TenantID], target)
	}
	tenants := make([]string, 0, len(byTenant))
	for tenantID := range byTenant {
		tenants = append(tenants, tenantID)
	}
	sort.Strings(tenants)
	resolved := 0
	for _, tenantID := range tenants {
		count, resolveErr := enricher.enrichTenant(ctx, byTenant[tenantID])
		resolved += count
		err = errors.Join(err, resolveErr)
	}
	return resolved, err
}

func (enricher *NameEnricher) enrichTenant(ctx context.Context, targets []UserNameTarget) (int, error) {
	if len(targets) == 0 {
		return 0, nil
	}
	userIDs := make([]string, 0, len(targets))
	seen := make(map[string]struct{}, len(targets))
	for _, target := range targets {
		if _, exists := seen[target.UserID]; exists {
			continue
		}
		seen[target.UserID] = struct{}{}
		userIDs = append(userIDs, target.UserID)
	}
	names, err := enricher.directory.DisplayNames(ctx, targets[0].TenantID, userIDs)
	if err != nil {
		return 0, err
	}
	resolved := 0
	for _, target := range targets {
		name := strings.TrimSpace(names[target.UserID])
		if name == "" {
			// A successful IAM response without the user is a stable fallback;
			// transport failures return above and remain eligible for retry.
			name = target.UserID
		}
		if updateErr := enricher.store.MarkUserNameResolved(ctx, target, name, enricher.clock.Now()); updateErr != nil {
			err = errors.Join(err, updateErr)
			continue
		}
		resolved++
	}
	return resolved, err
}

func (enricher *NameEnricher) validate() error {
	if enricher == nil || enricher.store == nil || enricher.directory == nil || enricher.clock == nil {
		return errors.New("project usage name enricher dependencies are invalid")
	}
	return nil
}
