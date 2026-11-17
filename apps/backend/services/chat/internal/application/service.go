package application

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Service struct {
	repository Repository
	runtime    RuntimeClient
}

func NewService(repository Repository, runtime RuntimeClient) *Service {
	return &Service{repository: repository, runtime: runtime}
}

func (service *Service) Ping(ctx context.Context) error { return service.repository.Ping(ctx) }
func (service *Service) Close()                         { service.repository.Close() }

func (service *Service) List(ctx context.Context, scope AuthContext) ([]map[string]any, error) {
	items, err := service.repository.List(ctx, scope)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, PublicConversation(item))
	}
	return result, nil
}

func (service *Service) Create(ctx context.Context, scope AuthContext, headers http.Header, input CreateConversationInput) (map[string]any, error) {
	runtimeValue, err := service.createRuntimeSession(ctx, headers, input)
	if err != nil {
		return nil, err
	}
	runtimeID, ok := runtimeValue["id"].(string)
	if !ok || runtimeID == "" {
		return nil, errors.New("Runtime create session response has no id")
	}
	product, err := service.repository.Create(ctx, scope, runtimeID, input)
	if err != nil {
		return nil, err
	}
	return ProjectConversation(product, runtimeValue), nil
}

func (service *Service) CreateCanvas(ctx context.Context, scope AuthContext, headers http.Header, input CreateConversationInput) (map[string]any, error) {
	runtimeValue, err := service.createRuntimeSession(ctx, headers, input)
	if err != nil {
		return nil, err
	}
	runtimeID, ok := runtimeValue["id"].(string)
	if !ok || runtimeID == "" {
		return nil, errors.New("Runtime create session response has no id")
	}
	product, err := service.repository.Create(ctx, scope, runtimeID, input)
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": product.ID, "project_id": product.ProjectID, "canvas_id": product.CanvasID}, nil
}

func (service *Service) Get(ctx context.Context, scope AuthContext, headers http.Header, conversationID string) (map[string]any, error) {
	product, err := service.requireConversation(ctx, scope, conversationID)
	if err != nil {
		return nil, err
	}
	response, err := service.runtime.Do(ctx, RuntimeRequest{Method: http.MethodGet, Path: runtimePath(*product, ""), Headers: headers})
	if err != nil {
		return nil, err
	}
	runtimeValue, err := requireRuntimeJSON(response)
	if err != nil {
		return nil, err
	}
	return ProjectConversation(*product, runtimeValue), nil
}

func (service *Service) Update(ctx context.Context, scope AuthContext, conversationID, title string) (map[string]any, error) {
	if _, err := service.requireConversation(ctx, scope, conversationID); err != nil {
		return nil, err
	}
	product, err := service.repository.UpdateTitle(ctx, scope, conversationID, title)
	if err != nil {
		return nil, err
	}
	if product == nil {
		return nil, NotFound("conversation not found")
	}
	return PublicConversation(*product), nil
}

func (service *Service) Delete(ctx context.Context, scope AuthContext, headers http.Header, conversationID string) error {
	product, err := service.requireConversation(ctx, scope, conversationID)
	if err != nil {
		return err
	}
	response, err := service.runtime.Do(ctx, RuntimeRequest{Method: http.MethodDelete, Path: runtimePath(*product, ""), Headers: headers})
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if response.StatusCode != http.StatusNotFound {
			return &RuntimeResponseError{Response: response}
		}
	}
	if response.Body != nil {
		response.Body.Close()
	}
	_, err = service.repository.Delete(ctx, scope, product.ID)
	return err
}

func (service *Service) Fork(ctx context.Context, scope AuthContext, headers http.Header, conversationID, messageID string) (map[string]any, error) {
	source, err := service.requireConversation(ctx, scope, conversationID)
	if err != nil {
		return nil, err
	}
	body, _ := json.Marshal(map[string]string{"message_id": messageID})
	response, err := service.runtime.Do(ctx, RuntimeRequest{Method: http.MethodPost, Path: runtimePath(*source, "/forks"), Headers: headers, Body: bytes.NewReader(body)})
	if err != nil {
		return nil, err
	}
	fork, err := requireRuntimeJSON(response)
	if err != nil {
		return nil, err
	}
	forkID, ok := fork["id"].(string)
	if !ok || forkID == "" {
		return nil, errors.New("Runtime fork response has no id")
	}
	sourceMessageID, _ := fork["source_message_id"].(string)
	title := source.Title
	runes := []rune(title)
	if len(runes) > 190 {
		title = string(runes[:190])
	}
	title += " · 分支"
	requestID := "fork:" + forkID
	product, err := service.repository.Create(ctx, scope, forkID, CreateConversationInput{
		RequestID: requestID, Title: &title, ProjectID: source.ProjectID, CanvasID: source.CanvasID,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": product.ID, "source_conversation_id": source.ID, "source_message_id": sourceMessageID}, nil
}

func (service *Service) ProxyConversation(ctx context.Context, scope AuthContext, headers http.Header, method, conversationID, suffix, rawQuery string, body io.Reader) (*http.Response, error) {
	product, err := service.requireConversation(ctx, scope, conversationID)
	if err != nil {
		return nil, err
	}
	requestBody := body
	if suffix == "/agents/run/stream" && method == http.MethodPost {
		var input map[string]any
		decoder := json.NewDecoder(body)
		decoder.UseNumber()
		if err := decoder.Decode(&input); err != nil {
			return nil, BadRequest("request body must be valid JSON")
		}
		projected, err := RuntimeRunBody(*product, input)
		if err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(projected)
		if err != nil {
			return nil, err
		}
		requestBody = bytes.NewReader(encoded)
	}
	response, err := service.runtime.Do(ctx, RuntimeRequest{
		Method: method, Path: runtimePath(*product, suffix) + querySuffix(rawQuery), Headers: headers, Body: requestBody,
	})
	if err != nil {
		return nil, err
	}
	return ProjectRuntimeResponse(*product, response)
}

func (service *Service) ProxyRuntime(ctx context.Context, headers http.Header, method, path, rawQuery string, body io.Reader) (*http.Response, error) {
	return service.runtime.Do(ctx, RuntimeRequest{Method: method, Path: path + querySuffix(rawQuery), Headers: headers, Body: body})
}

func (service *Service) createRuntimeSession(ctx context.Context, headers http.Header, input CreateConversationInput) (map[string]any, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	response, err := service.runtime.Do(ctx, RuntimeRequest{Method: http.MethodPost, Path: "/v1/sessions", Headers: headers, Body: bytes.NewReader(body)})
	if err != nil {
		return nil, err
	}
	return requireRuntimeJSON(response)
}

func (service *Service) requireConversation(ctx context.Context, scope AuthContext, conversationID string) (*Conversation, error) {
	product, err := service.repository.Get(ctx, scope, conversationID)
	if err != nil {
		return nil, err
	}
	if product == nil {
		return nil, NotFound("conversation not found")
	}
	return product, nil
}

func requireRuntimeJSON(response *http.Response) (map[string]any, error) {
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &RuntimeResponseError{Response: response}
	}
	defer response.Body.Close()
	var value map[string]any
	decoder := json.NewDecoder(response.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("decode Runtime response: %w", err)
	}
	return value, nil
}

func ProjectRuntimeResponse(product Conversation, response *http.Response) (*http.Response, error) {
	if response.Body == nil || response.StatusCode == http.StatusNoContent || response.StatusCode == http.StatusNotModified ||
		!strings.Contains(response.Header.Get("Content-Type"), "application/json") {
		return response, nil
	}
	defer response.Body.Close()
	var value any
	decoder := json.NewDecoder(response.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("decode Runtime response: %w", err)
	}
	body, err := json.Marshal(ProjectRuntimeValue(product, value))
	if err != nil {
		return nil, err
	}
	response.Body = io.NopCloser(bytes.NewReader(body))
	response.ContentLength = -1
	response.Header.Del("Content-Length")
	return response, nil
}

func PublicConversation(product Conversation) map[string]any {
	return map[string]any{
		"id": product.ID, "user_id": product.UserID, "tenant_id": product.TenantID, "workspace_id": product.WorkspaceID,
		"title": product.Title, "project_id": product.ProjectID, "canvas_id": product.CanvasID,
		"created_at": isoMilliseconds(product.CreatedAt), "updated_at": isoMilliseconds(product.UpdatedAt),
	}
}

func runtimePath(product Conversation, suffix string) string {
	return "/v1/sessions/" + url.PathEscape(product.RuntimeSessionID) + suffix
}

func querySuffix(rawQuery string) string {
	if rawQuery == "" {
		return ""
	}
	return "?" + rawQuery
}

func isoMilliseconds(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000Z")
}
