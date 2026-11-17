package httpapi

import (
	"context"
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

func TestSignedDeliveryRanges(t *testing.T) {
	handler := deliveryTestRouter()
	router := &Router{signingKey: []byte("signing-secret")}
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

func deliveryTestRouter() http.Handler {
	service := application.NewService(deliveryRepository{}, deliveryBlobStore{}, deliveryClock{}, 1024)
	return NewRouter(service, nil, 1024, RouterOptions{DeliverySigningKey: "signing-secret"})
}

func TestWorkspaceIdentityCannotBypassBusinessAuthorization(t *testing.T) {
	handler := deliveryTestRouter()
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
