package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
)

const HeaderTraceID = "X-Trace-Id"
const HeaderTraceParent = "traceparent"

type traceIDContextKey struct{}

// TraceId normalizes the request trace id and propagates it to responses and upstreams.
func TraceId(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceParent := normalizeTraceParent(r.Header.Get(HeaderTraceParent))
		traceID := ""
		if traceParent != "" {
			traceID = traceIDFromTraceParent(traceParent)
		}
		if traceID == "" {
			traceID = normalizeTraceID(r.Header.Get(HeaderTraceID))
		}
		if traceID == "" {
			traceID = newTraceID()
		}
		if traceParent == "" {
			traceParent = newTraceParent(traceID)
		}

		r.Header.Set(HeaderTraceID, traceID)
		r.Header.Set(HeaderTraceParent, traceParent)
		w.Header().Set(HeaderTraceID, traceID)
		w.Header().Set(HeaderTraceParent, traceParent)

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
	if len(value) != 32 || !isHex(value) {
		return ""
	}
	return strings.ToLower(value)
}

func newTraceID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "00000000000000000000000000000000"
	}
	return hex.EncodeToString(b[:])
}

func newTraceParent(traceID string) string {
	var span [8]byte
	if _, err := rand.Read(span[:]); err != nil {
		return "00-" + traceID + "-0000000000000000-01"
	}
	return "00-" + traceID + "-" + hex.EncodeToString(span[:]) + "-01"
}

func normalizeTraceParent(value string) string {
	value = strings.TrimSpace(value)
	parts := strings.Split(value, "-")
	if len(parts) != 4 {
		return ""
	}
	if parts[0] != "00" || len(parts[1]) != 32 || len(parts[2]) != 16 || len(parts[3]) != 2 {
		return ""
	}
	if parts[1] == "00000000000000000000000000000000" || parts[2] == "0000000000000000" {
		return ""
	}
	if !isHex(parts[1]) || !isHex(parts[2]) || !isHex(parts[3]) {
		return ""
	}
	return strings.ToLower(value)
}

func traceIDFromTraceParent(value string) string {
	parts := strings.Split(value, "-")
	if len(parts) != 4 {
		return ""
	}
	return strings.ToLower(parts[1])
}

func isHex(value string) bool {
	for _, r := range value {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') {
			continue
		}
		return false
	}
	return true
}
