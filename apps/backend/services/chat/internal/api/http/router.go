package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/example/monorepo/chat/internal/application"
	"github.com/example/monorepo/httpserver-go"
	"github.com/gin-gonic/gin"
)

type authContextKey struct{}

type Router struct {
	service   *application.Service
	readiness *readiness
}

func New(service *application.Service) http.Handler {
	transport := &Router{service: service, readiness: newReadiness()}
	transport.readiness.ready()
	router := httpserver.New("chat")
	router.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	router.GET("/livez", transport.liveness)
	router.GET("/readyz", transport.ready)

	api := router.Group("")
	api.Use(transport.requireReady, requireAuth)
	api.GET("/conversations", transport.listConversations)
	api.POST("/conversations", transport.createConversation)
	api.POST("/conversations/canvas", transport.createCanvasConversation)
	api.GET("/conversations/:conversationID", transport.getConversation)
	api.PATCH("/conversations/:conversationID", transport.updateConversation)
	api.DELETE("/conversations/:conversationID", transport.deleteConversation)
	api.Any("/conversations/:conversationID/*path", transport.conversationSubroute)
	api.GET("/memories", transport.listActiveMemories)
	api.GET("/memories/candidates", transport.listMemoryCandidates)
	api.PATCH("/memories/candidates/:id", transport.updateMemoryCandidate)
	api.POST("/memories/candidates/:id/approve", transport.approveMemoryCandidate)
	api.POST("/memories/candidates/:id/reject", transport.rejectMemoryCandidate)
	api.DELETE("/memories/:id", transport.deleteMemory)
	api.Any("/local-inference/*path", transport.proxyRuntime)
	return router
}

func (router *Router) liveness(c *gin.Context) {
	writer := c.Writer
	state, _ := router.readiness.current()
	status := http.StatusOK
	value := "ok"
	if state == "failed" {
		status, value = http.StatusServiceUnavailable, "failed"
	}
	writeJSON(writer, status, map[string]string{"status": value})
}

func (router *Router) ready(c *gin.Context) {
	writer, request := c.Writer, c.Request
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

func (router *Router) requireReady(c *gin.Context) {
	state, _ := router.readiness.current()
	if state != "ready" {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"code": "service_starting", "message": "chat service is not ready"})
		return
	}
	c.Next()
}

func requireAuth(c *gin.Context) {
	request := c.Request
	scope := application.AuthContext{
		UserID:        strings.TrimSpace(request.Header.Get("X-Auth-User-ID")),
		TenantID:      strings.TrimSpace(request.Header.Get("X-Auth-Tenant-ID")),
		WorkspaceID:   strings.TrimSpace(request.Header.Get("X-Auth-Workspace-ID")),
		WorkspaceRole: strings.TrimSpace(request.Header.Get("X-Auth-Workspace-Role")),
	}
	if scope.UserID == "" || scope.TenantID == "" || scope.WorkspaceID == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": "unauthorized", "message": "missing auth context"})
		return
	}
	c.Request = request.WithContext(context.WithValue(request.Context(), authContextKey{}, scope))
	c.Next()
}

func (router *Router) listConversations(c *gin.Context) {
	writer, request := c.Writer, c.Request
	value, err := router.service.List(request.Context(), auth(request))
	writeResult(writer, request, http.StatusOK, value, err)
}

func (router *Router) createConversation(c *gin.Context) {
	writer, request := c.Writer, c.Request
	input, err := decodeCreateInput(request)
	if err != nil {
		writeError(writer, request, err)
		return
	}
	value, err := router.service.Create(request.Context(), auth(request), request.Header, input)
	writeResult(writer, request, http.StatusCreated, value, err)
}

func (router *Router) createCanvasConversation(c *gin.Context) {
	writer, request := c.Writer, c.Request
	input, err := decodeCanvasCreateInput(request)
	if err != nil {
		writeError(writer, request, err)
		return
	}
	value, err := router.service.CreateCanvas(request.Context(), auth(request), request.Header, input)
	writeResult(writer, request, http.StatusCreated, value, err)
}

func (router *Router) getConversation(c *gin.Context) {
	writer, request := c.Writer, c.Request
	value, err := router.service.Get(request.Context(), auth(request), request.Header, c.Param("conversationID"))
	writeResult(writer, request, http.StatusOK, value, err)
}

func (router *Router) updateConversation(c *gin.Context) {
	writer, request := c.Writer, c.Request
	var input struct {
		Title string `json:"title"`
	}
	if err := decodeJSON(request, &input); err != nil || utf8.RuneCountInString(input.Title) < 1 || utf8.RuneCountInString(input.Title) > 200 {
		writeInvalidRequest(writer)
		return
	}
	value, err := router.service.Update(request.Context(), auth(request), c.Param("conversationID"), input.Title)
	writeResult(writer, request, http.StatusOK, value, err)
}

func (router *Router) deleteConversation(c *gin.Context) {
	writer, request := c.Writer, c.Request
	err := router.service.Delete(request.Context(), auth(request), request.Header, c.Param("conversationID"))
	if err != nil {
		writeError(writer, request, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (router *Router) forkConversation(c *gin.Context) {
	writer, request := c.Writer, c.Request
	var input struct {
		MessageID string `json:"message_id"`
		RequestID string `json:"request_id"`
	}
	if err := decodeJSON(request, &input); err != nil ||
		utf8.RuneCountInString(input.MessageID) < 1 || utf8.RuneCountInString(input.MessageID) > 32 ||
		utf8.RuneCountInString(input.RequestID) < 8 || utf8.RuneCountInString(input.RequestID) > 64 {
		writeInvalidRequest(writer)
		return
	}
	value, err := router.service.Fork(
		request.Context(), auth(request), request.Header, c.Param("conversationID"), input.MessageID, input.RequestID,
	)
	writeResult(writer, request, http.StatusCreated, value, err)
}

func (router *Router) proxyConversation(c *gin.Context) {
	writer, request := c.Writer, c.Request
	suffix := c.Param("path")
	if suffix != "" && !strings.HasPrefix(suffix, "/") {
		suffix = "/" + suffix
	}
	response, err := router.service.ProxyConversation(
		request.Context(), auth(request), request.Header, request.Method, c.Param("conversationID"),
		suffix, request.URL.RawQuery, request.Body,
	)
	writeProxyResponse(writer, request, response, err)
}

func (router *Router) conversationSubroute(c *gin.Context) {
	if c.Request.Method == http.MethodPost && c.Param("path") == "/forks" {
		router.forkConversation(c)
		return
	}
	router.proxyConversation(c)
}

func (router *Router) proxyRuntime(c *gin.Context) {
	writer, request := c.Writer, c.Request
	response, err := router.service.ProxyRuntime(request.Context(), auth(request), request.Header, request.Method, request.URL.Path, request.URL.RawQuery, request.Body)
	writeProxyResponse(writer, request, response, err)
}

func (router *Router) listActiveMemories(c *gin.Context) {
	writer, request := c.Writer, c.Request
	memories, err := router.service.ListActiveMemories(request.Context(), auth(request))
	if err != nil {
		writeError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"memories": memories})
}

func (router *Router) listMemoryCandidates(c *gin.Context) {
	writer, request := c.Writer, c.Request
	candidates, err := router.service.ListMemoryCandidates(request.Context(), auth(request))
	if err != nil {
		writeError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"candidates": candidates})
}

func (router *Router) approveMemoryCandidate(c *gin.Context) {
	writer, request := c.Writer, c.Request
	memory, err := router.service.ApproveMemoryCandidate(request.Context(), auth(request), c.Param("id"))
	if err != nil {
		writeError(writer, request, err)
		return
	}
	if memory == nil {
		writeError(writer, request, application.NotFound("memory candidate not found"))
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"memory": memory})
}

func (router *Router) rejectMemoryCandidate(c *gin.Context) {
	writer, request := c.Writer, c.Request
	rejected, err := router.service.RejectMemoryCandidate(request.Context(), auth(request), c.Param("id"))
	if err != nil {
		writeError(writer, request, err)
		return
	}
	if !rejected {
		writeError(writer, request, application.NotFound("memory candidate not found"))
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"rejected": true})
}

func (router *Router) updateMemoryCandidate(c *gin.Context) {
	writer, request := c.Writer, c.Request
	var input struct {
		Category *application.MemoryCategory `json:"category"`
		Content  *string                     `json:"content"`
	}
	if err := decodeJSON(request, &input); err != nil || (input.Category == nil && input.Content == nil) {
		writeInvalidRequest(writer)
		return
	}
	if input.Category != nil {
		switch *input.Category {
		case application.MemoryPreference, application.MemoryProfile, application.MemoryProject, application.MemoryInstruction:
		default:
			writeInvalidRequest(writer)
			return
		}
	}
	if input.Content != nil {
		content := strings.TrimSpace(*input.Content)
		if len(content) < 5 || len(content) > 500 {
			writeInvalidRequest(writer)
			return
		}
		input.Content = &content
	}
	candidate, err := router.service.UpdateMemoryCandidate(
		request.Context(), auth(request), c.Param("id"), input.Category, input.Content,
	)
	if err != nil {
		writeError(writer, request, err)
		return
	}
	if candidate == nil {
		writeError(writer, request, application.NotFound("memory candidate not found"))
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"candidate": candidate})
}

func (router *Router) deleteMemory(c *gin.Context) {
	writer, request := c.Writer, c.Request
	deleted, err := router.service.DeleteMemory(request.Context(), auth(request), c.Param("id"))
	if err != nil {
		writeError(writer, request, err)
		return
	}
	if !deleted {
		writeError(writer, request, application.NotFound("memory not found"))
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"deleted": true})
}

func decodeCreateInput(request *http.Request) (application.CreateConversationInput, error) {
	var input application.CreateConversationInput
	if err := decodeJSON(request, &input); err != nil {
		return input, invalidRequestError()
	}
	if err := validateCreateFields(
		input.RequestID,
		input.Title,
		input.ProviderID,
		input.ReasoningEffort,
		input.ApprovalPolicy,
		input.PermissionProfile,
	); err != nil {
		return input, err
	}
	return input, nil
}

func decodeCanvasCreateInput(request *http.Request) (application.CreateCanvasConversationInput, error) {
	var input application.CreateCanvasConversationInput
	if err := decodeJSON(request, &input); err != nil {
		return input, invalidRequestError()
	}
	if err := validateCreateFields(input.RequestID, input.Title, input.ProviderID, input.ReasoningEffort, nil, nil); err != nil {
		return input, err
	}
	for _, value := range []string{input.ProjectID, input.CanvasID} {
		if length := utf8.RuneCountInString(value); length < 1 || length > 36 {
			return input, invalidRequestError()
		}
	}
	return input, nil
}

func validateCreateFields(requestID string, title, providerID, reasoningEffort, approvalPolicy, permissionProfile *string) error {
	if length := utf8.RuneCountInString(requestID); length < 8 || length > 64 {
		return invalidRequestError()
	}
	for _, field := range []struct {
		value *string
		max   int
		min   int
	}{{title, 200, 1}, {providerID, 32, 0}} {
		if field.value != nil {
			length := utf8.RuneCountInString(*field.value)
			if length < field.min || length > field.max {
				return invalidRequestError()
			}
		}
	}
	if reasoningEffort != nil {
		allowed := map[string]bool{"none": true, "minimal": true, "low": true, "medium": true, "high": true, "xhigh": true, "max": true}
		if !allowed[*reasoningEffort] {
			return invalidRequestError()
		}
	}
	if approvalPolicy != nil {
		allowed := map[string]bool{"never": true, "on-request": true, "unless-trusted": true, "granular": true}
		if !allowed[*approvalPolicy] {
			return invalidRequestError()
		}
	}
	if permissionProfile != nil {
		allowed := map[string]bool{":read-only": true, ":workspace": true, ":danger-full-access": true}
		if !allowed[*permissionProfile] {
			return invalidRequestError()
		}
	}
	return nil
}

func decodeJSON(request *http.Request, target any) error {
	decoder := json.NewDecoder(request.Body)
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
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
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if mediaType == "text/event-stream" || mediaType == "application/x-ndjson" {
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
