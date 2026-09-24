package middleware

import "net/http"
import "strings"

func BodyLimit(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				limit := maxBytes
				if r.Method == http.MethodPost && strings.TrimSuffix(r.URL.Path, "/") == "/api/asset-server/assets" {
					// Asset enforces its own streaming payload limit. The small
					// multipart allowance covers boundaries and headers without
					// buffering the request in the gateway.
					limit = 5<<30 + 1<<20
				}
				r.Body = http.MaxBytesReader(w, r.Body, limit)
			}
			next.ServeHTTP(w, r)
		})
	}
}
