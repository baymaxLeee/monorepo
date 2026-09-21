package executor

import (
	"context"
	"time"
)

// Cancellation intent belongs to the caller's outbox, so a failed HTTP cancel
// must be retried while the existing durable task is still being watched.
func (c *Client) WatchWithCancellation(ctx context.Context, id, owner string, requested func(context.Context) (bool, error)) (Task, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			intent, err := requested(ctx)
			if err == nil && intent {
				if _, err = c.Cancel(ctx, id, owner); err == nil {
					return
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	task, err := c.Watch(ctx, id, owner)
	cancel()
	<-done
	return task, err
}
