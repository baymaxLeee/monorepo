package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
)

const HeaderTraceID = "X-Trace-Id"

type traceIDContextKey struct{}

// TraceId normalizes the request trace id and propagates it to responses and upstreams.
func TraceId(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceID := normalizeTraceID(r.Header.Get(HeaderTraceID))
		if traceID == "" {
			traceID = newTraceID()
		}

		r.Header.Set(HeaderTraceID, traceID)
		w.Header().Set(HeaderTraceID, traceID)

		ctx := context.WithValue(r.Context(), traceIDContextKey{}, traceID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func TraceIDFromContext(ctx context.Context) string {
	if traceID, ok := ctx.Value(traceIDContextKey{}).(string); ok {
		return traceID
	}
	return ""
}

func normalizeTraceID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) == 0 || len(value) > 128 {
		return ""
	}
	for _, r := range value {
		if r <= 32 || r == 127 {
			return ""
		}
	}
	return value
}

func newTraceID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "00000000000000000000000000000000"
	}
	return hex.EncodeToString(b[:])
}
