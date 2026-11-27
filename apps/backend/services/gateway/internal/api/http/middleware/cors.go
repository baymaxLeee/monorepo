package middleware

import (
	"net/http"
	"net/url"
	"strconv"

	"github.com/gin-gonic/gin"
)

const preflightMaxAgeSeconds = 86400

func CORS(allowedOrigins []string, allowLocalDev bool) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	echoAny := false
	for _, origin := range allowedOrigins {
		if origin == "*" {
			echoAny = true
			continue
		}
		allowed[origin] = struct{}{}
	}
	return func(c *gin.Context) {
		w, r := c.Writer, c.Request
		origin := r.Header.Get("Origin")
		_, listed := allowed[origin]
		if origin != "" && (listed || echoAny || (allowLocalDev && isLocalDevOrigin(origin))) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, traceparent, tracestate, baggage, Last-Event-ID")
		w.Header().Set("Access-Control-Expose-Headers", "traceparent, X-Canvas-Cursor")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Max-Age", strconv.Itoa(preflightMaxAgeSeconds))
		if r.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func isLocalDevOrigin(origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if parsed.Scheme != "http" {
		return false
	}
	return parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1"
}
