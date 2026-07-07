package middleware

import (
	"bufio"
	"log/slog"
	"net"
	"net/http"
	"time"
)

var logSkipPaths = map[string]bool{"/livez": true, "/readyz": true, "/healthz": true}

// correlationAttrs collects the propagated identifiers for a log line: trace_id
// from the request context plus identity headers (user_id today, workspace/tenant
// reserved). Adding a propagated field is one entry here.
func correlationAttrs(r *http.Request) []any {
	attrs := make([]any, 0, 8)
	if traceID := TraceIDFromContext(r.Context()); traceID != "" {
		attrs = append(attrs, "trace_id", traceID)
	}
	if userID := r.Header.Get(HeaderAuthUserID); userID != "" {
		attrs = append(attrs, "user_id", userID)
	}
	return attrs
}

func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if logSkipPaths[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		ww := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(ww, r)
		attrs := append(correlationAttrs(r),
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
		slog.Info("http", attrs...)
	})
}

func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				attrs := append(correlationAttrs(r), "err", rec, "path", r.URL.Path)
				slog.Error("panic recovered", attrs...)
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

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

func (sw *statusWriter) Flush() {
	if fl, ok := sw.ResponseWriter.(http.Flusher); ok {
		fl.Flush()
	}
}

func (sw *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := sw.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}

func (sw *statusWriter) Unwrap() http.ResponseWriter {
	return sw.ResponseWriter
}
