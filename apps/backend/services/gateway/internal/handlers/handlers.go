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
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func Index(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"service": "gateway",
		"docs":    "/healthz | /api/iam-server/* | /api/admin-server/*",
	})
}

func NewServiceProxy(upstream, service, externalPrefix string) http.Handler {
	return &internalPathGuard{
		inner:          newReverseProxy(upstream, service, externalPrefix),
		externalPrefix: externalPrefix,
	}
}

// internalPathGuard rejects a service's `/internal/*` subtree at the edge.
// Those routes trust the shared S2S token and are meant to be reachable only
// from sibling services on the cluster network (e.g. admin returns decrypted
// provider secrets there) — the gateway must never forward them regardless of
// what a client sends, so this runs before the request reaches the proxy.
type internalPathGuard struct {
	inner          http.Handler
	externalPrefix string
}

func (g *internalPathGuard) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if isInternalPath(stripServicePrefix(r.URL.Path, g.externalPrefix)) {
		writeProblem(w, http.StatusNotFound, "not_found", "the requested resource was not found")
		return
	}
	g.inner.ServeHTTP(w, r)
}

func isInternalPath(path string) bool {
	return path == "/internal" || strings.HasPrefix(path, "/internal/")
}

func newReverseProxy(upstream, service, externalPrefix string) http.Handler {
	target, err := url.Parse(strings.TrimRight(upstream, "/"))
	if err != nil {
		panic("invalid " + service + " upstream url: " + err.Error())
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = otelhttp.NewTransport(http.DefaultTransport)
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
	proxy.FlushInterval = -1
	return &streamingProxy{inner: proxy}
}

type streamingProxy struct {
	inner http.Handler
}

func (s *streamingProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Proxied SSE (agent runs) and multipart ingest routinely outlive the
	// server-wide Read/WriteTimeout. Clearing only the write deadline still let
	// ReadTimeout fire on the background connection read mid-stream, cancelling
	// the upstream request context (context canceled -> 502). Both deadlines
	// must be cleared so a proxied request's lifetime is bounded by the upstream.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
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

func writeProblem(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":   "about:blank",
		"title":  title,
		"detail": detail,
		"status": status,
	})
}
