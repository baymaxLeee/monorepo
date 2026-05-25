package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

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
	return proxy
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
