package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

func Index(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"service": "api-gateway",
		"docs":    "/healthz | /v1/auth | /v1/bots",
	})
}

// NewAdminProxy returns a reverse proxy to the admin service.
// chi.Mount preserves the URL path, so we just forward as-is.
func NewAdminProxy(upstream string) http.Handler {
	return newReverseProxy(upstream, "admin")
}

func NewIdentityProxy(upstream string) http.Handler {
	return newReverseProxy(upstream, "identity")
}

func newReverseProxy(upstream, service string) http.Handler {
	target, err := url.Parse(strings.TrimRight(upstream, "/"))
	if err != nil {
		panic("invalid " + service + " upstream url: " + err.Error())
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		incomingPath := req.URL.Path
		originalDirector(req)
		req.Host = target.Host
		slog.Info("proxy",
			"service", service,
			"to", target.String()+req.URL.Path,
			"from_path", incomingPath,
		)
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		slog.Error("proxy_error", "err", err, "url", r.URL.String())
		http.Error(w, "upstream unavailable: "+err.Error(), http.StatusBadGateway)
	}
	return proxy
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
