package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/example/monorepo/httpserver-go"
	"github.com/example/monorepo/telemetry/internal/application"
	"github.com/gin-gonic/gin"
)

const maxRequestBytes = 8 << 20

type Router struct {
	service *application.Service
}

func New(service *application.Service) http.Handler {
	transport := &Router{service: service}
	router := httpserver.New("telemetry")
	router.GET("/livez", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	router.GET("/readyz", transport.readiness)
	router.GET("/healthz", transport.readiness)
	router.POST("/rum/batch", transport.ingest)
	router.GET("/errors", transport.errors)
	router.GET("/performance", transport.performance)
	router.GET("/ops/observability", transport.observability)
	router.GET("/ops/traces", transport.traces)
	router.GET("/ops/traces/:trace_id", transport.trace)
	return router
}

func (router *Router) readiness(c *gin.Context) {
	writer, request := c.Writer, c.Request
	if err := router.service.Ping(request.Context()); err != nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"status": "degraded", "postgres": "down"})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"status": "ok", "postgres": "up"})
}

func (router *Router) ingest(c *gin.Context) {
	writer, request := c.Writer, c.Request
	var batch application.RumBatch
	if err := decodeJSON(writer, request, &batch); err != nil {
		writeValidation(writer, err)
		return
	}
	if err := router.service.Ingest(request.Context(), batch, optionalAuth(request)); err != nil {
		if isValidationError(err) {
			writeValidation(writer, err)
		} else {
			writeInternal(writer, request, err)
		}
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (router *Router) errors(c *gin.Context) {
	writer, request := c.Writer, c.Request
	auth, ok := requireAuth(writer, request)
	if !ok {
		return
	}
	limit, ok := queryInt(writer, request, "limit", 100, 1, 500)
	if !ok {
		return
	}
	response, err := router.service.Errors(request.Context(), auth, limit)
	if err != nil {
		writeInternal(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, response)
}

func (router *Router) performance(c *gin.Context) {
	writer, request := c.Writer, c.Request
	auth, ok := requireAuth(writer, request)
	if !ok {
		return
	}
	limit, ok := queryInt(writer, request, "limit", 200, 1, 1000)
	if !ok {
		return
	}
	response, err := router.service.Performance(request.Context(), auth, limit)
	if err != nil {
		writeInternal(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, response)
}

func (router *Router) observability(c *gin.Context) {
	writer, request := c.Writer, c.Request
	auth, ok := requireAdmin(writer, request)
	if !ok || !auth.IsAdmin() {
		return
	}
	writeJSON(writer, http.StatusOK, router.service.ObservabilityStatus(request.Context()))
}

func (router *Router) traces(c *gin.Context) {
	writer, request := c.Writer, c.Request
	if _, ok := requireAdmin(writer, request); !ok {
		return
	}
	limit, ok := queryInt(writer, request, "limit", 50, 1, 200)
	if !ok {
		return
	}
	minutes, ok := queryInt(writer, request, "minutes", 60, 5, 1440)
	if !ok {
		return
	}
	writeJSON(writer, http.StatusOK, router.service.Traces(request.Context(), limit, minutes))
}

func (router *Router) trace(c *gin.Context) {
	writer, request := c.Writer, c.Request
	if _, ok := requireAdmin(writer, request); !ok {
		return
	}
	response, err := router.service.Trace(request.Context(), c.Param("trace_id"))
	if err != nil {
		writeProblem(writer, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, response)
}

func optionalAuth(request *http.Request) application.AuthContext {
	userID := strings.TrimSpace(request.Header.Get("X-Auth-User-ID"))
	username := strings.TrimSpace(request.Header.Get("X-Auth-Name"))
	if username == "" {
		username = userID
	}
	return application.AuthContext{
		UserID: userID, Username: username, Email: strings.TrimSpace(request.Header.Get("X-Auth-Email")),
		ClientIP: clientIP(request), UserAgent: request.UserAgent(), Roles: parseRoles(request.Header.Get("X-Auth-Roles")),
	}
}

func requireAuth(writer http.ResponseWriter, request *http.Request) (application.AuthContext, bool) {
	auth := optionalAuth(request)
	if auth.UserID == "" {
		writeProblem(writer, http.StatusUnauthorized, "X-Auth-User-ID header is required")
		return application.AuthContext{}, false
	}
	return auth, true
}

func requireAdmin(writer http.ResponseWriter, request *http.Request) (application.AuthContext, bool) {
	auth, ok := requireAuth(writer, request)
	if !ok {
		return application.AuthContext{}, false
	}
	if !auth.IsAdmin() {
		writeProblem(writer, http.StatusForbidden, "super_admin is required")
		return application.AuthContext{}, false
	}
	return auth, true
}

func parseRoles(raw string) []string {
	roles := make([]string, 0)
	for _, role := range strings.Split(raw, ",") {
		if role = strings.TrimSpace(role); role != "" {
			roles = append(roles, role)
		}
	}
	return roles
}

func clientIP(request *http.Request) string {
	if forwarded := strings.TrimSpace(strings.Split(request.Header.Get("X-Forwarded-For"), ",")[0]); forwarded != "" {
		return forwarded
	}
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	return request.RemoteAddr
}

func queryInt(writer http.ResponseWriter, request *http.Request, name string, fallback, minimum, maximum int) (int, bool) {
	raw := request.URL.Query().Get(name)
	if raw == "" {
		return fallback, true
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minimum || value > maximum {
		writeValidation(writer, errors.New(name+" is out of range"))
		return 0, false
	}
	return value, true
}

func decodeJSON(writer http.ResponseWriter, request *http.Request, target any) error {
	request.Body = http.MaxBytesReader(writer, request.Body, maxRequestBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request body must contain one JSON value")
	}
	return nil
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeProblem(writer http.ResponseWriter, status int, detail string) {
	writeJSON(writer, status, map[string]any{"detail": detail})
}

func writeValidation(writer http.ResponseWriter, err error) {
	writeJSON(writer, http.StatusUnprocessableEntity, map[string]any{"detail": []map[string]any{{"loc": []any{"body"}, "msg": err.Error(), "type": "value_error"}}})
}

func writeInternal(writer http.ResponseWriter, request *http.Request, err error) {
	slog.ErrorContext(request.Context(), "telemetry request failed", "error", err, "method", request.Method, "path", request.URL.Path)
	writeProblem(writer, http.StatusInternalServerError, "internal server error")
}

func isValidationError(err error) bool {
	text := err.Error()
	return strings.Contains(text, "events") || strings.Contains(text, "batch field") || strings.Contains(text, "app must")
}
