package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/example/monorepo/chat/internal/application"
	"github.com/go-chi/chi/v5"
)

type authContextKey struct{}

type Router struct {
	service   *application.Service
	readiness *readiness
}

func New(service *application.Service) http.Handler {
	transport := &Router{service: service, readiness: newReadiness()}
	router := chi.NewRouter()
	router.Use(traceID, requestLogging)
	router.Get("/healthz", func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Get("/livez", transport.liveness)
	router.Get("/readyz", transport.ready)

	router.Group(func(api chi.Router) {
		api.Use(transport.requireReady, requireAuth)
		api.Route("/conversations", func(conversations chi.Router) {
			conversations.Get("/", transport.listConversations)
			conversations.Post("/", transport.createConversation)
			conversations.Post("/canvas", transport.createCanvasConversation)
			conversations.Get("/{conversationID}", transport.getConversation)
			conversations.Patch("/{conversationID}", transport.updateConversation)
			conversations.Delete("/{conversationID}", transport.deleteConversation)
			conversations.Post("/{conversationID}/forks", transport.forkConversation)
			conversations.HandleFunc("/{conversationID}/*", transport.proxyConversation)
		})
		api.HandleFunc("/memories", transport.proxyRuntime)
		api.HandleFunc("/memories/*", transport.proxyRuntime)
		api.HandleFunc("/local-inference/*", transport.proxyRuntime)
	})

	go func() {
		if err := service.Ping(context.Background()); err != nil {
			transport.readiness.failed(err)
			slog.Error("chat bootstrap failed", "error", err)
			return
		}
		transport.readiness.ready()
		slog.Info("chat bootstrap complete")
	}()
	return recoverErrors(router)
}

func (router *Router) liveness(writer http.ResponseWriter, _ *http.Request) {
	state, _ := router.readiness.current()
	status := http.StatusOK
	value := "ok"
	if state == "failed" {
		status, value = http.StatusServiceUnavailable, "failed"
	}
	writeJSON(writer, status, map[string]string{"status": value})
}

func (router *Router) ready(writer http.ResponseWriter, request *http.Request) {
	state, bootError := router.readiness.current()
	if state != "ready" {
		result := map[string]any{"ok": false, "boot": state, "postgres": "down"}
		if bootError != "" {
			result["error"] = bootError
		}
		writeJSON(writer, http.StatusServiceUnavailable, result)
		return
	}
	if err := router.service.Ping(request.Context()); err != nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"ok": false, "boot": "ready", "postgres": "down"})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "boot": "ready", "postgres": "up"})
}

func (router *Router) requireReady(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		state, _ := router.readiness.current()
		if state != "ready" {
			writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"code": "service_starting", "message": "chat service is not ready"})
			return
		}
		next.ServeHTTP(writer, request)
	})
}

func requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		scope := application.AuthContext{
			UserID:      strings.TrimSpace(request.Header.Get("X-Auth-User-ID")),
			TenantID:    strings.TrimSpace(request.Header.Get("X-Auth-Tenant-ID")),
			WorkspaceID: strings.TrimSpace(request.Header.Get("X-Auth-Workspace-ID")),
		}
		if scope.UserID == "" || scope.TenantID == "" || scope.WorkspaceID == "" {
			writeJSON(writer, http.StatusUnauthorized, map[string]string{"code": "unauthorized", "message": "missing auth context"})
			return
		}
		next.ServeHTTP(writer, request.WithContext(context.WithValue(request.Context(), authContextKey{}, scope)))
	})
}

func (router *Router) listConversations(writer http.ResponseWriter, request *http.Request) {
	value, err := router.service.List(request.Context(), auth(request))
	writeResult(writer, request, http.StatusOK, value, err)
}

func (router *Router) createConversation(writer http.ResponseWriter, request *http.Request) {
	input, err := decodeCreateInput(request)
	if err != nil {
		writeError(writer, request, err)
		return
	}
	value, err := router.service.Create(request.Context(), auth(request), request.Header, input)
	writeResult(writer, request, http.StatusCreated, value, err)
}

func (router *Router) createCanvasConversation(writer http.ResponseWriter, request *http.Request) {
	input, err := decodeCreateInput(request)
	if err != nil {
		writeError(writer, request, err)
		return
	}
	value, err := router.service.CreateCanvas(request.Context(), auth(request), request.Header, input)
	writeResult(writer, request, http.StatusCreated, value, err)
}

func (router *Router) getConversation(writer http.ResponseWriter, request *http.Request) {
	value, err := router.service.Get(request.Context(), auth(request), request.Header, chi.URLParam(request, "conversationID"))
	writeResult(writer, request, http.StatusOK, value, err)
}

func (router *Router) updateConversation(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Title string `json:"title"`
	}
	if err := decodeJSON(request, &input); err != nil || utf8.RuneCountInString(input.Title) < 1 || utf8.RuneCountInString(input.Title) > 200 {
		writeInvalidRequest(writer)
		return
	}
	value, err := router.service.Update(request.Context(), auth(request), chi.URLParam(request, "conversationID"), input.Title)
	writeResult(writer, request, http.StatusOK, value, err)
}

func (router *Router) deleteConversation(writer http.ResponseWriter, request *http.Request) {
	err := router.service.Delete(request.Context(), auth(request), request.Header, chi.URLParam(request, "conversationID"))
	if err != nil {
		writeError(writer, request, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (router *Router) forkConversation(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		MessageID string `json:"message_id"`
	}
	if err := decodeJSON(request, &input); err != nil || utf8.RuneCountInString(input.MessageID) < 1 || utf8.RuneCountInString(input.MessageID) > 32 {
		writeInvalidRequest(writer)
		return
	}
	value, err := router.service.Fork(request.Context(), auth(request), request.Header, chi.URLParam(request, "conversationID"), input.MessageID)
	writeResult(writer, request, http.StatusCreated, value, err)
}

func (router *Router) proxyConversation(writer http.ResponseWriter, request *http.Request) {
	suffix := chi.URLParam(request, "*")
	if suffix != "" && !strings.HasPrefix(suffix, "/") {
		suffix = "/" + suffix
	}
	response, err := router.service.ProxyConversation(
		request.Context(), auth(request), request.Header, request.Method, chi.URLParam(request, "conversationID"),
		suffix, request.URL.RawQuery, request.Body,
	)
	writeProxyResponse(writer, request, response, err)
}

func (router *Router) proxyRuntime(writer http.ResponseWriter, request *http.Request) {
	response, err := router.service.ProxyRuntime(request.Context(), request.Header, request.Method, request.URL.Path, request.URL.RawQuery, request.Body)
	writeProxyResponse(writer, request, response, err)
}

func decodeCreateInput(request *http.Request) (application.CreateConversationInput, error) {
	var input application.CreateConversationInput
	if err := decodeJSON(request, &input); err != nil {
		return input, invalidRequestError()
	}
	if length := utf8.RuneCountInString(input.RequestID); length < 8 || length > 64 {
		return input, invalidRequestError()
	}
	for _, field := range []struct {
		value *string
		max   int
		min   int
	}{{input.Title, 200, 1}, {input.ProviderID, 32, 0}, {input.ProjectID, 36, 0}, {input.CanvasID, 36, 0}} {
		if field.value != nil {
			length := utf8.RuneCountInString(*field.value)
			if length < field.min || length > field.max {
				return input, invalidRequestError()
			}
		}
	}
	return input, nil
}

func decodeJSON(request *http.Request, target any) error {
	decoder := json.NewDecoder(request.Body)
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON value")
	}
	return nil
}

func invalidRequestError() error {
	return &application.Error{Status: http.StatusBadRequest, Code: "invalid_request", Message: "request validation failed"}
}

func writeInvalidRequest(writer http.ResponseWriter) { writeError(writer, nil, invalidRequestError()) }

func auth(request *http.Request) application.AuthContext {
	return request.Context().Value(authContextKey{}).(application.AuthContext)
}

func writeResult(writer http.ResponseWriter, request *http.Request, status int, value any, err error) {
	if err != nil {
		writeError(writer, request, err)
		return
	}
	writeJSON(writer, status, value)
}

func writeError(writer http.ResponseWriter, request *http.Request, err error) {
	var runtimeError *application.RuntimeResponseError
	if errors.As(err, &runtimeError) {
		writeUpstream(writer, runtimeError.Response)
		return
	}
	var applicationError *application.Error
	if errors.As(err, &applicationError) {
		writeJSON(writer, applicationError.Status, map[string]string{"code": applicationError.Code, "message": applicationError.Message})
		return
	}
	if request != nil {
		slog.ErrorContext(request.Context(), "chat request failed", "error", err, "method", request.Method, "path", request.URL.Path)
	}
	writeJSON(writer, http.StatusInternalServerError, map[string]string{"code": "internal_error", "message": "internal server error"})
}

func writeProxyResponse(writer http.ResponseWriter, request *http.Request, response *http.Response, err error) {
	if err != nil {
		writeError(writer, request, err)
		return
	}
	writeUpstream(writer, response)
}

func writeUpstream(writer http.ResponseWriter, response *http.Response) {
	if response.Body != nil {
		defer response.Body.Close()
	}
	for name, values := range response.Header {
		for _, value := range values {
			writer.Header().Add(name, value)
		}
	}
	writer.WriteHeader(response.StatusCode)
	if response.Body == nil {
		return
	}
	if strings.Contains(response.Header.Get("Content-Type"), "text/event-stream") {
		copyStreaming(writer, response.Body)
		return
	}
	_, _ = io.Copy(writer, response.Body)
}

func copyStreaming(writer http.ResponseWriter, body io.Reader) {
	buffer := make([]byte, 32*1024)
	controller := http.NewResponseController(writer)
	for {
		read, readErr := body.Read(buffer)
		if read > 0 {
			if _, err := writer.Write(buffer[:read]); err != nil {
				return
			}
			_ = controller.Flush()
		}
		if readErr != nil {
			return
		}
	}
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func recoverErrors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.ErrorContext(request.Context(), "chat handler panicked", "panic", recovered)
				writeJSON(writer, http.StatusInternalServerError, map[string]string{"code": "internal_error", "message": "internal server error"})
			}
		}()
		next.ServeHTTP(writer, request)
	})
}

type responseRecorder struct {
	http.ResponseWriter
	status int
}

func (recorder *responseRecorder) WriteHeader(status int) {
	recorder.status = status
	recorder.ResponseWriter.WriteHeader(status)
}

func (recorder *responseRecorder) Flush() {
	if flusher, ok := recorder.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
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
		value := strings.TrimSpace(request.Header.Get("X-Trace-Id"))
		if value == "" {
			bytes := make([]byte, 16)
			if _, err := rand.Read(bytes); err == nil {
				value = hex.EncodeToString(bytes)
			}
		}
		if value != "" {
			writer.Header().Set("X-Trace-Id", value)
			request.Header.Set("X-Trace-Id", value)
		}
		next.ServeHTTP(writer, request)
	})
}
