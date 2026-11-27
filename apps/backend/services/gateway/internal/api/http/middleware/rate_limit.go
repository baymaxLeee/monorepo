package middleware

import (
	"encoding/json"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

var rateLimitSkipPaths = map[string]bool{"/livez": true, "/readyz": true, "/healthz": true}

const clientIPKey = "client_ip"

var incrementRateLimit = redis.NewScript(`
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return current
`)

func RateLimit(client redis.UniversalClient, requestLimit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		w, r := c.Writer, c.Request
		if rateLimitSkipPaths[r.URL.Path] {
			c.Next()
			return
		}
		key := rateLimitKey(c)
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
		c.Next()
	}
}

func rateLimitKey(c *gin.Context) string {
	r := c.Request
	if userID := r.Header.Get(HeaderAuthUserID); userID != "" {
		return "user:" + userID
	}
	ip, _ := c.Get(clientIPKey)
	address, _ := ip.(netip.Addr)
	if address.IsValid() {
		return "ip:" + address.Unmap().String()
	}
	return "unresolved"
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

func TrustedClientIP(deployed bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		r := c.Request
		var value string
		if deployed {
			entries := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
			for index := len(entries) - 1; index >= 0; index-- {
				if value = strings.TrimSpace(entries[index]); value != "" {
					break
				}
			}
		} else if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
			value = host
		}
		if ip, err := netip.ParseAddr(strings.Trim(value, "[]")); err == nil {
			c.Set(clientIPKey, ip.Unmap())
		}
		c.Next()
	}
}

func SessionOriginGuard(allowedOrigins []string, deployed bool) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		if origin != "*" {
			allowed[origin] = struct{}{}
		}
	}
	return func(c *gin.Context) {
		r := c.Request
		if deployed && r.Method == http.MethodPost &&
			(r.URL.Path == "/api/iam-server/refresh" || r.URL.Path == "/api/iam-server/logout") {
			origin := r.Header.Get("Origin")
			if _, ok := allowed[origin]; !ok {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": http.StatusText(http.StatusForbidden)})
				return
			}
		}
		c.Next()
	}
}
