package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/example/monorepo/api-gateway/internal/store"
)

// Healthz reports gateway and dependency health.
func Healthz(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		postgres := "up"
		redis := "up"
		if err := st.Postgres.Ping(ctx); err != nil {
			postgres = "down"
		}
		if err := st.Redis.Ping(ctx).Err(); err != nil {
			redis = "down"
		}

		status := "ok"
		code := http.StatusOK
		if postgres != "up" || redis != "up" {
			status = "degraded"
			code = http.StatusServiceUnavailable
		}
		writeJSON(w, code, map[string]string{
			"status":   status,
			"postgres": postgres,
			"redis":    redis,
		})
	}
}
