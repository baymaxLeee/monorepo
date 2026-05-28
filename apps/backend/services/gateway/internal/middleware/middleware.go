package middleware

import (
	"bufio"
	"log/slog"
	"net"
	"net/http"
	"time"
)

// RequestLogger logs each HTTP request with method, path, status, duration.
func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(ww, r)
		slog.Info("http",
			"trace_id", TraceIDFromContext(r.Context()),
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

// Recoverer recovers from panics and returns 500.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic recovered",
					"trace_id", TraceIDFromContext(r.Context()),
					"err", rec,
					"path", r.URL.Path,
				)
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// statusWriter records the HTTP status code while transparently passing
// every other ResponseWriter capability through to the wrapped writer.
//
// Specifically we MUST forward:
//
//   - http.Flusher    — without this, `httputil.ReverseProxy` can't detect
//                       that the downstream supports streaming, and SSE
//                       responses get buffered to EOF instead of being
//                       flushed per chunk. That breaks /api/chat-server's
//                       `text/event-stream` reply (request hangs in
//                       "pending" until the LLM finishes the whole answer).
//   - http.Hijacker   — websockets / connection upgrades.
//   - Unwrap()        — lets Go 1.20+ `http.ResponseController` reach the
//                       original writer for read/write deadline tweaks.
type statusWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (sw *statusWriter) WriteHeader(code int) {
	if sw.wroteHeader {
		return
	}
	sw.status = code
	sw.wroteHeader = true
	sw.ResponseWriter.WriteHeader(code)
}

func (sw *statusWriter) Write(b []byte) (int, error) {
	if !sw.wroteHeader {
		sw.wroteHeader = true
	}
	return sw.ResponseWriter.Write(b)
}

// Flush forwards to the underlying ResponseWriter when it supports
// http.Flusher. Critical for SSE: ReverseProxy probes for this interface
// before deciding to stream chunk-by-chunk.
func (sw *statusWriter) Flush() {
	if fl, ok := sw.ResponseWriter.(http.Flusher); ok {
		fl.Flush()
	}
}

// Hijack lets handlers upgrade the connection (e.g. for websockets).
func (sw *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := sw.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}

// Unwrap exposes the underlying writer so http.ResponseController can
// reach it (Go 1.20+ idiom). Without this, SetWriteDeadline / Flush from
// the controller would fail through the wrapper.
func (sw *statusWriter) Unwrap() http.ResponseWriter {
	return sw.ResponseWriter
}
