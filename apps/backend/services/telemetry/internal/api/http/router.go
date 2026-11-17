package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/example/monorepo/telemetry/internal/application"
	"github.com/go-chi/chi/v5"
	oteltrace "go.opentelemetry.io/otel/trace"
)

const maxRequestBytes = 8 << 20

type Router struct {
	service *application.Service
}

func New(service *application.Service) http.Handler {
	transport := &Router{service: service}
	router := chi.NewRouter()
	router.Use(traceID, requestLogging)
	router.Get("/livez", func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Get("/readyz", transport.readiness)
	router.Get("/healthz", transport.readiness)
	router.Post("/rum/batch", transport.ingest)
	router.Get("/errors", transport.errors)
	router.Get("/performance", transport.performance)
	router.Get("/ops/observability", transport.observability)
	router.Get("/ops/traces", transport.traces)
	router.Get("/ops/traces/{trace_id}", transport.trace)
	return router
}

func (router *Router) readiness(writer http.ResponseWriter, request *http.Request) {
	if err := router.service.Ping(request.Context()); err != nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"status": "degraded", "postgres": "down"})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"status": "ok", "postgres": "up"})
}

func (router *Router) ingest(writer http.ResponseWriter, request *http.Request) {
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

func (router *Router) errors(writer http.ResponseWriter, request *http.Request) {
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

func (router *Router) performance(writer http.ResponseWriter, request *http.Request) {
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

func (router *Router) observability(writer http.ResponseWriter, request *http.Request) {
	auth, ok := requireAdmin(writer, request)
	if !ok || !auth.IsAdmin() {
		return
	}
	writeJSON(writer, http.StatusOK, router.service.ObservabilityStatus(request.Context()))
}

func (router *Router) traces(writer http.ResponseWriter, request *http.Request) {
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

func (router *Router) trace(writer http.ResponseWriter, request *http.Request) {
	if _, ok := requireAdmin(writer, request); !ok {
		return
	}
	response, err := router.service.Trace(request.Context(), chi.URLParam(request, "trace_id"))
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

type responseRecorder struct {
	http.ResponseWriter
	status int
}

func (recorder *responseRecorder) WriteHeader(status int) {
	recorder.status = status
	recorder.ResponseWriter.WriteHeader(status)
}

func requestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		started := time.Now()
		recorder := &responseRecorder{ResponseWriter: writer, status: http.StatusOK}
		next.ServeHTTP(recorder, request)
		slog.InfoContext(request.Context(), "http request", "method", request.Method, "path", request.URL.Path,
			"status", recorder.status, "duration_ms", time.Since(started).Milliseconds())
	})
}

func traceID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		trace := ""
		if spanContext := oteltrace.SpanContextFromContext(request.Context()); spanContext.IsValid() {
			trace = spanContext.TraceID().String()
		}
		if trace == "" {
			trace = traceIDFromTraceParent(request.Header.Get("traceparent"))
		}
		if trace == "" {
			trace = normalizeTraceID(request.Header.Get("X-Trace-Id"))
		}
		if trace == "" {
			var value [16]byte
			if _, err := rand.Read(value[:]); err == nil {
				trace = hex.EncodeToString(value[:])
			} else {
				trace = strings.Repeat("0", 32)
			}
		}
		request.Header.Set("X-Trace-Id", trace)
		writer.Header().Set("X-Trace-Id", trace)
		next.ServeHTTP(writer, request)
	})
}

func traceIDFromTraceParent(value string) string {
	parts := strings.Split(strings.TrimSpace(value), "-")
	if len(parts) != 4 || parts[0] != "00" || len(parts[2]) != 16 || len(parts[3]) != 2 {
		return ""
	}
	return normalizeTraceID(parts[1])
}

func normalizeTraceID(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) != 32 || value == strings.Repeat("0", 32) {
		return ""
	}
	if _, err := hex.DecodeString(value); err != nil {
		return ""
	}
	return value
}
