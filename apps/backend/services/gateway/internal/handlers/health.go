package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/example/monorepo/gateway/internal/store"
)

func Livez(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

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
