package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	adminapi "github.com/example/monorepo/admin/internal/api/generated/adminapi"
	"github.com/example/monorepo/admin/internal/application"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Readiness interface {
	Check(context.Context) map[string]error
}

type Handler struct {
	adminapi.Unimplemented
	Readiness Readiness
	Providers application.ProviderService
	Apps      application.AppService
	Canvas    application.CanvasSettingsService
	Skills    application.SkillService
	Benefits  application.BenefitPackageService
	Plugins   application.AgentPluginService
}

func New(readiness Readiness, providers application.ProviderService, apps application.AppService, canvas application.CanvasSettingsService, skills application.SkillService, benefits application.BenefitPackageService, plugins application.AgentPluginService) http.Handler {
	h := &Handler{Readiness: readiness, Providers: providers, Apps: apps, Canvas: canvas, Skills: skills, Benefits: benefits, Plugins: plugins}
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer, requestLog)
	return adminapi.HandlerWithOptions(h, adminapi.ChiServerOptions{BaseRouter: r, ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
		writeError(w, application.BadRequest(err.Error()))
	}})
}
func requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		slog.InfoContext(r.Context(), "request completed", "method", r.Method, "path", r.URL.Path, "duration", time.Since(started))
	})
}
func (h *Handler) Livez(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
func (h *Handler) Readyz(w http.ResponseWriter, r *http.Request) {
	checks := h.Readiness.Check(r.Context())
	status := 200
	state := "ok"
	result := map[string]any{"status": state}
	for name, err := range checks {
		result[name] = upDown(err)
		if err != nil {
			status = 503
			state = "degraded"
		}
	}
	result["status"] = state
	writeJSON(w, status, result)
}
func (h *Handler) Healthz(w http.ResponseWriter, r *http.Request) { h.Readyz(w, r) }
func upDown(err error) string {
	if err == nil {
		return "up"
	}
	return "down"
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, err error) {
	var appErr *application.Error
	if !errors.As(err, &appErr) {
		slog.Error("admin request failed", "error", err)
		appErr = &application.Error{Status: 500, Code: "internal_error", Message: "internal server error"}
	}
	writeJSON(w, appErr.Status, map[string]any{"code": appErr.Code, "message": appErr.Message, "details": appErr.Details})
}
