package quota

import (
	"context"
	"errors"
	"sync"
	"time"
)

type cacheEntry struct {
	limits     Limits
	refreshed  time.Time
	refreshing bool
	wait       chan struct{}
}

type LimitCache struct {
	source       LimitSource
	refreshAfter time.Duration
	maxStaleness time.Duration
	clock        Clock

	mu      sync.Mutex
	entries map[string]*cacheEntry
}

func NewLimitCache(
	source LimitSource,
	refreshAfter time.Duration,
	maxStaleness time.Duration,
	clock Clock,
) *LimitCache {
	return &LimitCache{
		source: source, refreshAfter: refreshAfter, maxStaleness: maxStaleness,
		clock: clock, entries: make(map[string]*cacheEntry),
	}
}

func (c *LimitCache) Limit(ctx context.Context, tenantID string, resource ResourceType) (Limit, error) {
	for {
		now := c.clock.Now()
		c.mu.Lock()
		entry := c.entries[tenantID]
		if entry != nil && !entry.refreshed.IsZero() && now.Sub(entry.refreshed) < c.refreshAfter {
			limit, ok := entry.limits[resource]
			c.mu.Unlock()
			return requireLimit(limit, ok)
		}
		if entry != nil && entry.refreshing {
			if !entry.refreshed.IsZero() && now.Sub(entry.refreshed) <= c.maxStaleness {
				limit, ok := entry.limits[resource]
				c.mu.Unlock()
				return requireLimit(limit, ok)
			}
			wait := entry.wait
			c.mu.Unlock()
			select {
			case <-ctx.Done():
				return Limit{}, ctx.Err()
			case <-wait:
				continue
			}
		}
		if entry == nil {
			entry = &cacheEntry{}
			c.entries[tenantID] = entry
		}
		entry.refreshing = true
		entry.wait = make(chan struct{})
		c.mu.Unlock()

		limits, err := c.source.Limits(ctx, tenantID)

		c.mu.Lock()
		entry.refreshing = false
		if err == nil {
			entry.limits = cloneLimits(limits)
			entry.refreshed = c.clock.Now()
		}
		close(entry.wait)
		staleLimits := entry.limits
		refreshed := entry.refreshed
		c.mu.Unlock()

		if err == nil {
			limit, ok := limits[resource]
			return requireLimit(limit, ok)
		}
		if !refreshed.IsZero() && now.Sub(refreshed) <= c.maxStaleness {
			limit, ok := staleLimits[resource]
			return requireLimit(limit, ok)
		}
		return Limit{}, errors.Join(ErrUnavailable, err)
	}
}

func requireLimit(limit Limit, ok bool) (Limit, error) {
	if !ok {
		return Limit{}, ErrUnavailable
	}
	return limit, nil
}

func cloneLimits(source Limits) Limits {
	result := make(Limits, len(source))
	for resource, limit := range source {
		result[resource] = limit
	}
	return result
}

var _ LimitProvider = (*LimitCache)(nil)
