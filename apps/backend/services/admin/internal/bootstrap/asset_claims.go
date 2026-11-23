package bootstrap

import (
	"context"
	"log/slog"
	"time"

	"github.com/example/monorepo/admin/internal/application"
)

type utcClock struct{}

func (utcClock) Now() time.Time { return time.Now().UTC() }

func runAssetClaimRelay(ctx context.Context, relay *application.AssetClaimRelay) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if _, err := relay.RunOnce(ctx, 100); err != nil && ctx.Err() == nil {
			slog.Error("relay Admin asset claims", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
