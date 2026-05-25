package middleware

import (
	"net/http"
	"net/url"
	"strconv"
)

// preflightMaxAgeSeconds tells the browser to cache the preflight result for
// up to this many seconds. Chrome caps at 7200 (2h), Firefox at 86400 (24h);
// we send 86400 and let each browser apply its own ceiling. Within the cache
// window, repeated requests with the same method+headers SKIP the OPTIONS
// preflight entirely.
const preflightMaxAgeSeconds = 86400

func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[origin] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if _, ok := allowed[origin]; ok || isLocalDevOrigin(origin) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Vary", "Origin")
			}
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Trace-Id, traceparent, baggage")
			w.Header().Set("Access-Control-Expose-Headers", "X-Trace-Id, traceparent")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Max-Age", strconv.Itoa(preflightMaxAgeSeconds))
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
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
