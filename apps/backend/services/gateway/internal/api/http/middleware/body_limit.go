package middleware

import "net/http"
import "strings"

func BodyLimit(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				limit := maxBytes
				if r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/storage-server/upload-sessions/") && strings.HasSuffix(r.URL.Path, "/content") {
					// Storage enforces the authorized session size while streaming.
					limit = 5 << 30
				}
				r.Body = http.MaxBytesReader(w, r.Body, limit)
			}
			next.ServeHTTP(w, r)
		})
	}
}
