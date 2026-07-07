package middleware

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/httprate"
)

// rateLimitSkipPaths are liveness/readiness probes; k8s hits them frequently and
// must never be throttled or a pod looks unhealthy under load.
var rateLimitSkipPaths = map[string]bool{"/livez": true, "/readyz": true, "/healthz": true}

// RateLimit is an edge fixed-window limiter keyed per authenticated user, falling
// back to client IP for unauthenticated traffic (so login/refresh brute force is
// still bounded). It counts a request once at initiation, so proxied SSE/streaming
// is unaffected. Multi-replica deployments should move the counter to Redis; this
// in-memory limiter is correct for single-instance / demo.
func RateLimit(requestLimit int, window time.Duration) func(http.Handler) http.Handler {
	limiter := httprate.Limit(
		requestLimit,
		window,
		httprate.WithKeyFuncs(rateLimitKey),
		httprate.WithLimitHandler(rateLimitExceeded),
	)
	return func(next http.Handler) http.Handler {
		limited := limiter(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if rateLimitSkipPaths[r.URL.Path] {
				next.ServeHTTP(w, r)
				return
			}
			limited.ServeHTTP(w, r)
		})
	}
}

func rateLimitKey(r *http.Request) (string, error) {
	if userID := r.Header.Get(HeaderAuthUserID); userID != "" {
		return "user:" + userID, nil
	}
	ip, err := httprate.KeyByIP(r)
	if err != nil {
		return "", err
	}
	return "ip:" + ip, nil
}

// rateLimitExceeded returns problem+json so the frontend axios interceptor can
// surface `detail`. httprate has already set X-RateLimit-* and Retry-After.
func rateLimitExceeded(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusTooManyRequests)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":   "about:blank",
		"title":  "Too Many Requests",
		"status": http.StatusTooManyRequests,
		"detail": "请求过于频繁，请稍后再试",
	})
}
