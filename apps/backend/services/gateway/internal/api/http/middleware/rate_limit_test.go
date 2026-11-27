package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestTrustedClientIPUsesLastForwardedHop(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("X-Forwarded-For", "198.51.100.10, 203.0.113.20")
	var key string
	handler := testHandler(TrustedClientIP(true), func(c *gin.Context) { key = rateLimitKey(c) })
	handler.ServeHTTP(httptest.NewRecorder(), request)
	if key != "ip:203.0.113.20" {
		t.Fatalf("rate limit key = %q", key)
	}
}
