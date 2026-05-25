package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/example/monorepo/gateway/internal/store"
)

// Livez confirms only that the HTTP server is responsive. K8s liveness
// probes use this — failing it RESTARTS the container, so it must not
// depend on MySQL/Redis (a transient DB blip should never kill the pod).
func Livez(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Healthz reports gateway and dependency health. Also serves as the
// readiness probe (/readyz) — failing it removes the pod from the Service
// without killing it.
func Healthz(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		mysql := "up"
		redis := "up"
		if err := st.MySQL.PingContext(ctx); err != nil {
			mysql = "down"
		}
		if err := st.Redis.Ping(ctx).Err(); err != nil {
			redis = "down"
		}

		status := "ok"
		code := http.StatusOK
		if mysql != "up" || redis != "up" {
			status = "degraded"
			code = http.StatusServiceUnavailable
		}
		writeJSON(w, code, map[string]string{
			"status": status,
			"mysql":  mysql,
			"redis":  redis,
		})
	}
}
