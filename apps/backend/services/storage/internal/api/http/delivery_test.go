package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/example/monorepo/storage/internal/application"
)

type memoryDeliveryCache struct {
	values map[string][]byte
	ttl    time.Duration
	fail   bool
}

func (c *memoryDeliveryCache) Get(_ context.Context, key string) ([]byte, error) {
	if c.fail {
		return nil, errors.New("unavailable")
	}
	return c.values[key], nil
}
func (c *memoryDeliveryCache) Set(_ context.Context, key string, value []byte, ttl time.Duration) error {
	if c.fail {
		return errors.New("unavailable")
	}
	c.values[key] = value
	c.ttl = ttl
	return nil
}

func TestInternalDeliveryCacheAndScope(t *testing.T) {
	cache := &memoryDeliveryCache{values: map[string][]byte{}}
	handler := deliveryTestRouter(cache)
	mint := func(workspace string) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(map[string]any{"items": []deliveryCapabilityItem{{TenantID: "tenant/a", WorkspaceID: workspace, AssetID: "asset", RevisionID: "revision"}}})
		req := httptest.NewRequest("POST", "/internal/delivery-capabilities:mint", strings.NewReader(string(raw)))
		if workspace != "" {
			req.Header.Set("X-Caller-Service", "knowledge")
			req.Header.Set("X-Internal-Token", "secret")
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		return res
	}
	if res := mint(""); res.Code != 403 {
		t.Fatalf("missing auth: %d", res.Code)
	}
	first := mint("workspace b")
	if first.Code != 200 {
		t.Fatalf("mint: %d %s", first.Code, first.Body)
	}
	var envelope struct {
		Items []DeliveryCapability `json:"items"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	capability := envelope.Items[0]
	if delta := time.Until(capability.ExpiresAt); delta < 6*time.Hour-5*time.Second || delta > 6*time.Hour {
		t.Fatalf("expiry: %v", delta)
	}
	if capability.MediaType != "text/plain" || capability.SizeBytes != 7 || len(cache.values) != 1 || cache.ttl <= 0 {
		t.Fatalf("metadata/cache: %+v %+v", capability, cache)
	}
	if second := mint("workspace b"); second.Body.String() != first.Body.String() {
		t.Fatalf("cache hit changed capability: %s", second.Body)
	}
	if res := mint("other"); res.Code != 404 {
		t.Fatalf("cached URL bypassed scope: %d", res.Code)
	}
	for key := range cache.values {
		stale := capability
		stale.ExpiresAt = time.Now().Add(30 * time.Second)
		stale.URL = "/stale"
		cache.values[key], _ = json.Marshal(stale)
	}
	if res := mint("workspace b"); res.Code != 200 || strings.Contains(res.Body.String(), "/stale") {
		t.Fatalf("near-expiry cache: %s", res.Body)
	}
	cache.fail = true
	if res := mint("workspace b"); res.Code != 200 {
		t.Fatalf("Redis failure blocked signing: %d", res.Code)
	}
	if first.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("capability response must not be cached by intermediaries")
	}
}

func TestSignedDeliveryRanges(t *testing.T) {
	handler := deliveryTestRouter(nil)
	router := &Router{signingKey: []byte("signing-secret"), deliveryTTL: 6 * time.Hour}
	expires := time.Now().Add(time.Hour).Unix()
	// URL encoding is exercised by the normal mint endpoint in the other tests.
	req := httptest.NewRequest("GET", "/media/asset/revisions/revision/content", nil)
	query := req.URL.Query()
	query.Set("tenant_id", "tenant/a")
	query.Set("workspace_id", "workspace b")
	query.Set("signature", router.signDelivery("tenant/a", "workspace b", "asset", "revision", expires))
	query.Set("expires", fmt.Sprint(expires))
	req.URL.RawQuery = query.Encode()
	for _, tc := range []struct {
		rangeValue, ifRange string
		status              int
		body, contentRange  string
	}{
		{"bytes=2-", "", 206, "yload", "bytes 2-6/7"},
		{"bytes=-3", "", 206, "oad", "bytes 4-6/7"},
		{"bytes=9-", "", 416, "", "bytes */7"},
		{"bytes=1-3", `"stale"`, 200, "payload", ""},
	} {
		t.Run(tc.rangeValue+tc.ifRange, func(t *testing.T) {
			r := req.Clone(context.Background())
			r.Header.Set("Range", tc.rangeValue)
			r.Header.Set("If-Range", tc.ifRange)
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, r)
			if res.Code != tc.status || res.Header().Get("Content-Range") != tc.contentRange {
				t.Fatalf("response: %d %v", res.Code, res.Header())
			}
			if tc.body != "" && res.Body.String() != tc.body {
				t.Fatalf("body: %s", res.Body)
			}
		})
	}
	multipart := req.Clone(context.Background())
	multipart.Header.Set("Range", "bytes=0-0,6-6")
	multiRes := httptest.NewRecorder()
	handler.ServeHTTP(multiRes, multipart)
	if multiRes.Code != 206 || !strings.HasPrefix(multiRes.Header().Get("Content-Type"), "multipart/byteranges;") || !strings.Contains(multiRes.Body.String(), "Content-Range: bytes 6-6/7") {
		t.Fatalf("multipart range: %d %v %s", multiRes.Code, multiRes.Header(), multiRes.Body)
	}
	download := req.Clone(context.Background())
	download.URL.RawQuery += "&download=1"
	downloadRes := httptest.NewRecorder()
	handler.ServeHTTP(downloadRes, download)
	if downloadRes.Code != 200 || !strings.HasPrefix(downloadRes.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatalf("download disposition: %d %v", downloadRes.Code, downloadRes.Header())
	}
	conditional := req.Clone(context.Background())
	conditional.Header.Set("If-None-Match", downloadRes.Header().Get("ETag"))
	notModified := httptest.NewRecorder()
	handler.ServeHTTP(notModified, conditional)
	if notModified.Code != 304 || notModified.Body.Len() != 0 {
		t.Fatalf("conditional: %d", notModified.Code)
	}

}

func deliveryTestRouter(cache DeliveryCache) http.Handler {
	service := application.NewService(deliveryRepository{}, deliveryBlobStore{}, deliveryClock{}, 1024)
	return NewRouter(service, nil, map[string]string{"knowledge": "secret"}, 1024, RouterOptions{DeliverySigningKey: "signing-secret", DeliveryCache: cache})
}

func TestWorkspaceIdentityCannotBypassBusinessAuthorization(t *testing.T) {
	handler := deliveryTestRouter(nil)
	for _, method := range []string{"GET", "POST"} {
		route := "/assets/asset/revisions/revision/content"
		if method == "POST" {
			route = "/assets/asset/revisions/revision/download-url"
		}
		req := httptest.NewRequest(method, route, nil)
		req.Header.Set("X-Auth-Tenant-ID", "tenant/a")
		req.Header.Set("X-Auth-Workspace-ID", "workspace b")
		req.Header.Set("X-Auth-User-ID", "other-user")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != 404 {
			t.Fatalf("unguarded public route: %d", res.Code)
		}
	}
}
