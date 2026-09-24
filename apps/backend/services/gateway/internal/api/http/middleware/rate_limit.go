package middleware

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"
	"github.com/redis/go-redis/v9"
)

var rateLimitSkipPaths = map[string]bool{"/livez": true, "/readyz": true, "/healthz": true}

var incrementRateLimit = redis.NewScript(`
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return current
`)

func RateLimit(client redis.UniversalClient, requestLimit int, window time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if rateLimitSkipPaths[r.URL.Path] {
				next.ServeHTTP(w, r)
				return
			}
			key := rateLimitKey(r)
			windowStart := time.Now().UTC().Truncate(window)
			redisKey := "gateway:rate-limit:" + strconv.FormatInt(windowStart.UnixNano(), 10) + ":" + key
			count, err := incrementRateLimit.Run(
				r.Context(), client, []string{redisKey}, window.Milliseconds(),
			).Int64()
			if err != nil {
				rateLimitUnavailable(w)
				return
			}
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(requestLimit))
			w.Header().Set("X-RateLimit-Remaining", strconv.FormatInt(max(0, int64(requestLimit)-count), 10))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(windowStart.Add(window).Unix(), 10))
			if count > int64(requestLimit) {
				w.Header().Set("Retry-After", strconv.Itoa(max(1, int(time.Until(windowStart.Add(window)).Seconds()))))
				rateLimitExceeded(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func rateLimitKey(r *http.Request) string {
	if userID := r.Header.Get(HeaderAuthUserID); userID != "" {
		return "user:" + userID
	}
	ip := chimiddleware.GetClientIP(r.Context())
	if ip == "" {
		return "unresolved"
	}
	return "ip:" + httprate.CanonicalizeIP(ip)
}

func rateLimitExceeded(w http.ResponseWriter, _ *http.Request) {
	writeRateLimitProblem(w, http.StatusTooManyRequests, "Too Many Requests", "请求过于频繁，请稍后再试")
}

func rateLimitUnavailable(w http.ResponseWriter) {
	writeRateLimitProblem(w, http.StatusServiceUnavailable, "Service Unavailable", "请求限流服务暂时不可用")
}

func writeRateLimitProblem(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type": "about:blank", "title": title, "status": status, "detail": detail,
	})
}

func TrustedClientIP(deployed bool) func(http.Handler) http.Handler {
	if deployed {
		return chimiddleware.ClientIPFromXFFTrustedProxies(1)
	}
	return chimiddleware.ClientIPFromRemoteAddr
}

func SessionOriginGuard(allowedOrigins []string, deployed bool) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		if origin != "*" {
			allowed[origin] = struct{}{}
		}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if deployed && r.Method == http.MethodPost &&
				(r.URL.Path == "/api/iam-server/refresh" || r.URL.Path == "/api/iam-server/logout") {
				origin := r.Header.Get("Origin")
				if _, ok := allowed[origin]; !ok {
					http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
