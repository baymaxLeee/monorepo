package coverimage

import (
	"context"
	"errors"
)

const CleanupJobKind = "cover.cleanup.v1"

type CleanupQuota interface {
	ReleaseStorage(context.Context, string, string) (bool, error)
}

type Cleaner struct {
	store Store
	quota CleanupQuota
}

func NewCleaner(store Store, quota CleanupQuota) *Cleaner {
	return &Cleaner{store: store, quota: quota}
}

func (c *Cleaner) Cleanup(ctx context.Context, registration Registration) error {
	if registration.ID == "" || registration.SHA256 == "" || c.store == nil || c.quota == nil {
		return errors.New("invalid cover cleanup")
	}
	if err := c.store.Release(ctx, registration); err != nil {
		return err
	}
	_, err := c.quota.ReleaseStorage(ctx, "cover", registration.ID)
	return err
}
