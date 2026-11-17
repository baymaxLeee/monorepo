package application

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type DeliveryCache interface {
	Get(context.Context, string) ([]byte, error)
	Set(context.Context, string, []byte, time.Duration) error
}

type DeliveryItem struct {
	TenantID, WorkspaceID, AssetID, RevisionID string
	MaxDimension                               int
}

type DeliveryCapability struct {
	AssetID, RevisionID, URL, Filename, MediaType string
	ExpiresAt                                     time.Time
	SizeBytes                                     int64
}

type DeliveryService struct {
	assets     *Service
	signingKey []byte
	ttl        time.Duration
	cache      DeliveryCache
}

func NewDeliveryService(assets *Service, signingKey string, ttl time.Duration, cache DeliveryCache) *DeliveryService {
	if ttl <= 0 {
		ttl = 6 * time.Hour
	}
	return &DeliveryService{assets: assets, signingKey: []byte(signingKey), ttl: ttl, cache: cache}
}

func (service *DeliveryService) Mint(ctx context.Context, item DeliveryItem) (DeliveryCapability, error) {
	_, revision, err := service.assets.Describe(ctx, item.TenantID, item.WorkspaceID, item.AssetID, item.RevisionID)
	if err != nil {
		return DeliveryCapability{}, err
	}
	if item.MaxDimension < 0 || item.MaxDimension > 4096 || (item.MaxDimension > 0 && !strings.HasPrefix(revision.MediaType, "image/")) {
		return DeliveryCapability{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	key := fmt.Sprintf("storage:delivery:v2:%x", sha256.Sum256([]byte(fmt.Sprintf("%s\x00%s\x00%s\x00%s\x00%d\x00%d\x00%x", item.TenantID, item.WorkspaceID, item.AssetID, item.RevisionID, service.ttl, item.MaxDimension, sha256.Sum256(service.signingKey)))))
	cacheAvailable := service.cache != nil
	if cacheAvailable {
		raw, cacheErr := service.cache.Get(ctx, key)
		if cacheErr != nil {
			cacheAvailable = false
			slog.Warn("storage delivery cache read failed")
		}
		var cached DeliveryCapability
		if json.Unmarshal(raw, &cached) == nil && cached.AssetID == item.AssetID && cached.RevisionID == item.RevisionID && cached.ExpiresAt.After(now.Add(time.Minute)) && !cached.ExpiresAt.After(now.Add(service.ttl)) {
			return cached, nil
		}
	}
	expires := now.Add(service.ttl).Unix()
	query := url.Values{"tenant_id": {item.TenantID}, "workspace_id": {item.WorkspaceID}, "expires": {strconv.FormatInt(expires, 10)}, "signature": {service.signature(item, expires)}}
	if item.MaxDimension > 0 {
		query.Set("max_dim", strconv.Itoa(item.MaxDimension))
	}
	result := DeliveryCapability{AssetID: item.AssetID, RevisionID: item.RevisionID, ExpiresAt: time.Unix(expires, 0).UTC(), Filename: revision.Filename, MediaType: revision.MediaType, SizeBytes: revision.SizeBytes, URL: fmt.Sprintf("/api/storage-server/media/%s/revisions/%s/content?%s", url.PathEscape(item.AssetID), url.PathEscape(item.RevisionID), query.Encode())}
	if cacheAvailable {
		raw, _ := json.Marshal(result)
		if err := service.cache.Set(ctx, key, raw, time.Until(result.ExpiresAt)); err != nil {
			slog.Warn("storage delivery cache write failed")
		}
	}
	return result, nil
}

func (service *DeliveryService) signature(item DeliveryItem, expires int64) string {
	mac := hmac.New(sha256.New, service.signingKey)
	if item.MaxDimension == 0 {
		_, _ = fmt.Fprintf(mac, "%s\x00%s\x00%s\x00%s\x00%d", item.TenantID, item.WorkspaceID, item.AssetID, item.RevisionID, expires)
	} else {
		_, _ = fmt.Fprintf(mac, "image-v1\x00%s\x00%s\x00%s\x00%s\x00%d\x00%d", item.TenantID, item.WorkspaceID, item.AssetID, item.RevisionID, expires, item.MaxDimension)
	}
	return fmt.Sprintf("%x", mac.Sum(nil))
}
