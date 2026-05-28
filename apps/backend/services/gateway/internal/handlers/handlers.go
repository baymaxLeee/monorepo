package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/example/monorepo/gateway/internal/middleware"
)

func Index(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"service": "gateway",
		"docs":    "/healthz | /api/iam-server/* | /api/admin-server/*",
	})
}

// NewServiceProxy returns a reverse proxy that strips the external service
// prefix before forwarding to the upstream service.
func NewServiceProxy(upstream, service, externalPrefix string) http.Handler {
	return newReverseProxy(upstream, service, externalPrefix)
}

func newReverseProxy(upstream, service, externalPrefix string) http.Handler {
	target, err := url.Parse(strings.TrimRight(upstream, "/"))
	if err != nil {
		panic("invalid " + service + " upstream url: " + err.Error())
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		incomingPath := req.URL.Path
		originalDirector(req)
		req.URL.Path = stripServicePrefix(incomingPath, externalPrefix)
		req.URL.RawPath = ""
		req.Host = target.Host
		slog.Info("proxy",
			"trace_id", middleware.TraceIDFromContext(req.Context()),
			"service", service,
			"to", target.String()+req.URL.Path,
			"from_path", incomingPath,
		)
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		slog.Error("proxy_error",
			"trace_id", middleware.TraceIDFromContext(r.Context()),
			"err", err,
			"url", r.URL.String(),
		)
		http.Error(w, "upstream unavailable: "+err.Error(), http.StatusBadGateway)
	}
	// Belt-and-suspenders for streaming: explicitly tell ReverseProxy to
	// flush as soon as data is available. The default is "auto" which
	// already does the right thing for `text/event-stream` IF the
	// underlying ResponseWriter exposes http.Flusher — but we set it
	// negative anyway so anything else that's interactive (chunked JSON,
	// MJPEG, …) doesn't get buffered either.
	proxy.FlushInterval = -1
	return &streamingProxy{inner: proxy}
}

// streamingProxy wraps a ReverseProxy and disables the per-request write
// deadline so long-running SSE / chunked replies aren't cut off by the
// global `http.Server.WriteTimeout`. ResponseController is the Go 1.20+
// blessed way to mutate per-request deadlines — it walks Unwrap() chains
// transparently, which is why `statusWriter` implements Unwrap.
type streamingProxy struct {
	inner http.Handler
}

func (s *streamingProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rc := http.NewResponseController(w)
	// Best-effort: not every ResponseWriter supports deadline control
	// (e.g. test recorders). Ignore the ErrNotSupported case silently.
	_ = rc.SetWriteDeadline(time.Time{})
	s.inner.ServeHTTP(w, r)
}

func stripServicePrefix(path, prefix string) string {
	next := strings.TrimPrefix(path, prefix)
	if next == "" {
		return "/"
	}
	if !strings.HasPrefix(next, "/") {
		return "/" + next
	}
	return next
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
