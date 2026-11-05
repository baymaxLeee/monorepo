package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"time"

	"github.com/example/monorepo/storage/internal/application"
	"strings"
)

// DeliveryCache is advisory. Authorization is checked before every cache lookup;
// signed byte delivery never depends on Redis availability.
type DeliveryCache interface {
	Get(context.Context, string) ([]byte, error)
	Set(context.Context, string, []byte, time.Duration) error
}

type DeliveryCapability struct {
	AssetID    string    `json:"asset_id"`
	RevisionID string    `json:"revision_id"`
	URL        string    `json:"url"`
	ExpiresAt  time.Time `json:"expires_at"`
	Filename   string    `json:"filename"`
	MediaType  string    `json:"media_type"`
	SizeBytes  int64     `json:"size_bytes"`
}

func (router *Router) mintDelivery(ctx context.Context, item deliveryCapabilityItem) (DeliveryCapability, error) {
	_, revision, err := router.service.Describe(ctx, item.TenantID, item.WorkspaceID, item.AssetID, item.RevisionID)
	if err != nil {
		return DeliveryCapability{}, err
	}
	if item.MaxDim < 0 || item.MaxDim > 4096 || (item.MaxDim > 0 && !strings.HasPrefix(revision.MediaType, "image/")) {
		return DeliveryCapability{}, application.ErrInvalidInput
	}
	now := time.Now().UTC()
	key := fmt.Sprintf("storage:delivery:v2:%x", sha256.Sum256([]byte(fmt.Sprintf("%s\x00%s\x00%s\x00%s\x00%d\x00%d\x00%x", item.TenantID, item.WorkspaceID, item.AssetID, item.RevisionID, router.deliveryTTL, item.MaxDim, sha256.Sum256(router.signingKey)))))
	cacheAvailable := router.deliveryCache != nil
	if cacheAvailable {
		raw, cacheErr := router.deliveryCache.Get(ctx, key)
		if cacheErr != nil {
			cacheAvailable = false
			slog.Warn("storage delivery cache read failed")
		}
		var cached DeliveryCapability
		// Refresh near expiry so a cache hit cannot hand a just-expiring URL to a player.
		if json.Unmarshal(raw, &cached) == nil && cached.AssetID == item.AssetID && cached.RevisionID == item.RevisionID && cached.ExpiresAt.After(now.Add(time.Minute)) && !cached.ExpiresAt.After(now.Add(router.deliveryTTL)) {
			return cached, nil
		}
	}
	expires := now.Add(router.deliveryTTL).Unix()
	query := url.Values{"tenant_id": {item.TenantID}, "workspace_id": {item.WorkspaceID}, "expires": {strconv.FormatInt(expires, 10)}, "signature": {router.signDeliveryVariant(item.TenantID, item.WorkspaceID, item.AssetID, item.RevisionID, expires, item.MaxDim)}}
	if item.MaxDim > 0 {
		query.Set("max_dim", strconv.Itoa(item.MaxDim))
	}
	result := DeliveryCapability{AssetID: item.AssetID, RevisionID: item.RevisionID, ExpiresAt: time.Unix(expires, 0).UTC(), Filename: revision.Filename, MediaType: revision.MediaType, SizeBytes: revision.SizeBytes,
		URL: fmt.Sprintf("/api/storage-server/media/%s/revisions/%s/content?%s", url.PathEscape(item.AssetID), url.PathEscape(item.RevisionID), query.Encode())}
	if cacheAvailable {
		raw, _ := json.Marshal(result)
		if err := router.deliveryCache.Set(ctx, key, raw, time.Until(result.ExpiresAt)); err != nil {
			slog.Warn("storage delivery cache write failed")
		}
	}
	return result, nil
}
